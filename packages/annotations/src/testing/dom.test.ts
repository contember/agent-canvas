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

  // Registering happy-dom used to swap the global fetch for a Window
  // implementation over node:http. Every test file shares one process, so that
  // reached the daemon lifecycle probes and broke them — but only when a client
  // file happened to be evaluated first, which is why it passed locally and
  // failed in CI. Assert the capability, not the identity of the function.
  test("leaves the runtime fetch stack alone", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "localhost",
      fetch: () => Response.json({ ok: true }),
    });
    try {
      const response = await fetch(`http://localhost:${server.port}/`);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      server.stop(true);
    }
  });
});
