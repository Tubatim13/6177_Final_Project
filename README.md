# Face & Vision Bridge – README (Plain Text)

A small Express service that bridges Azure AI Face (quality-only) and Azure AI Vision (caption/tags/objects). It exposes clean REST endpoints, serves Swagger docs, and is fronted by Nginx on /face/* with the Node app listening on :6000 (managed by PM2).

Live docs:  http://134.199.193.62/face/docs/
OpenAPI:    http://134.199.193.62/face/openapi.json
Health:     http://134.199.193.62/face/healthz

WHAT’S AVAILABLE
1) Azure AI Face – quality-only detect
   POST /face/face/detect
   Request body (JSON):
     {
       "imageUrl": "https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/Face/images/Family1-Dad1.jpg",
       "returnFaceAttributes": "qualityForRecognition"
     }
   Example response:
     [
       {
         "faceRectangle": { "top": 19, "left": 27, "width": 148, "height": 206 },
         "faceAttributes": { "qualityForRecognition": "high" }
       }
     ]
   Notes:
   - Only "qualityForRecognition" is supported; other Face attributes are deprecated.

2) Azure AI Vision – caption
   POST /face/vision/caption
   Request body (JSON):
     { "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg" }
   Example response:
     {
       "version": "v4",
       "caption": "a large stone structure with many arches with Colosseum in the background",
       "confidence": 0.5775
     }

3) Azure AI Vision – tags
   POST /face/vision/tags
   Request body (JSON):
     { "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg" }
   Example response (shape):
     { "version": "v4", "tags": [ { "name": "...", "confidence": 0.99 }, ... ] }

4) Azure AI Vision – analyze (multi-feature)
   POST /face/vision/analyze
   Request body (JSON):
     {
       "imageUrl": "https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/ComputerVision/Images/landmark.jpg",
       "features": ["Caption", "Tags", "Objects"]
     }
   Returns only the requested features.

HOW TO OPERATE (USING YOUR IP)
- Swagger UI (Try-it-out):  http://134.199.193.62/face/docs/
- Health check (cURL):      curl -s http://134.199.193.62/face/healthz
- Direct cURL example (caption):
    curl -s -X POST http://134.199.193.62/face/vision/caption \
      -H 'content-type: application/json' \
      -d '{"imageUrl":"https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg"}'

ENV VARS (UPDATE KEYS/ENDPOINTS)
Export Face and Vision keys/endpoints, then restart PM2:
  export AZURE_FACE_ENDPOINT="https://<your-face>.cognitiveservices.azure.com"
  export AZURE_FACE_KEY="<FACE_KEY>"
  export AZURE_VISION_ENDPOINT="https://<your-vision>.cognitiveservices.azure.com"
  export AZURE_VISION_KEY="<VISION_KEY>"
  pm2 restart face-bridge --update-env
  pm2 save
Optional persistence: put those exports in /etc/profile.d/face-bridge.sh

PM2 CHEATSHEET
  pm2 status
  pm2 logs face-bridge --lines 100
  pm2 restart face-bridge --update-env
  pm2 save
  pm2 resurrect

NGINX PROXY (ALREADY SET)
File: /etc/nginx/conf.d/face.conf
  server {
    listen 80 default_server;
    server_name _;

    location /face/docs/ { proxy_pass http://127.0.0.1:6000/docs/;  proxy_set_header Host $host; }
    location = /face/docs { return 301 /face/docs/; }

    location /face/openapi.json { proxy_pass http://127.0.0.1:6000/openapi.json; proxy_set_header Host $host; }

    location /face/ { proxy_pass http://127.0.0.1:6000/; proxy_set_header Host $host; }
  }
Reload after edits:
  nginx -t && systemctl reload nginx

TROUBLESHOOTING
- Swagger still shows 127.0.0.1 servers:
  The service rewrites servers to http://134.199.193.62/face at /face/openapi.json.
  Clear browser cache or hard refresh if you still see 127.0.0.1.

- "Failed to fetch" in Swagger:
  Use the public docs URL (http://134.199.193.62/face/docs/), not the internal 127.0.0.1:6000/docs.

- 401/403 from Azure:
  Keys invalid or region mismatch; verify in Azure portal. Face attributes beyond "qualityForRecognition" are not supported.

- Port 6000 accessibility:
  Node listens on 0.0.0.0:6000 internally; external access is via Nginx /face/* on port 80.

SECURITY
- Do not commit keys. Use environment variables.
- Consider rate limiting and body size limits if exposing publicly.

Maintainer: Tim Hillmann – 6177 Final Project
