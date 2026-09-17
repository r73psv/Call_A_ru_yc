# Project Guidelines & Rules

## 1. Dockerfile Synchronization Rule
- **CRITICAL**: Whenever you update application code, server entry points (`server.ts`), environment variables (`.env.example`), or dependencies (`package.json`), you MUST verify and update `Dockerfile` accordingly.
- Ensure multi-stage Docker builds complete cleanly with `npm run build` and `dist/server.cjs`.
- Ensure `HEALTHCHECK`, volume mounts (`/app/data`), and environment defaults remain synchronized.

## 2. Server & API Architecture
- Server entry point: `server.ts` compiled via esbuild to `dist/server.cjs`.
- Database storage path: `DATA_PATH=/app/data/data-store.json`.
- Port binding: MUST always bind to `0.0.0.0` and port `3000`.
