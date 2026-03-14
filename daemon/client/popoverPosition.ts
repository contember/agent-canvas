/**
 * Calculate popover position relative to an anchor element.
 * Returns absolute position within the scroll container (or body).
 */
export function getPopoverPosition(
  anchor: HTMLElement,
  scrollContainer?: HTMLElement | null,
): { style: Record<string, string>; parent: HTMLElement } {
  const popoverWidth = 280;
  const gap = 8;
  const parent = scrollContainer || document.body;

  // Use getBoundingClientRect for both anchor and parent,
  // then add scroll offsets to get absolute position within parent
  const anchorRect = anchor.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  // Vertical: anchor bottom relative to parent top + any scroll
  const scrollTop = parent === document.body ? window.scrollY : parent.scrollTop;
  const top = anchorRect.bottom - parentRect.top + scrollTop + gap;

  // Horizontal: clamp to parent width
  const left = Math.max(0, Math.min(anchorRect.left - parentRect.left, parentRect.width - popoverWidth - 12));

  parent.style.position = "relative";

  return {
    style: { position: "absolute", top: `${top}px`, left: `${left}px` },
    parent,
  };
}
