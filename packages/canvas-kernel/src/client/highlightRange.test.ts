import { describe, expect, test } from "bun:test";
import { markIds, mountContainer, selectText } from "./testing/dom";
import {
  rangeIndexText,
  renameMarkId,
  restoreMarks,
  setMarkActive,
  unwrapMarks,
  updateAllMarkStates,
  wrapRangeWithMark,
} from "./highlightRange";

/** The marks carrying `id`, in document order. */
function marksFor(root: HTMLElement, id: string): HTMLElement[] {
  return [...root.querySelectorAll(`[data-annotation-id="${id}"]`)].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

/** Everything `id` highlights, concatenated — one annotation can need several marks. */
function markedText(root: HTMLElement, id: string): string {
  return marksFor(root, id)
    .map((mark) => mark.textContent ?? "")
    .join("");
}

/** `mark-active` is the class styles.css keys the active highlight off, so it is the observable. */
function activeMarkIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".mark-active")].map((el) => el.getAttribute("data-annotation-id") ?? "");
}

/** A descendant of the mounted container, guarded so a fixture typo fails at its cause. */
function paneOf(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`fixture has no ${selector}`);
  return el;
}

/** Builds a Range across element boundaries, which `selectText` alone cannot express. */
function selectAcross(root: HTMLElement, from: string, to: string): Range {
  const start = selectText(root, from);
  const end = selectText(root, to);
  const range = document.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.endContainer, end.endOffset);
  return range;
}

describe("wrapRangeWithMark", () => {
  test("wraps a selection inside one text node", () => {
    const container = mountContainer("<p>the quick brown fox</p>");

    const marks = wrapRangeWithMark(selectText(container, "quick brown"), "a1");

    expect(marks).toHaveLength(1);
    expect(markedText(container, "a1")).toBe("quick brown");
    expect(container.textContent).toBe("the quick brown fox");
  });

  test("splits a selection crossing elements into several marks under one id", () => {
    const container = mountContainer("<p>alpha <b>bravo</b> charlie</p>");
    const range = selectAcross(container, "pha", "char");
    const selected = range.toString();

    const marks = wrapRangeWithMark(range, "a1");

    // Each element keeps its own mark; together they must cover exactly the selection.
    expect(marks.length).toBeGreaterThan(1);
    expect(markIds(container)).toEqual(marks.map(() => "a1"));
    expect(markedText(container, "a1")).toBe(selected);
    expect(container.textContent).toBe("alpha bravo charlie");
  });

  test("does not mark text that is already annotated", () => {
    const container = mountContainer(`<p>keep <mark data-annotation-id="a1">taken</mark> free</p>`);

    wrapRangeWithMark(selectAcross(container, "keep", "free"), "a2");

    // Nesting a mark inside a mark would make the inner annotation unclickable.
    expect(markedText(container, "a2")).toBe("keep  free");
    expect(markedText(container, "a1")).toBe("taken");
    expect(container.textContent).toBe("keep taken free");
  });
});

// What a snippet is taken from at creation time. It is matched back against
// buildTextIndex on restore, so the two have to agree about what the text is.
describe("rangeIndexText", () => {
  test("is the selection itself when nothing in it is skipped", () => {
    const container = mountContainer("<p>the quick brown fox</p>");
    const range = selectText(container, "quick brown");

    expect(rangeIndexText(range)).toBe(range.toString());
  });

  test("keeps text that crosses inline elements, including the spaces between", () => {
    const container = mountContainer("<p>alpha <b>bravo</b> charlie</p>");
    const range = selectAcross(container, "pha", "char");

    expect(rangeIndexText(range)).toBe(range.toString());
  });

  test("drops text that already belongs to another annotation", () => {
    const container = mountContainer(`<p>keep <mark data-annotation-id="a1">taken</mark> free</p>`);
    const range = selectAcross(container, "keep", "free");

    expect(range.toString()).toBe("keep taken free");
    expect(rangeIndexText(range)).toBe("keep  free");
  });

  test("drops the line-number gutter", () => {
    const container = mountContainer(
      `<pre><code><span class="select-none">1 </span><span>const a = 1;</span>`
      + `\n<span class="select-none">2 </span><span>const b = 2;</span></code></pre>`,
    );
    const range = selectAcross(container, "const a", "const b");

    expect(range.toString()).toContain("2 ");
    expect(rangeIndexText(range)).toBe("const a = 1;\nconst b");
  });

  // The whole point: an annotation drawn over an existing one has to survive a
  // reload, and it only can if its snippet names text the index holds.
  test("a snippet taken this way is found again; the raw selection is not", () => {
    const markup = `<p>keep <mark data-annotation-id="a1">taken</mark> free</p>`;

    const indexed = mountContainer(markup);
    const snippet = rangeIndexText(selectAcross(indexed, "keep", "free")).trim();
    restoreMarks(indexed, [{ id: "a2", snippet }]);
    expect(markedText(indexed, "a2")).toBe(snippet);

    const raw = mountContainer(markup);
    const rawSnippet = selectAcross(raw, "keep", "free").toString().trim();
    restoreMarks(raw, [{ id: "a2", snippet: rawSnippet }]);
    expect(marksFor(raw, "a2")).toHaveLength(0);
  });
});

