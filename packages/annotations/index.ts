export { AnnotationProvider } from "./src/AnnotationProvider";
export type { AnnotationProviderProps } from "./src/AnnotationProvider";
export { useAnnotationState } from "./src/useAnnotationState";
export { AnnotationCtx, AnnotationHostContext, SessionContext, useAnnotations, useAnnotationHost } from "@fabrika/annotations/runtime";
export type {
  Annotation, AnnotationAttachment, AnnotationAuthor, AnnotationContext,
  AnnotationContextValue, AnnotationHost, AnnotationState,
} from "./src/runtime";
export { AnnotationList } from "./src/AnnotationList";
export type { AnnotationListProps } from "./src/AnnotationList";
export { AnnotationDraftFooter } from "./src/AnnotationDraftFooter";
export type { AnnotationDraftFooterProps } from "./src/AnnotationDraftFooter";
export { AnnotationEditor, ImageThumbnails, AttachButton, imageToUrl } from "./src/AnnotationEditor";
export { Popover, AnnotationPopover, AnnotationCreatePopover, AnnotationEditPopover } from "./src/Popover";
export { useTextAnnotation } from "./src/useTextAnnotation";
export { useRegionAnnotation } from "./src/useRegionAnnotation";
export { sealTarget } from "./src/annotationTarget";
export type { AnnotationTarget, SealedAnnotationTarget, TargetAnnotation } from "./src/annotationTarget";
export { blockTarget } from "./src/blockTarget";
export type { BlockLocator } from "./src/blockTarget";
export { textTarget } from "./src/textTarget";
export type { TextLocator } from "./src/textTarget";
export {
  createRegionOverlay, describeRegion, findRegionHost, isDrawableRegion,
  regionBetween, regionPointIn, regionStyle, regionTarget, REGION_HOST_ATTR, REGION_UNITS,
} from "./src/regionTarget";
export type { RegionBox, RegionLocator, RegionPoint, RegionShape } from "./src/regionTarget";
export {
  ANNOTATION_TARGETS, ANNOTATABLE_SELECTOR, BLOCK_SELECTOR, describeSnippet,
  findAnnotationElement, findSnippetElement, getBlockSnippet, restoreAnnotationTargets,
} from "./src/annotationDom";
export {
  restoreMarks, renameMarkId, setMarkActive, unwrapMarks, updateAllMarkStates,
  wrapRangeWithMark,
} from "./src/highlightRange";
export { renderAnnotation } from "./src/annotationMarkdown";
export type { RenderableAnnotation } from "./src/annotationMarkdown";
export { extractContext, formatSnippetInContext } from "./src/annotationContext";
export { autoResizeTextarea, fileAnnotationPath, generateAnnotationId, hostAcceptsUploads, RESPONSE_ANNOTATION_PATH } from "./src/utils";
