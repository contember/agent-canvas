# @fabrika/canvas-kernel

The reusable half of [Agent Canvas](https://github.com/contember/agent-canvas): a
host-agnostic SDK for building annotatable, agent-driven canvases.

Ships as **TypeScript sources**, not a build artifact. It is written for Bun and
consumed by bundlers, so a host typechecks the kernel under its own flags and can
read every line it depends on.

## Rings

A host takes only the rings it needs. Each has its own entry point, and the
entries are ordered by how much they assume:

| Entry | What it holds | Assumes |
|---|---|---|
| `@fabrika/canvas-kernel/daemon` | WebSocket channel, CLI waiter, process lifecycle, router, paths | Nothing about canvases |
| `@fabrika/canvas-kernel/annotate` | Annotation state and drafts, list + draft footer, editor and popovers, locator strategies (text, block, region), `renderAnnotation` | A DOM |
| `@fabrika/canvas-kernel/server` | JSX compiler, session/revision store, watcher, the canvas WS vocabulary | A canvas |
| `@fabrika/canvas-kernel/client` | The annotation ring plus `PlanRenderer`, `AnnotationSidebar`, `generateMarkdown`, revision contexts, component library | A canvas |

Taking `/daemon` alone costs nothing at runtime — no canvas code is reachable
from it.

## Example: a daemon that is not a canvas

```ts
import { createNotificationChannel, browserFrame } from '@fabrika/canvas-kernel/daemon'

const channel = createNotificationChannel({
  roleOf: (ws) => ws.data.role,      // 'browser' | 'wait'
  topicOf: (ws) => ws.data.sessionId,
  waiterPolicy: 'keep-open',
  frames: [
    browserFrame(isSubmit, async (frame, topic) => {
      topic.relayToWaiters(frame)
    }),
  ],
})

Bun.serve({ fetch: handler, websocket: channel.handlers })
```

The channel knows about two socket roles keyed by an opaque topic string. The
frame vocabulary is the host's — the kernel never learns what a "submission" is.

## Annotation locators

An annotation points at something via an `AnnotationTarget<L>`, a strategy that
owns one locator shape end to end:

```ts
export interface AnnotationTarget<L extends object> {
  readonly kind: string
  parse(snippet: string): L | null
  format(locator: L): string
  find(locator: L, root: ParentNode): HTMLElement | null
  restore?(locator: L, root: HTMLElement, ann: TargetAnnotation): void
  describe?(locator: L): string
}
```

Three ship: text ranges, document blocks, and rectangular regions of an image.
Creation and lookup read the same selector, so an annotation minted where the
lookup does not scan is not expressible.

## Versioning

Released in lockstep with the `agent-canvas` package — same repository, same
commit, same version number. Pin exactly.

## License

MIT
