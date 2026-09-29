# Sahayak AI service

This is the separate AI service used by the portal's existing
`POST /api/sahayak/chat` integration. It listens on `HOST`/`PORT` and
forwards each request to OpenRouter's OpenAI-compatible chat-completions API.

## Setup

```powershell
cd sahayak-service
npm install
Copy-Item .env.example .env
```

Set `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and `OPENROUTER_MODEL` in
`.env`. Do not commit `.env`.

The portal's Sahayak service uses the same server-side OpenRouter integration
as `SIH-BOT/BACKEND`: `POST /chat/completions`, the `OPENROUTER_API_KEY`
environment variable, and the configured OpenRouter model. Keep the key in the
service environment only; it must never be added to browser code.

## Run

```powershell
npm start
```

For local development, the portal backend can use:

```env
SAHAYAK_API_URL=http://localhost:8000
```

The service exposes `POST /chat` with `{ "problem": "...", "language": "en" }`
or `"hi"`, and returns the structured JSON consumed by
`components/sahayak-chat.tsx`. `GET /health` reports service readiness and
whether the server-side OpenRouter configuration is present; the portal proxies
this through its authenticated `GET /api/sahayak/status` route. If the provider
is not configured or fails, the service returns an error; it never fabricates a
response.
