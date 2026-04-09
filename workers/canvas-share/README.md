# canvas-share

Cloudflare Worker that hosts shared agent-canvas snapshots.

## Architecture

- **R2 (`BLOBS`)** stores share payloads, compiled canvas JS, JSX source, and reviewer-uploaded annotation images.
- **KV (`FEEDBACK`)** stores individual feedback entries (sortable keys for `since` queries) and rate limit counters (TTL 120s).
- **Static assets (`ASSETS`)** serve runtime bundles (`runtime.js`, `components.js`, `preact-compat.js`, `client.js`, `client.css`) — these are mirrored from `daemon/dist/` automatically by `bun run build`.

Validation is enforced with [Zod](https://zod.dev). Limits are centralized in [`src/types.ts`](src/types.ts).

## Infrastructure as code

The Cloudflare config is defined programmatically in [`oblaka.ts`](oblaka.ts)
using [`oblaka-iac`](https://github.com/contember/oblaka). The committed
[`oblaka.ts`](oblaka.ts) is the source of truth; `wrangler.jsonc` is
auto-generated and **gitignored** — never edit it by hand.

| Command | Generates | Used for |
|---|---|---|
| `bun run oblaka` | `wrangler.jsonc` (env `local`) | local dev via Miniflare |
| `bun run oblaka:stage` | `wrangler.jsonc` (env `stage`) | staging deploy |
| `bun run oblaka:prod` | `wrangler.jsonc` (env `prod`) | production deploy |

`oblaka-iac` auto-prefixes R2 bucket and KV namespace names with the env
(e.g. `canvas-share-blobs` becomes `stage-canvas-share-blobs`) so the same
config produces isolated stage and prod resources.

## Local development

```bash
cd workers/canvas-share
bun install

# Build daemon bundles AND auto-copy them into ./public/assets
cd ../..
bun run build

# Start the worker locally via Miniflare (no Cloudflare account needed).
# `bun run dev` runs `oblaka` first to regenerate wrangler.jsonc, then
# starts wrangler dev --local.
cd workers/canvas-share
bun run dev

# Point the daemon at it
cd ../..
CANVAS_SHARE_ENDPOINT=http://127.0.0.1:8787 bun bin/agent-canvas.ts daemon restart
```

Then click **Share** on any revision in the canvas UI.

## Testing

```bash
cd workers/canvas-share
bun test            # unit tests for validation, util
bun run typecheck   # typecheck src/
```

## Production deploy

1. (Recommended) Generate a shared bearer token to gate share creation:
   ```bash
   openssl rand -hex 32 | bunx wrangler secret put SHARE_AUTH_TOKEN --env prod
   ```
   Without this, anyone on the internet can pump shares into your R2 bucket.
   Set the same value as `CANVAS_SHARE_AUTH_TOKEN` on the daemon side.

2. (Optional) Override default 30-day share expiration:
   ```bash
   echo "604800" | bunx wrangler secret put SHARE_TTL_SECONDS --env prod  # 7 days
   ```

3. Build daemon bundles + deploy. The deploy script regenerates
   `wrangler.jsonc` for the target env, then runs `wrangler deploy`.
   The R2 bucket and KV namespace are created automatically by oblaka
   on first deploy:
   ```bash
   cd ../..
   bun run build
   cd workers/canvas-share
   bun run deploy:prod   # or deploy:stage
   ```

4. Configure the daemon:
   ```bash
   export CANVAS_SHARE_ENDPOINT=https://canvas-share.<subdomain>.workers.dev
   export CANVAS_SHARE_AUTH_TOKEN=<the token you generated>
   bunx agent-canvas daemon restart
   ```

The Share button in the canvas UI lights up once the daemon sees `CANVAS_SHARE_ENDPOINT`.

## Endpoints

| Method | Path                               | Purpose                                         | Auth                |
|--------|------------------------------------|-------------------------------------------------|---------------------|
| GET    | `/health`                          | Health check                                    | none                |
| POST   | `/shares`                          | Create a new share                              | `SHARE_AUTH_TOKEN`  |
| POST   | `/shares/:shareId/revoke`          | Revoke / delete a share                         | `ownerToken`        |
| GET    | `/shares/:shareId/feedback?since=` | List feedback entries (called by daemon poller) | none (capability)   |
| GET    | `/s/:shareId`                      | HTML shell for reviewers                        | none (capability)   |
| GET    | `/s/:shareId/meta`                 | Share metadata                                  | none                |
| GET    | `/s/:shareId/canvas/:filename`     | Serve compiled canvas JS / JSX source           | none                |
| POST   | `/s/:shareId/feedback`             | Submit feedback (called by reviewer browser)    | none                |
| POST   | `/s/:shareId/upload`               | Upload annotation image                         | none                |
| GET    | `/s/:shareId/uploads/:filename`    | Serve uploaded image                            | none                |

## Rate limits

Per-IP, per-minute, sliding window (KV-backed). Tweak in [`src/types.ts`](src/types.ts).

| Bucket          | Limit |
|-----------------|-------|
| Share creation  | 5/min |
| Feedback POST   | 20/min/share |
| Upload          | 30/min/share |

## Security model

- **Capability URLs** — anyone with `/s/:shareId` (24-char hex, ~96 bits entropy) has full view+comment access. Brute-forcing is impractical.
- **Owner token** — returned to the daemon at create time, required to revoke. Stored in the daemon's session metadata so the canvas author can revoke from the Share dialog.
- **Optional shared bearer token** (`SHARE_AUTH_TOKEN`) — gates share creation so only authorized daemons can push to the worker.
- **No reviewer auth** — reviewers self-report a name (stored locally in their browser), there is no signup. Suitable for "send to a colleague" flows, **not** public publishing.
- **Per-share TTL** — defaults to 30 days. Expired shares 404 and are eventually purged by KV's TTL.
- **Size limits** — share payload max 2 MB, feedback body max 256 KB, image upload max 5 MB.
- **Validation** — all incoming bodies are validated by Zod schemas before any storage write.
