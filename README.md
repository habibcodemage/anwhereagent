# Codebase Investigator

Paste a public GitHub URL, ask questions in plain English, get answers grounded in specific files and line ranges. Every non-trivial answer ships with an **independent audit** from a different model in a different context — not same-prompt self-scoring.

## Architecture

```
apps/web        Next.js 15 — chat UI + thin proxy route handlers
apps/worker     NestJS — agent loop, auditor, repo tools, SSE stream
packages/shared Zod schemas for SSE events + DTOs (worker ↔ web)
docker-compose  Redis (sessions + repo cache)
```

The worker is split out from Next.js because the agent loop is long-running and stateful — Vercel-style serverless functions are the wrong shape. Next.js handles the UI and proxies to the worker over HTTP/SSE.

**Streaming model:** Server-Sent Events from worker → Next.js → browser. One-way is enough; the user posts a question and watches tokens, tool calls, the final answer, and the audit verdict stream back. No WebSocket needed. No queue needed (the user is waiting; the work is interactive).

**Auditor independence:** The auditor runs as a separate Anthropic call, on a different model (Haiku), with its own system prompt and its own conversation context. It re-reads the cited files itself before deciding `trustworthy | shaky | wrong`. This satisfies the brief's hard rule: the audit comes from somewhere else.

## Run it

Prerequisites: Node 22, pnpm 10, Docker, ripgrep (`brew install ripgrep`), an Anthropic API key.

```bash
cp .env.example .env       # then put your real ANTHROPIC_API_KEY in .env
pnpm install
pnpm --filter @investigator/shared build
pnpm redis:up              # Redis on :6382 (avoids conflict with other local Redis)
```

Two terminals:

```bash
# terminal 1 — worker on :4000
cd apps/worker
ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ../../.env | cut -d= -f2) \
REDIS_URL=redis://localhost:6382 \
WORKER_PORT=4000 \
pnpm dev
```

```bash
# terminal 2 — web on :3000
cd apps/web
WORKER_URL=http://localhost:4000 pnpm dev
```

Open http://localhost:3000.

## API surface (worker)

- `POST /investigations` `{ repoUrl }` → `{ sessionId }` — clones the repo (cached by URL hash)
- `GET  /investigations/:id/events` — SSE stream of `SseEvent`s
- `POST /investigations/:id/ask` `{ question }` → `{ accepted: true }` — kicks off agent + auditor; results stream over the SSE channel

## SSE event shape

See [packages/shared/src/index.ts](packages/shared/src/index.ts). Event types: `session`, `status`, `token`, `tool_call`, `tool_result`, `answer`, `audit`, `error`, `done`.

## Multi-turn coherence

Conversation history is kept in Redis (`session:{id}`) as the structured turn list (question, answer, parsed citations). Each new turn replays the full history into the agent's `messages` array, and the auditor receives prior turns as a separate prompt section so it can flag contradictions.

## What's deliberately not here

- **No embeddings / semantic search.** ripgrep + read_file is enough for the example questions and keeps the agent honest about what it actually looked at.
- **No BullMQ.** The interactive shape (user is waiting, response streams) doesn't fit a queue. Add one only if cold-clone latency on big repos becomes a real problem.
- **No WebSockets.** Communication is one-way (server pushes events). SSE is simpler, works through proxies, native `EventSource` on the client.
- **No auth / rate limiting / multi-tenant isolation.** Day-one scope.
- **No streaming inside a turn.** The agent's tool-use loop emits status + tool events live, but the final answer text arrives as one block per assistant message. Token-level streaming is straightforward to add (`client.messages.stream`) if needed.

## Smoke-tested

- `docker compose up redis` on a remapped port (6382 — your existing 6379 stays untouched)
- Worker boot (`dist/main.js`) with all three routes mapped
- `POST /investigations` against `https://github.com/expressjs/express.git` → clone succeeds, session lands in Redis
- SSE channel: `status` event arrives within 500ms of `POST /ask`, errors propagate cleanly when the upstream Anthropic call rejects

## Layout

```
apps/worker/src
├── main.ts                     bootstrap
├── app.module.ts               DI wiring
├── investigation/
│   └── investigation.controller.ts   3 routes
├── stream/stream.hub.ts        per-session rxjs Subject<SseEvent>
├── session/session.service.ts  Redis-backed conversation state
├── repo/
│   ├── repo.service.ts         shallow clone, cache by URL hash
│   └── tools.service.ts        list_dir / read_file / grep — sandboxed to repo root
├── agent/agent.service.ts      Claude tool-use loop (Sonnet)
└── auditor/auditor.service.ts  Independent verifier (Haiku)
```
