# Face & Vision Bridge – README

A small Express service that bridges **Azure AI Face** (limited use: qualityOnly) and **Azure AI Vision** (caption/tags/objects) with:

- Clean REST endpoints
- Swagger docs at `/face/docs/` (proxied by Nginx)
- Public base path `/face/*` (Nginx → Node on :6000)
- PM2 process manager for persistence

**Live docs:** http://134.199.193.62/face/docs/  
**OpenAPI JSON:** http://134.199.193.62/face/openapi.json  
**Health:** http://134.199.193.62/face/healthz

> Note: The app listens on **:6000** and Nginx proxies `/face/*` → `http://127.0.0.1:6000/*`.

---

## What’s available

### 1) Azure AI Face (quality-only detect)
**POST** `/face/face/detect`  
Body (JSON):
```json
{
  "imageUrl": "https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/Face/images/Family1-Dad1.jpg",
  "returnFaceAttributes": "qualityForRecognition"
}
Response (example):

json
Copy code
[
  {
    "faceRectangle": { "top": 19, "left": 27, "width": 148, "height": 206 },
    "faceAttributes": { "qualityForRecognition": "high" }
  }
]
Notes:

Only qualityForRecognition is supported; other Face attributes are deprecated.

If your Face resource doesn’t have recognition features approved, this route still works because we don’t request identification/verification.

2) Azure AI Vision – Caption
POST /face/vision/caption
Body:

json
Copy code
{ "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg" }
Response (example):

json
Copy code
{
  "version": "v4",
  "caption": "a large stone structure with many arches with Colosseum in the background",
  "confidence": 0.5775
}
3) Azure AI Vision – Tags
POST /face/vision/tags
Body:

json
Copy code
{ "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg" }
Response:

json
Copy code
{ "version": "v4", "tags": [ {"name":"…","confidence":0.99}, … ] }
4) Azure AI Vision – Analyze (multi-feature)
POST /face/vision/analyze
Body:

json
Copy code
{
  "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg",
  "features": ["Caption","Tags","Objects"]
}
Response includes only requested features.

How to operate (your IP)
Swagger UI (Try-it-out): http://134.199.193.62/face/docs/

Health check: curl -s http://134.199.193.62/face/healthz

Direct cURL (through proxy):

bash
Copy code
curl -s -X POST http://134.199.193.62/face/vision/caption \
  -H 'content-type: application/json' \
  -d '{"imageUrl":"https://upload.wikimedia.org/wikipedia/commons/5/5f/Alpspix_view_platform.jpg"}'
Environment variables (update keys/endpoints)
Set Face and Vision keys & endpoints, then restart PM2:

bash
Copy code
export AZURE_FACE_ENDPOINT="https://<your-face>.cognitiveservices.azure.com"
export AZURE_FACE_KEY="<FACE_KEY>"

export AZURE_VISION_ENDPOINT="https://<your-vision>.cognitiveservices.azure.com"
export AZURE_VISION_KEY="<VISION_KEY>"

pm2 restart face-bridge --update-env
pm2 save
Persist across logins (optional): put those exports in /etc/profile.d/face-bridge.sh.

PM2 cheatsheet
bash
Copy code
pm2 status
pm2 logs face-bridge --lines 100
pm2 restart face-bridge --update-env
pm2 save
pm2 resurrect
Nginx proxy (already set)
/etc/nginx/conf.d/face.conf

nginx
Copy code
server {
  listen 80 default_server;
  server_name _;

  location /face/docs/ { proxy_pass http://127.0.0.1:6000/docs/;  proxy_set_header Host $host; }
  location = /face/docs { return 301 /face/docs/; }

  location /face/openapi.json { proxy_pass http://127.0.0.1:6000/openapi.json; proxy_set_header Host $host; }

  location /face/ { proxy_pass http://127.0.0.1:6000/; proxy_set_header Host $host; }
}
Reload if you edit:

bash
Copy code
nginx -t && systemctl reload nginx
Troubleshooting
Swagger shows 127.0.0.1 servers
We rewrite servers to http://134.199.193.62/face at /face/openapi.json. Clear browser cache if you still see 127.0.0.1.

CORS / Failed to fetch in Swagger
Open docs at the public URL http://134.199.193.62/face/docs/ (not http://127.0.0.1:6000/docs/).

401/403 from Azure
Keys invalid or endpoint region mismatch; verify in Azure portal. Face attributes beyond qualityForRecognition are not supported.

Port 6000 not listening on 0.0.0.0
App is bound to 0.0.0.0:6000 (internally). External access is via Nginx on port 80 → /face/*.

Security & hygiene
Do not commit keys. Use env vars.

Consider rate limiting & body size limits (Express middleware) if needed.

Maintainer
Tim Hillmann – 6177 Final Project
