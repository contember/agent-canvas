// @fabrika/canvas-kernel/annotate — the annotation surface.
//
// Ring 2: collecting a reader's notes on something, and getting them back out
// as markdown an agent can act on. What a note points at is a locator strategy
// (text, block, image region), so a host annotates its own kind of thing by
// writing one target; the list, the editor, the draft and the markdown do not
// change. Grouping, headings and navigation stay with the host — this ring has
// no taxonomy of its own.
//
// Not yet a severed dependency: `AnnotationProvider` still imports the canvas
// response-pruning from `generateMarkdown`, so a bundle built off this entry
// carries that along. The export list is the API statement; the import graph
// has one edge left to cut.

// --- Annotation state ------------------------------------------------------
export { AnnotationProvider } from "./src/client/AnnotationProvider";
export type { PersistedState } from "./src/client/AnnotationProvider";
export { useAnnotations, AnnotationCtx, SessionContext } from "./src/client/runtime";
export type {
  Annotation,
  AnnotationAttachment,
  AnnotationAuthor,
  AnnotationContext,
  AnnotationContextValue,
} from "./src/client/runtime";
export {
  annotationDraftKey,
  carryUnsubmittedDraft,
  clearPersistedDraft,
} from "./src/client/annotationDraft";
export type { AnnotationDraftPhase } from "./src/client/annotationDraft";

// --- Surface ---------------------------------------------------------------
export { AnnotationList } from "./src/client/AnnotationList";
export type { AnnotationListProps } from "./src/client/AnnotationList";
export { AnnotationDraftFooter } from "./src/client/AnnotationDraftFooter";
export type { AnnotationDraftFooterProps } from "./src/client/AnnotationDraftFooter";
export { AnnotationEditor, imageToUrl } from "./src/client/AnnotationEditor";
export { Popover, AnnotationPopover, AnnotationCreatePopover, AnnotationEditPopover } from "./src/client/Popover";

// --- Drawing ---------------------------------------------------------------
export { useTextAnnotation } from "./src/client/useTextAnnotation";
export { useRegionAnnotation } from "./src/client/useRegionAnnotation";

// --- Locator strategies ----------------------------------------------------
export { sealTarget } from "./src/client/annotationTarget";
export type { AnnotationTarget, SealedAnnotationTarget, TargetAnnotation } from "./src/client/annotationTarget";
export { blockTarget } from "./src/client/blockTarget";
export type { BlockLocator } from "./src/client/blockTarget";
export { textTarget } from "./src/client/textTarget";
export type { TextLocator } from "./src/client/textTarget";
export {
  createRegionOverlay,
  describeRegion,
  findRegionHost,
  isDrawableRegion,
  regionBetween,
  regionPointIn,
  regionStyle,
  regionTarget,
  REGION_HOST_ATTR,
  REGION_UNITS,
} from "./src/client/regionTarget";
export type { RegionBox, RegionLocator, RegionPoint, RegionShape } from "./src/client/regionTarget";
export {
  ANNOTATION_TARGETS,
  ANNOTATABLE_SELECTOR,
  BLOCK_SELECTOR,
  describeSnippet,
  findAnnotationElement,
  findSnippetElement,
  getBlockSnippet,
  restoreAnnotationTargets,
} from "./src/client/annotationDom";

// --- Marks -----------------------------------------------------------------
export {
  restoreMarks,
  renameMarkId,
  setMarkActive,
  unwrapMarks,
  updateAllMarkStates,
  wrapRangeWithMark,
} from "./src/client/highlightRange";

// --- Feedback out ----------------------------------------------------------
export { renderAnnotation } from "./src/client/annotationMarkdown";
export type { RenderableAnnotation } from "./src/client/annotationMarkdown";
export { extractContext, formatSnippetInContext } from "./src/client/annotationContext";

// --- Host-provided context -------------------------------------------------
export { CanvasHostContext, localCanvasHost, useCanvasHost } from "./src/client/hostContext";
export type { CanvasHost } from "./src/client/hostContext";
export { autoResizeTextarea, fileAnnotationPath, generateAnnotationId, hostAcceptsUploads } from "./src/client/utils";
