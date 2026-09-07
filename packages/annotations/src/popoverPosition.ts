/** Width assumed when the caller does not say — the narrow popover. */
const DEFAULT_POPOVER_WIDTH = 280;

/**
 * Read a CSS width the popover will be styled with. Only px is a width this
 * placement can reason about; anything else falls back to the default rather
 * than clamping against a number that means something different.
 */
export function pxWidth(css: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(css.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * Calculate popover position relative to an anchor element.
 * Returns absolute position within the scroll container (or body).
 */
export function getPopoverPosition(
  anchor: HTMLElement,
  scrollContainer?: HTMLElement | null,
  popoverWidth: number = DEFAULT_POPOVER_WIDTH,
): { style: Record<string, string>; parent: HTMLElement } {
  const gap = 8;
  const parent = scrollContainer || document.body;

  // Use getBoundingClientRect for both anchor and parent,
  // then add scroll offsets to get absolute position within parent
  const anchorRect = anchor.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  // Both rects are viewport-relative, so the subtraction has already cancelled
  // page scroll. Only a scrolling parent adds to that — the body is not what
  // scrolls a document, and counting window.scrollY here counted it twice.
  const scrollTop = parent === document.body ? 0 : parent.scrollTop;
  const top = anchorRect.bottom - parentRect.top + scrollTop + gap;

  // Horizontal: clamp to parent width
  const left = Math.max(0, Math.min(anchorRect.left - parentRect.left, parentRect.width - popoverWidth - 12));

  parent.style.position = "relative";

  return {
    style: { position: "absolute", top: `${top}px`, left: `${left}px` },
    parent,
  };
}
