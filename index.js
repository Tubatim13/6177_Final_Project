'use strict';
const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(express.json());

// ---------------- Health ----------------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------------- OpenAPI (Swagger) ----------------
const baseSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Face & Vision Bridge',
    version: '1.1.0',
    description:
      'Endpoints bridging to Azure Face API and Azure Computer Vision. Face supports detection and qualityForRecognition; Vision prefers v4 with v3.2 fallback.'
  },
  paths: {
    '/face/detect': {
      post: {
        tags: ['Face'],
        summary: 'Detect faces (optionally qualityForRecognition)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['imageUrl'],
                properties: {
                  imageUrl: {
                    type: 'string',
                    format: 'uri',
                    example: 'https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/Face/images/Family1-Dad1.jpg'
                  },
                  returnFaceAttributes: {
                    type: 'string',
                    description: 'Optional. Only "qualityForRecognition" is supported by Azure.',
                    example: 'qualityForRecognition'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'OK - Azure Face API response array' },
          400: { description: 'Bad request' },
          500: { description: 'Server/config error' },
          502: { description: 'Upstream Face API error' }
        }
      }
    },
    '/vision/analyze': {
      post: {
        tags: ['Vision'],
        summary: 'Analyze image (v4 preferred, v3.2 fallback)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['imageUrl'],
                properties: {
                  imageUrl: { type: 'string', format: 'uri', example: 'https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/ComputerVision/Images/landmark.jpg' },
                  features: {
                    type: 'array',
                    items: { type: 'string', enum: ['Caption', 'Tags', 'Objects'] },
                    description: 'Azure Vision v4 features; omit to use defaults.'
                  }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'OK' }, 400: { description: 'Bad request' }, 500: { description: 'Server/config error' }, 502: { description: 'Upstream Vision API error' } }
      }
    },
    '/vision/caption': {
      post: {
        tags: ['Vision'],
        summary: 'Return a caption for the image',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['imageUrl'], properties: { imageUrl: { type: 'string', format: 'uri' } } }
            }
          }
        },
        responses: { 200: { description: 'OK' }, 400: { description: 'Bad request' } }
      }
    },
    '/vision/tags': {
      post: {
        tags: ['Vision'],
        summary: 'Return tags/labels for the image',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['imageUrl'], properties: { imageUrl: { type: 'string', format: 'uri' } } }
            }
          }
        },
        responses: { 200: { description: 'OK' }, 400: { description: 'Bad request' } }
      }
    }
  }
};

// dynamic servers entry, honors Nginx proxy prefix (/face)
app.get('/openapi.json', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const prefix = req.headers['x-forwarded-prefix'] || '';
  res.json({ ...baseSpec, servers: [{ url: `${proto}://${host}${prefix}` }] });
});

// Serve Swagger UI; Nginx maps /face/docs/ -> /docs/
app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, {
  swaggerOptions: { url: '/face/openapi.json' } // important: prefixed path via Nginx
}));

// ---------------- Face API (detect) ----------------
const FACE_ALLOWED_ATTRS = new Set(['qualityForRecognition']);

app.post(
  '/face/detect',
  [
    body('imageUrl').isURL().withMessage('imageUrl must be a valid URL'),
    body('returnFaceAttributes').optional().isString()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const endpoint = process.env.AZURE_FACE_ENDPOINT;
      const key = process.env.AZURE_FACE_KEY;
      if (!endpoint || !key) return res.status(500).json({ error: 'Missing AZURE_FACE_ENDPOINT or AZURE_FACE_KEY' });

      const { imageUrl, returnFaceAttributes } = req.body;

      // sanitize attributes
      let attrs = '';
      if (returnFaceAttributes) {
        const requested = returnFaceAttributes.split(',').map(s => s.trim()).filter(Boolean);
        const allowed = requested.filter(a => FACE_ALLOWED_ATTRS.has(a));
        if (requested.length && !allowed.length) {
          return res.status(400).json({ error: 'Unsupported returnFaceAttributes', requested, allowedOptions: Array.from(FACE_ALLOWED_ATTRS) });
        }
        if (allowed.length) attrs = allowed.join(',');
      }

      // detection-only by default; if attributes requested (qualityForRecognition), add recognitionModel
      const params = new URLSearchParams({
        returnFaceId: 'false',
        detectionModel: 'detection_03',
        returnFaceLandmarks: 'false'
      });
      if (attrs) {
        params.set('returnFaceAttributes', attrs);
        params.set('recognitionModel', 'recognition_04');
      }

      const url = `${endpoint.replace(/\/+$/, '')}/face/v1.0/detect?${params.toString()}`;

      const resp = await axios.post(url, { url: imageUrl }, {
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
        timeout: 15000
      });

      res.json(resp.data);
    } catch (err) {
      if (err.response) return res.status(err.response.status || 502).json({ error: 'Upstream Face API error', status: err.response.status, data: err.response.data });
      next(err);
    }
  }
);