describe("restoreMarks", () => {
  test("re-finds a snippet that occurs once", () => {
    const container = mountContainer("<p>alpha beta gamma</p>");

    restoreMarks(container, [{ id: "a1", snippet: "beta" }]);

    expect(markIds(container)).toEqual(["a1"]);
    expect(markedText(container, "a1")).toBe("beta");
    expect(container.textContent).toBe("alpha beta gamma");
  });

  test("picks the occurrence matching context.before", () => {
    const container = mountContainer("<p>run the test</p><p>skip the test</p>");

    restoreMarks(container, [
      { id: "a1", snippet: "the test", context: { before: "skip", after: "", hierarchy: [] } },
    ]);

    expect(markIds(container)).toEqual(["a1"]);
    expect(marksFor(container, "a1")[0]?.parentElement?.textContent).toBe("skip the test");
  });

  test("picks the occurrence matching context.after", () => {
    // Long enough that the first occurrence's lookahead cannot reach the second paragraph.
    const filler = "filler ".repeat(20);
    const container = mountContainer(
      `<p>enable the flag</p><p>${filler}</p><p>enable the flag when the deploy finishes</p>`,
    );

    restoreMarks(container, [
      { id: "a1", snippet: "the flag", context: { before: "", after: "when the deploy", hierarchy: [] } },
    ]);

    expect(markIds(container)).toEqual(["a1"]);
    expect(marksFor(container, "a1")[0]?.parentElement?.textContent).toBe(
      "enable the flag when the deploy finishes",
    );
  });

  test("leaves the DOM alone when the snippet is gone", () => {
    const container = mountContainer("<p>the plan was rewritten</p>");

    restoreMarks(container, [{ id: "a1", snippet: "text from an older revision" }]);

    expect(markIds(container)).toEqual([]);
    expect(container.textContent).toBe("the plan was rewritten");
  });

  test("ignores an annotation with an empty snippet", () => {
    const container = mountContainer("<p>alpha beta</p>");

    restoreMarks(container, [{ id: "a1", snippet: "" }]);

    // An empty snippet matches at offset 0 and would litter the text with a zero-width mark.
    expect(markIds(container)).toEqual([]);
    expect(container.textContent).toBe("alpha beta");
  });

  test("restores a snippet that spans more than one text node", () => {
    const container = mountContainer("<p>the <em>quick</em> brown fox</p>");

    restoreMarks(container, [{ id: "a1", snippet: "quick brown" }]);

    expect(markedText(container, "a1")).toBe("quick brown");
    expect(container.textContent).toBe("the quick brown fox");
  });

  test("skips line-number gutters when matching across lines", () => {
    const container = mountContainer(
      `<pre><code><span class="select-none">1 </span><span>const a = 1;</span>\n<span class="select-none">2 </span><span>const b = 2;</span></code></pre>`,
    );
    const source = container.textContent;

    // Only matches if the gutters are out of the search text: with them the lines read "1;\n2 const".
    restoreMarks(container, [{ id: "a1", snippet: "a = 1;\nconst b" }]);

    expect(markIds(container)).toEqual(["a1", "a1"]);
    expect(container.querySelectorAll(".select-none [data-annotation-id]")).toHaveLength(0);
    expect(container.textContent).toBe(source);
  });

  test("restores a second annotation after the first one moved the text", () => {
    const container = mountContainer("<p>alpha beta gamma delta</p>");

    restoreMarks(container, [
      { id: "a1", snippet: "beta" },
      { id: "a2", snippet: "gamma" },
    ]);

    // Wrapping "beta" splits the text node, so a text index cached before it is stale.
    expect(markIds(container)).toEqual(["a1", "a2"]);
    expect(markedText(container, "a1")).toBe("beta");
    expect(markedText(container, "a2")).toBe("gamma");
    expect(container.textContent).toBe("alpha beta gamma delta");
  });

  test("does not add a second mark for an annotation already restored", () => {
    const container = mountContainer("<p>beta and beta again</p>");
    const ann = { id: "a1", snippet: "beta" };

    restoreMarks(container, [ann]);
    restoreMarks(container, [ann]);

    // Without the guard the second pass skips the marked text and grabs the other "beta".
    expect(markIds(container)).toEqual(["a1"]);
    expect(marksFor(container, "a1")[0]?.parentElement?.textContent).toBe("beta and beta again");
  });

  test("restores the same annotation once per container", () => {
    const container = mountContainer(`<div id="left"><p>beta</p></div><div id="right"><p>beta</p></div>`);
    const ann = { id: "a1", snippet: "beta" };

    restoreMarks(paneOf(container, "#left"), [ann]);
    restoreMarks(paneOf(container, "#right"), [ann]);

    // The same canvas can be on screen twice; each pane needs its own mark.
    expect(markIds(paneOf(container, "#left"))).toEqual(["a1"]);
    expect(markIds(paneOf(container, "#right"))).toEqual(["a1"]);
  });
});

