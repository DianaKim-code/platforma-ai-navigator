# Protected AI endpoint scaffold

This minimal Node.js service is intentionally separate from the static GitHub Pages frontend. It reads provider credentials only from server environment variables, restricts CORS to the configured production origin plus explicit localhost origins, requests structured JSON, and validates the provider response before returning it.

Required variables:

- `AI_API_KEY` — provider secret; never expose it to the browser.
- `AI_MODEL` — provider model name.
- `AI_BASE_URL` — optional OpenAI-compatible API base URL.
- `PORT` — optional, defaults to `8787`.
- `ALLOWED_ORIGIN` — defaults to `https://dianakim-code.github.io`.

Run from `server/` with Node.js 20+:

```bash
npm start
```

Before a live release, deploy this directory to a protected server runtime, configure its secrets there, and set the frontend `AI_ENDPOINT` URL. Do not deploy `.env` or provider keys to GitHub Pages.

