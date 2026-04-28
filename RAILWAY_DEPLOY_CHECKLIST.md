# QueryLinker Railway Checklist

Use this checklist to connect the Netlify frontend to a live backend stack on Railway.

## 1. Create Railway services

Create these services inside one Railway project:

1. `backend`
2. `ai-nlp`
3. `PostgreSQL`
4. `Redis`

## 2. Set service root directories

- `backend` root directory: `/backend`
- `ai-nlp` root directory: `/ai-services/nlp-classifier`

Railway supports monorepos by assigning a root directory per service.

## 3. Backend service settings

- Build command: `npm install && npm run build`
- Start command: `node dist/server.js`

Add a Volume and mount it to:

- `/app/uploads`

## 4. AI service settings

- Build command: leave Railway auto-detect or install from `requirements.txt`
- Start command: `sh entrypoint.sh`

The AI service entrypoint now respects Railway's assigned port through `${PORT:-8001}`.

## 5. Backend environment variables

Copy values from:

- `backend/.env.railway.example`

At minimum set:

- `DATABASE_URL`
- `JWT_SECRET`
- `PUBLIC_WEB_URL`
- `PUBLIC_API_URL`
- `FRONTEND_URL`
- `CORS_ALLOWED_ORIGINS`
- `COOKIE_SAME_SITE=none`
- `COOKIE_SECURE=true`
- `AI_CLASSIFIER_URL`
- `REDIS_HOST`
- `REDIS_PORT`

## 6. AI service environment variables

Copy values from:

- `ai-services/nlp-classifier/.env.railway.example`

## 7. Netlify environment variable

In Netlify, set:

```env
VITE_API_URL=https://your-backend-domain/api/v1
```

Then trigger a new Netlify deploy.

## 8. Production checks

After both services are live:

1. open the Netlify site
2. test login
3. open ticket list
4. create a ticket
5. upload a file
6. confirm board and schedule realtime updates
7. confirm `/socket.io` connects
