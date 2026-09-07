/**
 * How a snippet names something on the page.
 *
 * `Annotation.snippet` is the only field that ties an annotation to a domain —
 * everything else (draft persistence, sidebar, popover, notes, attachments,
 * markdown, submit) works on any annotation whatever it points at. A target is
 * that one tie, pulled out as a strategy: give the kernel a new target and it
 * can annotate a new kind of thing without another line changing.
 */

/** What a target may read off the annotation it resolves — DOM identity, not feedback. */
export interface TargetAnnotation {
  id: string;
  snippet: string;
  context?: { before: string; after: string; hierarchy: string[] };
}

export interface AnnotationTarget<L extends object> {
  /** Names the strategy. */
  readonly kind: string;
  /** Read a snippet this target wrote. Null means the snippet is not its own. */
  parse(snippet: string): L | null;
  /** Write the locator back into the snippet key. The exact inverse of `parse`. */
  format(locator: L): string;
  /**
   * The element the locator names, searched inside `root`. Targets whose
   * annotation lives in DOM this target itself drew — an inline mark, an
   * overlay box — return null here and are resolved by their annotation id
   * instead; see findAnnotationElement.
   */
  find(locator: L, root: ParentNode): HTMLElement | null;
  /**
   * Put this annotation's own decoration back into `root`, if it is not there
   * already. Called after every render, for every annotation, so it must be
   * idempotent and cheap on a snippet it does not own.
   */
  restore?(locator: L, root: HTMLElement, ann: TargetAnnotation): void;
  /** A one-line label a reader (or a coding agent) can act on. */
  describe?(locator: L): string;
}

/** An AnnotationTarget with its locator type sealed inside, so targets whose
 *  locators have nothing in common can share one list. */
export interface SealedAnnotationTarget {
  readonly kind: string;
  owns(snippet: string): boolean;
  find(snippet: string, root: ParentNode): HTMLElement | null;
  restore(root: HTMLElement, ann: TargetAnnotation): void;
  describe(snippet: string): string | null;
}

/** Close over the locator type, so parse and find can never be called with
 *  a locator the other one did not produce. */
export function sealTarget<L extends object>(target: AnnotationTarget<L>): SealedAnnotationTarget {
  return {
    kind: target.kind,
    owns: (snippet) => target.parse(snippet) !== null,
    find: (snippet, root) => {
      const locator = target.parse(snippet);
      return locator === null ? null : target.find(locator, root);
    },
    restore: (root, ann) => {
      const locator = target.parse(ann.snippet);
      if (locator === null) return;
      target.restore?.(locator, root, ann);
    },
    describe: (snippet) => {
      const locator = target.parse(snippet);
      if (locator === null || !target.describe) return null;
      return target.describe(locator);
    },
  };
}
