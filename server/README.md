# MVP v3 staging backend

This minimal Node.js 20+ service is intentionally separate from the static GitHub Pages frontend. It reads provider credentials only from server environment variables, restricts CORS to the production origin plus explicit localhost origins, applies the deterministic safety gate before the provider, requests structured JSON, and validates the provider response before returning it. Requests, prompts, provider responses, credentials, and authorization headers are not persisted or logged.

Primary current staging target: **Vercel Functions**. Alternative backend target: **Railway / standard Node server**.

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

Provider sampling uses `temperature: 0.2`; `top_p` and `seed` are intentionally unset. The response format remains JSON-object mode. Route and Practice selection are deterministic backend decisions, while the provider is limited to synthesis and explanation. Invalid-response diagnostics log only a safe failure stage and validator metadata (code, field, expected type, actual type), never response content or request data.

## Vercel staging backend

The repository-root `api/health.js` and `api/analyze.js` files are thin Vercel adapters. They reuse the shared validation, deterministic safety, provider, schema, error, and Practice Map logic under `server/src`; they do not start the persistent listener in `server/src/index.js`. The minimal root `vercel.json` gives only `api/analyze.js` a 30-second maximum duration so the existing 25-second provider timeout can return a controlled response.

1. Import the GitHub repository into Vercel.
2. Set **Root Directory** to the repository root and use Framework Preset **Other**.
3. Keep **Production Branch** set to `main`.
4. Under **Project → Settings → Environment Variables → Preview**, configure `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, and `ALLOWED_ORIGIN`. Do not add their values to source control. Do not add Production-scoped values during this staging step.
5. Push `feature/mvp-v3-ai-brain` only.
6. Open the resulting Preview Deployment for that branch.
7. Check `GET https://<preview-domain>/api/health`.
8. Check `POST https://<preview-domain>/api/analyze`, starting with a deterministic safety payload that does not call the provider. Run a normal provider request only after the Preview variables are configured.

Without `AI_API_KEY`, health and deterministic safety requests still work; a normal analyze request returns a controlled `503`. Do not run `vercel --prod`, change the production branch, or connect this endpoint to production v2 without separate approval.

## Railway staging deploy

Deploy the repository root so the service can read the single approved `data/practices.json` and shared safety/schema modules. `railway.json` installs and starts only the `server` package:

```text
Build command: npm --prefix server install
Start command: npm --prefix server start
Health path: /health
```

In Railway, add `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, and `ALLOWED_ORIGIN` under **Service → Variables**. Railway supplies `PORT`. Do not paste secrets into source files, GitHub variables intended for the frontend, build arguments, or this README.

This service is staging-only. Do not connect it to production v2 or publish the v3 frontend without separate approval.
