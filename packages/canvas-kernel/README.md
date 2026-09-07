# @fabrika/canvas-kernel

The canvas SDK from [Agent Canvas](https://github.com/contember/agent-canvas).
Ships as **TypeScript sources**, not a build artifact. It is written for Bun and
consumed by bundlers, so a host typechecks it under its own flags.

Canvas-specific functionality over `@fabrika/daemon-kit` and
`@fabrika/annotations`:

| Entry | Responsibility |
| --- | --- |
| `/server` (also `.`) | JSX compilation, sessions/revisions, watcher, canvas WS protocol and paths |
| `/client` | Renderer, canvas draft persistence, responses, revision contexts, sidebar and feedback |
| `/components` | Interactive canvas component library |
| `/runtime` | Canvas contexts shared by compiled documents and the host |
| `/styles.css`, `/theme.css` | Canvas styling and theme |

## Migration from 0.1.x

- Replace `/daemon` imports with `@fabrika/daemon-kit`.
- Import daemon helpers previously reexported from `/server` directly from
  `@fabrika/daemon-kit`. `createCanvasPaths` remains canvas-specific.
- Replace `/annotate` imports with `@fabrika/annotations`.
- Import annotation UI, locator strategies, marks and utilities previously
  reexported from `/client` directly from `@fabrika/annotations`.
- The canvas `/client` `AnnotationProvider` and `PersistedState` still own
  revisions, responses and feedback entries. The standalone annotations provider
  instead takes `scope`, `loadState(scope)` and `saveState(scope, state)` and uses
  `AnnotationState` with only annotations and a general note.
- Standalone annotation hosts use `AnnotationHostContext` and `AnnotationHost`,
  without `loadCanvasModule`. Canvas hosts keep `CanvasHostContext`.
- Multi-bundle hosts must build and externalize `@fabrika/annotations/runtime`
  in addition to `#canvas/runtime`, with one import-map entry for each.

The removed entries are not compatibility reexports. All packages release in
lockstep with exact internal dependency pins.

## License

MIT
