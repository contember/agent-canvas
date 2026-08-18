import type { AnnotationTarget } from "./annotationTarget";

/**
 * A whole canvas block, identified by the text a reader sees in it.
 *
 * The hard-won invariant lives here: the selector that decides where an
 * annotation may be minted and the selector the lookup scans must be one
 * selector. An annotation minted on a block the lookup skips can never be
 * resolved again. Both now come off one table, so they cannot drift: a kind is
 * annotatable exactly when it can mint a snippet, and `getBlockSnippet` refuses
 * every block outside that set.
 */
interface BlockKind {
  /** CSS matching this kind, as the component emits it. */
  selector: string;
  /** The key a block of this kind is annotated under, or null when it is
   *  missing the attribute that identifies it. */
  snippet(block: HTMLElement): string | null;
}

/**
 * A block's text as a reader sees it. Decorative markup — the callout icon,
 * anything else marked aria-hidden — is skipped, so the glyph does not ride
 * along into the sidebar label and into feedback.md.
 */
function readableText(block: HTMLElement): string {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const hidden = node.parentElement?.closest("[aria-hidden='true']");
    if (hidden && block.contains(hidden)) continue;
    text += node.textContent ?? "";
  }
  return text.trim();
}

/** A block named by one of its attributes, e.g. `[Item] Ship the beta`. */
function byAttribute(selector: string, prefix: string, attribute: string): BlockKind {
  return {
    selector,
    snippet: (block) => {
      const value = block.getAttribute(attribute);
      return value ? `${prefix} ${value}` : null;
    },
  };
}

/** Every block an annotation can be minted on. */
const ANNOTATABLE_KINDS: BlockKind[] = [
  byAttribute("[data-md='item']", "[Item]", "data-md-label"),
  byAttribute("[data-md='section']", "[Section]", "data-md-title"),
  byAttribute("[data-md='checklist-item']", "[Checklist]", "data-md-label"),
  byAttribute("[data-md='image']", "[Image]", "data-md-src"),
  {
    selector: "[data-md='callout']",
    snippet: (block) => {
      const type = block.getAttribute("data-md-type") || "info";
      return `[Callout:${type}] ${readableText(block).slice(0, 60) || "Callout"}`;
    },
  },
  {
    selector: "[data-md='note']",
    snippet: (block) => `[Note] ${readableText(block).slice(0, 60) || "Note"}`,
  },
  {
    // Only rows of a table the canvas emitted: a table inside a markdown block
    // is not navigable, so a row annotated there could never be reached again.
    selector: "[data-md='table'] tbody tr",
    snippet: (block) => {
      const cells = Array.from(block.querySelectorAll("td")).map((td) => td.textContent?.trim()).filter(Boolean);
      return cells.length ? `[Row] ${cells.join(" | ")}` : null;
    },
  },
];

/** Blocks the arrows walk but no annotation can land on — interactive controls
 *  carry the reader's answer, not the author's text. */
const NAVIGABLE_ONLY_SELECTORS = [
  "[data-md='choice-option']",
  "[data-md='multichoice-option']",
  "[data-md='userinput']",
  "[data-md='rangeinput']",
];

/**
 * The blocks that can carry a block annotation — a strict subset of
 * BLOCK_SELECTOR, since interactive controls are navigable but not annotatable.
 */
export const ANNOTATABLE_SELECTOR = ANNOTATABLE_KINDS.map((kind) => kind.selector).join(", ");

/** Every block the keyboard arrows walk through. */
export const BLOCK_SELECTOR = [
  ...ANNOTATABLE_KINDS.map((kind) => kind.selector),
  ...NAVIGABLE_ONLY_SELECTORS,
].join(", ");

/** The snippet identifier for a block, or null if nothing can be annotated here. */
export function getBlockSnippet(block: HTMLElement): string | null {
  for (const kind of ANNOTATABLE_KINDS) {
    if (block.matches(kind.selector)) return kind.snippet(block);
  }
  return null;
}

/** A block is its own locator: the snippet is the text that identifies it. */
export interface BlockLocator {
  snippet: string;
}

export const blockTarget: AnnotationTarget<BlockLocator> = {
  kind: "block",

  // Every block snippet opens with its kind in brackets. Text that merely looks
  // like one is not stranded by claiming it: `find` compares against snippets
  // blocks actually mint, so a lookalike simply matches nothing.
  parse: (snippet) => (snippet.startsWith("[") ? { snippet } : null),

  format: (locator) => locator.snippet,

  find: (locator, root) => {
    for (const el of root.querySelectorAll(ANNOTATABLE_SELECTOR)) {
      if (!(el instanceof HTMLElement)) continue;
      if (getBlockSnippet(el) === locator.snippet) return el;
    }
    return null;
  },
};