describe("unwrapMarks", () => {
  // Decoration is not always an inline mark: a region overlay carries the same
  // id and wraps no text, so unwrapping it means taking it out.
  test("takes a region overlay out instead of unwrapping it", () => {
    const container = mountContainer(`<div data-annotation-image="true"><img /></div>`);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-annotation-id", "a1");
    container.firstElementChild?.appendChild(overlay);

    unwrapMarks("a1");

    expect(markIds(container)).toEqual([]);
    expect(container.textContent).toBe("");
  });

  test("returns the text to exactly what it was", () => {
    const container = mountContainer("<p>alpha <b>bravo</b> charlie</p>");
    const source = container.textContent;
    wrapRangeWithMark(selectAcross(container, "pha", "char"), "a1");

    unwrapMarks("a1");

    expect(markIds(container)).toEqual([]);
    expect(container.textContent).toBe(source);
  });

  test("rejoins the text nodes it split", () => {
    const container = mountContainer("<p>one two three</p>");
    wrapRangeWithMark(selectText(container, "two"), "a1");

    unwrapMarks("a1");

    // A later selection can only span the sentence if the fragments merged back.
    expect(selectText(container, "one two three").toString()).toBe("one two three");
  });

  test("leaves other annotations in place", () => {
    const container = mountContainer("<p>one two three</p>");
    wrapRangeWithMark(selectText(container, "one"), "a1");
    wrapRangeWithMark(selectText(container, "three"), "a2");

    unwrapMarks("a1");

    expect(markIds(container)).toEqual(["a2"]);
    expect(markedText(container, "a2")).toBe("three");
    expect(container.textContent).toBe("one two three");
  });
});

describe("renameMarkId", () => {
  test("moves every mark of the annotation to the new id", () => {
    const container = mountContainer("<p>alpha <b>bravo</b> charlie</p>");
    wrapRangeWithMark(selectAcross(container, "pha", "char"), "__pending_1");

    renameMarkId("__pending_1", "a1");

    // The temp id is what a pending popover wraps with; every piece must follow it to the saved id.
    expect(markIds(container).every((id) => id === "a1")).toBe(true);
    expect(marksFor(container, "__pending_1")).toHaveLength(0);
    expect(markedText(container, "a1")).toBe("pha bravo char");
  });
});

describe("mark active state", () => {
  const fixture =
    `<p><mark data-annotation-id="a1">alpha</mark> and <mark data-annotation-id="a1">alpha</mark>` +
    ` and <mark data-annotation-id="a2">beta</mark></p>`;

  test("activates and deactivates every mark of one annotation", () => {
    const container = mountContainer(fixture);

    setMarkActive("a1", true);
    expect(activeMarkIds(container)).toEqual(["a1", "a1"]);

    setMarkActive("a1", false);
    expect(activeMarkIds(container)).toEqual([]);
  });

  test("moves the active state from the previous annotation to the new one", () => {
    const container = mountContainer(fixture);
    setMarkActive("a1", true);

    updateAllMarkStates("a2", "a1");

    expect(activeMarkIds(container)).toEqual(["a2"]);
  });

  test("clears the active state when nothing is active", () => {
    const container = mountContainer(fixture);
    setMarkActive("a1", true);

    updateAllMarkStates(null, "a1");

    expect(activeMarkIds(container)).toEqual([]);
  });
});
