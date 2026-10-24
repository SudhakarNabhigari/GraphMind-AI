# GraphMind AI

GraphMind AI turns uploaded PDFs into searchable, evidence-backed answers and an explorable knowledge graph.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 when `PORT=5000`)
- `pnpm --filter @workspace/graphmind-ai run dev` — run the Vite frontend (port 5173 by default; proxies `/api` to `API_URL`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Copy `.env.example` to `.env` and provide the required values for PostgreSQL, Replit OIDC, and Replit Object Storage.
- `OPENAI_API_KEY` is optional; without it, chat uses the explicitly-labelled document-grounded demo search fallback.

For local development, run the API and frontend in separate terminals with `PORT=5000`, `VITE_PORT=5173`, `BASE_PATH=/`, and `API_URL=http://localhost:5000`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend shell and routes: `artifacts/graphmind-ai/src/App.tsx`
- Frontend theme/layout: `artifacts/graphmind-ai/src/{index.css,app.css,app-pages.css,feature.css}`
- API routes: `artifacts/api-server/src/routes`
- PDF processing and retrieval: `artifacts/api-server/src/lib/graphmind-processing.ts`
- Database queries: `artifacts/api-server/src/lib/graphmind-data.ts`
- Database schema: `lib/db/src/schema`
- API contract: `lib/api-spec/openapi.yaml`

## Architecture decisions

- Browser authentication uses Replit OIDC with server-side sessions stored in PostgreSQL.
- PDF uploads use Replit Object Storage signed URLs; the API validates the stored object before processing.
- Retrieval is local lexical ranking over page-preserving chunks, so the MVP remains usable without an LLM key.
- Optional OpenAI generation receives only retrieved document evidence; citations remain controlled by the API.
- Example graph content is labelled as illustrative and is never mixed with stored document evidence.

## Product

Users sign in, upload PDFs, inspect processing status, ask grounded questions across processed documents, verify page-level evidence, explore extracted concepts and relationships, and review analytics/history.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- OIDC callback URLs must be registered/configured for the actual public development origin.
- Local HTTP uses non-secure cookies; HTTPS/Replit deployments automatically use secure cookies.
- PDF upload and processing require Replit Object Storage variables; a database alone is not sufficient.
- Scanned PDFs without selectable text are rejected with an OCR-required status.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
