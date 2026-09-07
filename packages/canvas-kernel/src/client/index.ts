export { AnnotationProvider } from "./AnnotationProvider";
export type { PersistedState } from "./AnnotationProvider";
// Canvas documents and the shell must read the same external context instance.
export {
  useAnnotations, useFeedback, useCanvasFile, useResponseRegistration,
  AnnotationCtx, SessionContext, ActiveViewCtx, CanvasFileCtx,
} from "#canvas/runtime";
export type {
  Annotation, AnnotationAttachment, AnnotationAuthor, AnnotationContext,
  AnnotationContextValue, ActiveView, FeedbackEntry, PlanResponse,
} from "#canvas/runtime";
export { AnnotationSidebar } from "./AnnotationSidebar";
export { PlanRenderer } from "./PlanRenderer";
export { ResponsePreview, MarkdownPreview } from "./ResponsePreview";
export { FileIcon } from "./FileIcon";
export * as components from "./components";
export { CanvasHostContext, localCanvasHost, useCanvasHost } from "./hostContext";
export type { CanvasHost } from "./hostContext";
export { ActiveViewContext, RevisionContext } from "./appContext";
export type { CanvasFileInfo, RevisionInfo } from "./appContext";
export { RenderErrorContext } from "./RenderErrorContext";
export type { CanvasRenderError } from "./RenderErrorContext";
export { findAnnotationElement, scrollToAnnotation } from "./annotationDom";
export { annotationDraftKey, carryUnsubmittedDraft, clearPersistedDraft } from "./annotationDraft";
export type { AnnotationDraftPhase } from "./annotationDraft";
export {
  canPruneResponses, generateMarkdown, getMissingRequired, getMissingRequiredFeedback,
  getMissingRequiredLabels, hasValue, pruneStaleResponses,
} from "./generateMarkdown";
