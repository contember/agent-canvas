# @fabrika/annotations

React annotation state, text/block/image-region locators, editors, popovers and
markdown serialization. No Bun runtime, canvas compiler, revision store or
question/response state is required. Preact hosts can map React imports to
`preact/compat`.

## State and persistence

```tsx
import { AnnotationProvider, AnnotationHostContext, useAnnotations } from "@fabrika/annotations";
import type { AnnotationState } from "@fabrika/annotations";

const drafts = new Map<string, AnnotationState>();
const loadState = async (scope: string) => drafts.get(scope) ?? null;
const saveState = (scope: string, state: AnnotationState) => { drafts.set(scope, state); };

function Notes() {
  const { generalNote, setGeneralNote } = useAnnotations();
  return <textarea value={generalNote} onChange={(event) => setGeneralNote(event.currentTarget.value)} />;
}

export function Review() {
  return (
    <AnnotationHostContext.Provider value={{ sessionId: "review", isShared: false, fsAvailable: false, uploadUrl: null }}>
      <AnnotationProvider scope="review:image-1" loadState={loadState} saveState={saveState}>
        <Notes />
      </AnnotationProvider>
    </AnnotationHostContext.Provider>
  );
}
```

`scope` identifies one draft. Changing it resets the draft and cancels stale loads.
The host supplies stable `loadState` and `saveState` callbacks. Persisted state
contains only `annotations` and `generalNote`; remote annotations are merged for
display but are not saved as local annotations.

Hosts with their own persistence coordinator can use `useAnnotationState` with
controlled state and provide its result through `AnnotationCtx.Provider`.

`AnnotationHost` declares upload and file capabilities. It does not load canvas
modules. `findAnnotationElement(annotation, root)` accepts a host-selected DOM
root. The optional `canvasFile` annotation metadata is retained for existing
serialized records; this package does not interpret canvas navigation or revisions.

## Bundling and styles

An annotation locator implements `AnnotationTarget<L>`: `parse`, `format` and
`find`, with optional `restore` and `describe`. Text, document blocks and image
regions are included. Creation and lookup must use the same selector.

For one browser bundle, import the package normally. For multiple independently
built bundles, externalize `@fabrika/annotations/runtime` in **all** of them and
map it to one shared runtime bundle. That module owns annotation, session and host
contexts. Never inline a second copy into the components bundle.

Import `@fabrika/annotations/styles.css` into a Tailwind v4 stylesheet to scan the
surface classes. The host supplies theme tokens; the canvas kernel provides its
own theme through `@fabrika/canvas-kernel/styles.css`.
