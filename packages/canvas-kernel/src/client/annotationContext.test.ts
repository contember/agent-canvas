// The harness registers the DOM globals, so it has to be evaluated first.
import { mountContainer, selectText } from "./testing/dom";
import { describe, expect, test } from "bun:test";
import type { AnnotationContext } from "./runtime";
import { extractContext, formatSnippetInContext } from "./annotationContext";

/** Narrow a fixture lookup to an element, so a typo fails at its cause. */
function elementIn(container: HTMLElement, selector: string): HTMLElement {
  const el = container.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`fixture has no ${selector}`);
  return el;
}

function context(before: string, after: string): AnnotationContext {
  return { before, after, hierarchy: [] };
}

describe("extractContext — surrounding text", () => {
  test("captures the text on either side of the selection", () => {
    const container = mountContainer("<p>alpha beta gamma</p>");
    expect(extractContext(selectText(container, "beta"), container)).toEqual({
      before: "alpha",
      after: "gamma",
      hierarchy: [],
    });
  });

  test("does not reach outside the enclosing block", () => {
    const container = mountContainer("<p>previous paragraph</p><p>target here</p>");
    const ctx = extractContext(selectText(container, "target"), container);
    expect(ctx.before).toBe("");
    expect(ctx.after).toBe("here");
  });

  test("after is empty when the selection ends the block", () => {
    const container = mountContainer("<p>the run ends with target</p>");
    const ctx = extractContext(selectText(container, "target"), container);
    expect(ctx.before).toBe("the run ends with");
    expect(ctx.after).toBe("");
  });

  // A reader's selection sits in one text node, but the sentence around it is
  // usually split by inline markup.
  test("reads across inline elements within the block", () => {
    const container = mountContainer("<p>plain <b>bold</b> target <i>ital</i> end</p>");
    const ctx = extractContext(selectText(container, "target"), container);
    expect(ctx.before).toBe("plain bold");
    expect(ctx.after).toBe("ital end");
  });

  // restoreMarks matches context against a text index that excludes marked
  // text, so the context recorded here must exclude it too.
  test("skips text already wrapped in an annotation mark", () => {
    const container = mountContainer(
      `<p>keep<mark data-annotation-id="a1"> dropped words</mark> more target after</p>`,
    );
    const ctx = extractContext(selectText(container, "target"), container);
    expect(ctx.before).toBe("keep more");
    expect(ctx.before).not.toContain("dropped");
    expect(ctx.after).toBe("after");
  });

  test("an over-long before keeps its tail, cut at a word boundary", () => {
    const container = mountContainer(
      "<p>alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo TARGET</p>",
    );
    const ctx = extractContext(selectText(container, "TARGET"), container);
    // 68 chars precede the selection; the 60-char window opens mid-"bravo",
    // and the partial word goes with it.
    expect(ctx.before).toBe("charlie delta echo foxtrot golf hotel india juliet kilo");
    expect(ctx.before).not.toContain("alpha");
  });

  test("an over-long after keeps its head, cut at a word boundary", () => {
    const container = mountContainer(
      "<p>TARGET alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo</p>",
    );
    const ctx = extractContext(selectText(container, "TARGET"), container);
    // The 60-char window closes inside "juliet", which is dropped whole.
    expect(ctx.after).toBe("alpha bravo charlie delta echo foxtrot golf hotel india");
    expect(ctx.after).not.toContain("jul");
  });
});