// ---------------- Vision (v4 with v3.2 fallback) ----------------
async function azureVisionAnalyze(imageUrl, features /* array */) {
  const endpoint = process.env.AZURE_VISION_ENDPOINT;
  const key = process.env.AZURE_VISION_KEY;
  if (!endpoint || !key) {
    const e = new Error('Missing AZURE_VISION_ENDPOINT or AZURE_VISION_KEY');
    e.status = 500;
    throw e;
  }

  // Try v4 first
  const v4Query = new URLSearchParams({
    'api-version': '2023-10-01',
    features: (features && features.length) ? features.join(',') : 'Caption,Tags,Objects'
  });
  const v4Url = `${endpoint.replace(/\/+$/, '')}/computervision/imageanalysis:analyze?${v4Query.toString()}`;
  try {
    const v4Resp = await axios.post(v4Url, { url: imageUrl }, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    return { version: 'v4', data: v4Resp.data };
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404 || status === 400 || status === 415) {
      // fallback to v3.2
      const v32Query = new URLSearchParams({
        visualFeatures: 'Description,Tags,Objects',
        language: 'en'
      });
      const v32Url = `${endpoint.replace(/\/+$/, '')}/vision/v3.2/analyze?${v32Query.toString()}`;
      const v32Resp = await axios.post(v32Url, { url: imageUrl }, {
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
        timeout: 15000
      });
      return { version: 'v3.2', data: v32Resp.data };
    }
    throw err;
  }
}

const validateImageUrl = [ body('imageUrl').isURL().withMessage('imageUrl must be a valid URL') ];

// POST /vision/analyze
app.post('/vision/analyze', [
  ...validateImageUrl,
  body('features').optional().isArray().withMessage('features must be an array of strings')
], async (req, res) => {
  try {
    const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { imageUrl, features } = req.body;
    const result = await azureVisionAnalyze(imageUrl, features);
    return res.json(result);
  } catch (err) {
    if (err.response) return res.status(err.response.status || 502).json({ error: 'Upstream Vision API error', status: err.response.status, data: err.response.data });
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// POST /vision/caption
app.post('/vision/caption', validateImageUrl, async (req, res) => {
  try {
    const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { imageUrl } = req.body;
    const { version, data } = await azureVisionAnalyze(imageUrl, ['Caption']);
    if (version === 'v4') {
      const text = data?.captionResult?.text || null;
      const confidence = data?.captionResult?.confidence || null;
      return res.json({ version, caption: text, confidence, raw: data });
    } else {
      const cap = data?.description?.captions?.[0] || null;
      return res.json({ version, caption: cap?.text || null, confidence: cap?.confidence ?? null, raw: data });
    }
  } catch (err) {
    if (err.response) return res.status(err.response.status || 502).json({ error: 'Upstream Vision API error', status: err.response.status, data: err.response.data });
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// POST /vision/tags
app.post('/vision/tags', validateImageUrl, async (req, res) => {
  try {
    const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { imageUrl } = req.body;
    const { version, data } = await azureVisionAnalyze(imageUrl, ['Tags']);
    if (version === 'v4') {
      const tags = data?.tagsResult?.values?.map(t => ({ name: t.name, confidence: t.confidence })) || [];
      return res.json({ version, count: tags.length, tags, raw: data });
    } else {
      const tags = (data?.tags || []).map(t => ({ name: t.name, confidence: t.confidence }));
      return res.json({ version, count: tags.length, tags, raw: data });
    }
  } catch (err) {
    if (err.response) return res.status(err.response.status || 502).json({ error: 'Upstream Vision API error', status: err.response.status, data: err.response.data });
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// ---------------- Start ----------------
const PORT = process.env.PORT || 6000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Bridge listening at http://${HOST}:${PORT}`);
});
