# QueryLinker Production Deployment

This project is deployed as a split architecture:

- `Netlify` for the React frontend
- a Docker-friendly host for the Fastify backend
- PostgreSQL for relational data
- Redis for background and realtime support
- the Python classifier service for AI routing

## 1. Netlify frontend

This repository includes a `netlify.toml` file configured for the Vite frontend:

- build command: `npm --prefix frontend run build`
- publish directory: `frontend/dist`
- SPA redirect: `/* -> /index.html`

Set this environment variable in Netlify before deploying:

```bash
VITE_API_URL=https://api.your-domain.com/api/v1
```

## 2. Backend public URLs

When the backend is hosted on its own domain, configure these values:

```bash
PUBLIC_WEB_URL=https://your-netlify-site.netlify.app
PUBLIC_API_URL=https://api.your-domain.com/api/v1
FRONTEND_URL=https://your-netlify-site.netlify.app
CORS_ALLOWED_ORIGINS=https://your-netlify-site.netlify.app
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
COOKIE_DOMAIN=
```

Use `COOKIE_SAME_SITE=none` only when the frontend and backend are on different domains. The backend now supports this split-origin cookie mode.

## 3. Backend runtime requirements

The Fastify backend is not a static site and should be hosted on a platform that supports:

- long-running Node.js services
- websockets on `/socket.io`
- persistent uploads under `/uploads`
- PostgreSQL connectivity
- Redis connectivity
- the Python `ai-nlp` classifier service

Make sure the backend host exposes:

- `https://api.your-domain.com/api/v1`
- `https://api.your-domain.com/uploads/*`
- `https://api.your-domain.com/socket.io`

## 4. Database and Redis

Production services needed by the backend:

- `DATABASE_URL`
- Redis connection values used by the app
- AI provider keys if Groq/Gemini integrations should run live
- SMTP credentials if email notifications should run live

## 5. Post-deploy checks

After both frontend and backend are live, verify:

1. Landing page loads from Netlify
2. Login succeeds and cookies persist
3. Ticket lists load from the external backend
4. Upload links open correctly from the Netlify frontend
5. Socket-based updates work without refresh
6. Chatbot, boards, schedule, and notifications all work against production APIs
