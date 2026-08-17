// @fabrika/canvas-kernel/client — the reusable annotation surface.
//
// Everything a host needs to render a compiled canvas and collect feedback on
// it, minus the app shell (navigation, file browser, revision chrome), which
// each host builds itself.

// --- Annotation state ------------------------------------------------------
// Everything that lives in runtime.ts is re-exported through `#canvas/runtime`,
// never through a relative path. The runtime holds the React contexts and ships
// as its own bundle shared with the compiled canvas; importing it relatively
// would bundle a second copy, and the provider and its consumers would then be
// writing to and reading from different contexts.
export { AnnotationProvider } from "./AnnotationProvider";
export type { PersistedState } from "./AnnotationProvider";
export {
  useAnnotations,
  useFeedback,
  useCanvasFile,
  useResponseRegistration,
  AnnotationCtx,
  SessionContext,
  ActiveViewCtx,
  CanvasFileCtx,
} from "#canvas/runtime";
export type {
  Annotation,
  AnnotationAttachment,
  AnnotationAuthor,
  AnnotationContext,
  AnnotationContextValue,
  ActiveView,
  FeedbackEntry,
  PlanResponse,
} from "#canvas/runtime";

// --- Surface ---------------------------------------------------------------
export { AnnotationSidebar } from "./AnnotationSidebar";
export { AnnotationEditor, imageToUrl } from "./AnnotationEditor";
export { PlanRenderer } from "./PlanRenderer";
export { Popover, AnnotationPopover, AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";
export { ResponsePreview, MarkdownPreview } from "./ResponsePreview";
export { FileIcon } from "./FileIcon";

/** The kernel component set, as a namespace for hosts that inject it wholesale. */
export * as components from "./components";
export { useTextAnnotation } from "./useTextAnnotation";

// --- Host-provided context -------------------------------------------------
export { CanvasHostContext, localCanvasHost, useCanvasHost } from "./hostContext";
export type { CanvasHost } from "./hostContext";
export { ActiveViewContext, RevisionContext } from "./appContext";
export type { CanvasFileInfo, RevisionInfo } from "./appContext";
export { RenderErrorContext } from "./RenderErrorContext";
export type { CanvasRenderError } from "./RenderErrorContext";

// --- Annotation plumbing ---------------------------------------------------
export { extractContext, formatSnippetInContext } from "./annotationContext";
export { findAnnotationElement, scrollToAnnotation } from "./annotationDom";
export {
  annotationDraftKey,
  carryUnsubmittedDraft,
  clearPersistedDraft,
} from "./annotationDraft";
export type { AnnotationDraftPhase } from "./annotationDraft";
export {
  restoreMarks,
  renameMarkId,
  setMarkActive,
  unwrapMarks,
  updateAllMarkStates,
  wrapRangeWithMark,
} from "./highlightRange";
export {
  canPruneResponses,
  generateMarkdown,
  getMissingRequired,
  getMissingRequiredFeedback,
  getMissingRequiredLabels,
  hasValue,
  pruneStaleResponses,
} from "./generateMarkdown";
export { autoResizeTextarea, fileAnnotationPath, generateAnnotationId, RESPONSE_ANNOTATION_PATH } from "./utils";
