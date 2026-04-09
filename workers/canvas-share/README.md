# canvas-share

Cloudflare Worker that hosts shared agent-canvas snapshots.

## Architecture

- **R2 (`BLOBS`)** stores share payloads, compiled canvas JS, JSX source, and reviewer-uploaded annotation images.
- **KV (`FEEDBACK`)** stores individual feedback entries (sortable keys for `since` queries) and rate limit counters (TTL 120s).
- **Static assets (`ASSETS`)** serve runtime bundles (`runtime.js`, `components.js`, `preact-compat.js`, `client.js`, `client.css`) — these are mirrored from `daemon/dist/` automatically by `bun run build`.

Validation is enforced with [Zod](https://zod.dev). Limits are centralized in [`src/types.ts`](src/types.ts).

## Local development

```bash
cd workers/canvas-share
bun install

# Build daemon bundles AND auto-copy them into ./public/assets
cd ../..
bun run build

# Start the worker locally via Miniflare (no Cloudflare account needed)
cd workers/canvas-share
npx wrangler dev --local --port 19402

# Point the daemon at it
cd ../..
CANVAS_SHARE_ENDPOINT=http://127.0.0.1:19402 bun bin/agent-canvas.ts daemon restart
```

Then click **Share** on any revision in the canvas UI.

## Testing

```bash
cd workers/canvas-share
bun test            # unit tests for validation, util
bunx tsc --noEmit   # typecheck
```

## Production deploy

1. Create R2 bucket and KV namespace:
   ```bash
   npx wrangler r2 bucket create canvas-share-blobs
   npx wrangler kv namespace create FEEDBACK
   ```
   Paste the KV namespace id into `wrangler.toml` under `[[kv_namespaces]]`.

2. (Recommended) Generate a shared bearer token to gate share creation:
   ```bash
   openssl rand -hex 32 | npx wrangler secret put SHARE_AUTH_TOKEN
   ```
   Without this, anyone on the internet can pump shares into your R2 bucket.
   Set the same value as `CANVAS_SHARE_AUTH_TOKEN` on the daemon side.

3. (Optional) Override default 30-day share expiration:
   ```bash
   echo "604800" | npx wrangler secret put SHARE_TTL_SECONDS  # 7 days
   ```

4. Build daemon bundles + deploy:
   ```bash
   cd ../..
   bun run build
   cd workers/canvas-share
   npx wrangler deploy
   ```

5. Configure the daemon:
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
