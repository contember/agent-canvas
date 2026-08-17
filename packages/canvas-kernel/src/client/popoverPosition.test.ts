// The harness registers the DOM globals, so it has to be evaluated first.
import { mountContainer } from "./testing/dom";
import { describe, expect, test } from "bun:test";
import { getPopoverPosition } from "./popoverPosition";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** happy-dom runs no layout, so geometry only exists where a test puts it. */
function stubRect(el: HTMLElement, box: Box): void {
  const rect = new DOMRect(box.left, box.top, box.width, box.height);
  el.getBoundingClientRect = () => rect;
}

function element(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`fixture is missing ${selector}`);
  return found;
}

/** A scroll container with an anchor inside it, both carrying viewport rects. */
function inContainer(parentBox: Box, anchorBox: Box): { parent: HTMLElement; anchor: HTMLElement } {
  const container = mountContainer(`<div data-testid="scroll"><span data-testid="anchor">anchor</span></div>`);
  // Page scroll is process-wide state, so every fixture starts from a known one.
  window.scrollTo(0, 0);
  const parent = element(container, `[data-testid="scroll"]`);
  const anchor = element(container, `[data-testid="anchor"]`);
  parent.scrollTop = 0;
  stubRect(parent, parentBox);
  stubRect(anchor, anchorBox);
  return { parent, anchor };
}

/** The same, for the fallback case where the popover is portaled into the body. */
function inBody(bodyBox: Box, anchorBox: Box): HTMLElement {
  const container = mountContainer(`<span data-testid="anchor">anchor</span>`);
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.body.style.position = "";
  stubRect(document.body, bodyBox);
  const anchor = element(container, `[data-testid="anchor"]`);
  stubRect(anchor, anchorBox);
  return anchor;
}

describe("getPopoverPosition", () => {
  test("drops the popover one gap below the anchor, in the parent's coordinates", () => {
    const { parent, anchor } = inContainer(
      { left: 50, top: 100, width: 1000, height: 400 },
      { left: 150, top: 200, width: 60, height: 20 },
    );

    // 220 (anchor bottom) - 100 (parent top) + 8 (gap); 150 - 50 horizontally.
    expect(getPopoverPosition(anchor, parent).style).toEqual({
      position: "absolute",
      top: "128px",
      left: "100px",
    });
  });

  test("adds the container's own scroll, never the page's", () => {
    const { parent, anchor } = inContainer(
      { left: 0, top: 0, width: 1000, height: 400 },
      { left: 100, top: 80, width: 50, height: 20 },
    );
    parent.scrollTop = 40;
    // Both rects already move with page scroll, so counting it again would double it.
    window.scrollTo(0, 500);

    expect(getPopoverPosition(anchor, parent).style.top).toBe("148px");
  });

  test("clamps left so a right-edge anchor keeps the popover inside the parent", () => {
    const { parent, anchor } = inContainer(
      { left: 0, top: 0, width: 400, height: 300 },
      { left: 300, top: 50, width: 40, height: 20 },
    );

    // 400 - 280 (popover) - 12 (margin) is as far right as it may start.
    expect(getPopoverPosition(anchor, parent).style.left).toBe("108px");
  });

  test("clamps left to zero for an anchor scrolled past the parent's left edge", () => {
    const { parent, anchor } = inContainer(
      { left: 200, top: 0, width: 1000, height: 400 },
      { left: 140, top: 40, width: 50, height: 20 },
    );

    expect(getPopoverPosition(anchor, parent).style.left).toBe("0px");
  });

  test("pins left at zero when the parent is narrower than the popover", () => {
    const { parent, anchor } = inContainer(
      { left: 0, top: 0, width: 200, height: 200 },
      { left: 20, top: 10, width: 30, height: 10 },
    );

    // The right bound goes negative here; overflowing right beats a negative left.
    expect(getPopoverPosition(anchor, parent).style.left).toBe("0px");
  });

  test("falls back to the body when the caller has no scroll container", () => {
    const anchor = inBody(
      { left: 0, top: 0, width: 800, height: 2000 },
      { left: 100, top: 300, width: 50, height: 20 },
    );

    expect(getPopoverPosition(anchor).parent).toBe(document.body);
    expect(getPopoverPosition(anchor, null).parent).toBe(document.body);
    expect(getPopoverPosition(anchor).style.top).toBe("328px");
  });

  test("ignores body.scrollTop — the body is not what scrolls a document", () => {
    const anchor = inBody(
      { left: 0, top: 0, width: 800, height: 2000 },
      { left: 100, top: 300, width: 50, height: 20 },
    );
    document.body.scrollTop = 250;

    expect(getPopoverPosition(anchor).style.top).toBe("328px");
  });

  test("makes the parent a positioning context, or the offsets mean nothing", () => {
    const { parent, anchor } = inContainer(
      { left: 0, top: 0, width: 1000, height: 400 },
      { left: 10, top: 20, width: 30, height: 10 },
    );
    parent.style.position = "";

    getPopoverPosition(anchor, parent);
    expect(parent.style.position).toBe("relative");
  });

  test("makes the body a positioning context too when it is the fallback", () => {
    const anchor = inBody(
      { left: 0, top: 0, width: 800, height: 2000 },
      { left: 10, top: 20, width: 30, height: 10 },
    );

    getPopoverPosition(anchor);
    expect(document.body.style.position).toBe("relative");
  });
});