describe("extractContext — hierarchy", () => {
  /** Section.tsx's markup: the title as an attribute, and again in a header row. */
  function section(title: string, body: string): string {
    return `<div class="relative mb-8 p-4 group/section" data-md="section" data-md-title="${title}">`
      + `<div class="relative mb-2">`
      + `<button type="button"><svg></svg></button>`
      + `<h2 class="font-heading text-section">${title}</h2>`
      + `</div>`
      + `<div class="mt-6">${body}</div>`
      + `</div>`;
  }

  test("lists the section heading before the task label", () => {
    const container = mountContainer(section("Rollout", `
      <div data-task-id="ship-daemon">
        <div class="flex"><span class="font-semibold">Ship the daemon</span></div>
        <div>Then flip the flag on target hosts</div>
      </div>`));
    const ctx = extractContext(selectText(container, "target"), container);
    expect(ctx.hierarchy).toEqual(["Rollout", "Ship the daemon"]);
  });

  // A canvas is usually one wrapper holding several sections. That wrapper has a
  // heading somewhere beneath it — the first section's — but it owns none.
  test("does not take a neighbouring section's heading", () => {
    const container = mountContainer(
      `<div class="canvas-body">`
      + section("Planning Poker", `<p>estimates go here</p>`)
      + section("Project Timeline", `<p>target date</p>`)
      + `</div>`,
    );
    const ctx = extractContext(selectText(container, "target"), container);
    expect(ctx.hierarchy).toEqual(["Project Timeline"]);
  });

  // Hosts that render their own sections have no data-md attributes, so the
  // markup is all there is to go on.
  test("falls back to the heading markup when the block carries no title", () => {
    const container = mountContainer(`
      <div class="relative mb-8 p-4">
        <div class="relative mb-2"><h2 class="font-heading">Rollout</h2></div>
        <div class="mt-6"><p>target</p></div>
      </div>`);
    expect(extractContext(selectText(container, "target"), container).hierarchy).toEqual(["Rollout"]);
  });

  test("a heading nested deeper than the block's own header row is not its heading", () => {
    const container = mountContainer(`
      <div class="outer">
        <div class="relative mb-8 p-4">
          <div class="relative mb-2"><h2 class="font-heading">Rollout</h2></div>
        </div>
        <div class="mt-6"><p>target</p></div>
      </div>`);
    expect(extractContext(selectText(container, "target"), container).hierarchy).toEqual([]);
  });

  test("falls back to the task id when the label renders empty", () => {
    const container = mountContainer(
      `<div data-task-id="task-42"><span class="font-semibold"></span><p>target</p></div>`,
    );
    expect(extractContext(selectText(container, "target"), container).hierarchy).toEqual(["task-42"]);
  });

  test("plain prose has no hierarchy", () => {
    const container = mountContainer("<div><p>just prose with target inside</p></div>");
    expect(extractContext(selectText(container, "target"), container).hierarchy).toEqual([]);
  });

  test("stops at the plan container, ignoring ancestors above it", () => {
    const container = mountContainer(`
      <div class="relative mb-8 p-4">
        <div class="relative mb-2"><h2 class="font-heading">Outside</h2></div>
        <div id="plan">
          <div data-task-id="t1">
            <span class="font-semibold">Inner</span>
            <p>target</p>
          </div>
        </div>
      </div>`);
    const range = selectText(container, "target");
    expect(extractContext(range, elementIn(container, "#plan")).hierarchy).toEqual(["Inner"]);
  });
});

describe("formatSnippetInContext", () => {
  test("wraps a short snippet in its surrounding text", () => {
    expect(formatSnippetInContext({ snippet: "beta", context: context("alpha", "gamma") })).toBe(
      "...alpha **beta** gamma...",
    );
  });

  test("omits the side that has no context", () => {
    expect(formatSnippetInContext({ snippet: "beta", context: context("alpha", "") })).toBe(
      "...alpha **beta**",
    );
    expect(formatSnippetInContext({ snippet: "beta", context: context("", "gamma") })).toBe(
      "**beta** gamma...",
    );
  });

  // Context only disambiguates short snippets; a long one already identifies
  // itself, and the boundary is the trimmed length.
  test("stops adding context at 30 characters", () => {
    const ctx = context("alpha", "gamma");
    const twentyNine = "the daemon restarts too often";
    expect(twentyNine).toHaveLength(29);
    expect(formatSnippetInContext({ snippet: twentyNine, context: ctx })).toBe(
      `...alpha **${twentyNine}** gamma...`,
    );

    const thirty = `${twentyNine}.`;
    expect(formatSnippetInContext({ snippet: thirty, context: ctx })).toBe(thirty);

    const padded = `  ${twentyNine}  `;
    expect(formatSnippetInContext({ snippet: padded, context: ctx })).toBe(
      `...alpha **${twentyNine}** gamma...`,
    );
  });

  test("returns the bare trimmed snippet without usable context", () => {
    expect(formatSnippetInContext({ snippet: "  beta  " })).toBe("beta");
    expect(formatSnippetInContext({ snippet: "  beta  ", context: context("", "") })).toBe("beta");
  });
});
