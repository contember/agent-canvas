# @fabrika/daemon-kit

Bun daemon infrastructure without canvas or browser dependencies:

- `createNotificationChannel`, `browserFrame`: topic-based WebSocket routing.
- `waitForEvent`, `WaitError`: CLI waiting, reconnects and deadlines.
- `createDaemonLifecycle`, `DaemonStartError`: process startup, health and shutdown.
- `dispatch`, `Route`: HTTP routing.
- `jsonResponse`, `corsHeaders`: HTTP response helpers.

Import runtime functions and types from `@fabrika/daemon-kit`.
The host supplies its domain-specific frame vocabulary and persistence.
Canvas session/compile/upload paths remain in `@fabrika/canvas-kernel/server`.
