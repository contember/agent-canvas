import type { AnnotationTarget } from "./annotationTarget";
import { restoreMarks } from "./highlightRange";

/** A run of text, identified by the text itself. */
export interface TextLocator {
  text: string;
}

/**
 * Selected text, wrapped in inline `<mark>` elements.
 *
 * The fallback target: any snippet at all is text, so this one claims
 * everything the others turned down and must stay last in the registry.
 */
export const textTarget: AnnotationTarget<TextLocator> = {
  kind: "text",

  parse: (snippet) => (snippet ? { text: snippet } : null),

  format: (locator) => locator.text,

  // A run of text has no element of its own until a mark wraps it, and the mark
  // is found by annotation id, not by the text. Guessing the element back from
  // page text would resolve an annotation onto whatever happens to read the
  // same today, so a missing mark stays a miss.
  find: () => null,

  restore: (_locator, root, ann) => {
    restoreMarks(root, [ann]);
  },
};
