/**
 * Calculate popover position relative to an anchor element.
 * If a scroll container is provided, returns absolute position within it.
 * Otherwise returns fixed position.
 */
export function getPopoverPosition(
  anchor: HTMLElement,
  scrollContainer?: HTMLElement | null,
): { style: Record<string, string>; parent: HTMLElement } {
  const popoverWidth = 280;
  const gap = 8;

  if (scrollContainer) {
    const anchorRect = anchor.getBoundingClientRect();
    const parentRect = scrollContainer.getBoundingClientRect();
    const top = anchorRect.bottom - parentRect.top + scrollContainer.scrollTop + gap;
    const left = Math.max(0, Math.min(anchorRect.left - parentRect.left, parentRect.width - popoverWidth - 12));
    scrollContainer.style.position = "relative";
    return {
      style: { position: "absolute", top: `${top}px`, left: `${left}px` },
      parent: scrollContainer,
    };
  }

  const anchorRect = anchor.getBoundingClientRect();
  return {
    style: {
      position: "fixed",
      top: `${anchorRect.bottom + gap}px`,
      left: `${Math.min(anchorRect.left, window.innerWidth - popoverWidth - 20)}px`,
    },
    parent: document.body,
  };
}
