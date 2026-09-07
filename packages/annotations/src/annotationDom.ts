import type { Annotation } from "./runtime";
import { sealTarget, type SealedAnnotationTarget, type TargetAnnotation } from "./annotationTarget";
import { blockTarget } from "./blockTarget";
import { regionTarget } from "./regionTarget";
import { textTarget } from "./textTarget";

export { ANNOTATABLE_SELECTOR, BLOCK_SELECTOR, getBlockSnippet } from "./blockTarget";

// Text accepts every snippet, so more specific locators must run first.
export const ANNOTATION_TARGETS: SealedAnnotationTarget[] = [
  sealTarget(regionTarget), sealTarget(blockTarget), sealTarget(textTarget),
];

export function findSnippetElement(snippet: string, root: ParentNode): HTMLElement | null {
  for (const target of ANNOTATION_TARGETS) {
    const element = target.find(snippet, root);
    if (element) return element;
  }
  return null;
}

export function restoreAnnotationTargets(root: HTMLElement, annotations: readonly TargetAnnotation[]): void {
  for (const annotation of annotations) {
    if (!annotation.snippet) continue;
    for (const target of ANNOTATION_TARGETS) target.restore(root, annotation);
  }
}

export function describeSnippet(snippet: string): string {
  for (const target of ANNOTATION_TARGETS) {
    const described = target.describe(snippet);
    if (described !== null) return described;
  }
  return snippet;
}

export function findAnnotationElement(annotation: Annotation, root: ParentNode = document): HTMLElement | null {
  const decoration = root.querySelector(`[data-annotation-id="${CSS.escape(annotation.id)}"]`);
  return decoration instanceof HTMLElement ? decoration : findSnippetElement(annotation.snippet, root);
}
