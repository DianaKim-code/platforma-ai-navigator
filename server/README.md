# MVP v3 staging backend

This minimal Node.js 20+ service is intentionally separate from the static GitHub Pages frontend. It reads provider credentials only from server environment variables, restricts CORS to the production origin plus explicit localhost origins, applies the deterministic safety gate before the provider, requests structured JSON, and validates the provider response before returning it. Requests, prompts, provider responses, credentials, and authorization headers are not persisted or logged.

Required variables:

- `AI_API_KEY` — provider secret; never expose it to the browser.
- `AI_MODEL` — provider model name.
- `AI_BASE_URL` — OpenAI-compatible API base URL, normally ending in `/v1`.
- `PORT` — supplied by Railway; locally defaults to `8787`.
- `HOST` — locally defaults to `0.0.0.0`.
- `ALLOWED_ORIGIN` — defaults to `https://dianakim-code.github.io`.

Run from `server/` with Node.js 20+:

```bash
npm start
```

Local endpoints:

- `GET /health` — minimal service health response; never calls AI.
- `POST /analyze` — validated JSON request, safety gate, provider call, structured validation.

The request body limit is 50 KB. Every response includes `X-Request-Id`. Provider calls time out after 25 seconds. Error responses contain stable codes only and never include provider internals or stack traces.

## Railway staging deploy

Deploy the repository root so the service can read the single approved `data/practices.json` and shared safety/schema modules. `railway.json` installs and starts only the `server` package:

```text
Build command: npm --prefix server install
Start command: npm --prefix server start
Health path: /health
```

In Railway, add `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, and `ALLOWED_ORIGIN` under **Service → Variables**. Railway supplies `PORT`. Do not paste secrets into source files, GitHub variables intended for the frontend, build arguments, or this README.

This service is staging-only. Do not connect it to production v2 or publish the v3 frontend without separate approval.
