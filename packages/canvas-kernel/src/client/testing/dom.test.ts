import { describe, expect, test } from "bun:test";
import { markIds, mountContainer, selectText } from "./dom";

// The harness is the seam every DOM test in the kernel builds on, so it carries
// its own check: if these fail, no other client test result means anything.

describe("dom harness", () => {
  test("registers a document", () => {
    expect(typeof document).toBe("object");
    expect(typeof document.createRange).toBe("function");
    expect(typeof document.createTreeWalker).toBe("function");
  });

  test("mountContainer replaces what the previous test left behind", () => {
    mountContainer("<p>first</p>");
    const second = mountContainer("<p>second</p>");
    expect(second.textContent).toBe("second");
    expect(document.body.querySelectorAll("p")).toHaveLength(1);
  });

  test("selectText spans exactly the requested text", () => {
    const container = mountContainer("<p>the quick brown fox</p>");
    expect(selectText(container, "quick brown").toString()).toBe("quick brown");
  });

  test("selectText finds text nested below the root", () => {
    const container = mountContainer("<div><section><p>deep <b>target</b> here</p></section></div>");
    expect(selectText(container, "target").toString()).toBe("target");
  });

  test("selectText throws on a fixture typo instead of returning nothing", () => {
    const container = mountContainer("<p>present</p>");
    expect(() => selectText(container, "absent")).toThrow(/absent/);
  });

  test("markIds reports annotated elements in document order", () => {
    const container = mountContainer(
      `<p><mark data-annotation-id="b">x</mark> <mark data-annotation-id="a">y</mark></p>`,
    );
    expect(markIds(container)).toEqual(["b", "a"]);
  });

  test("markIds is empty when nothing is annotated", () => {
    expect(markIds(mountContainer("<p>plain</p>"))).toEqual([]);
  });
});
