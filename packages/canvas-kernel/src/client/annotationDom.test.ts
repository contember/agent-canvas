// The harness registers `document`, so it has to be evaluated before the module
// under test — ESM runs imports in source order.
import { mountContainer } from "./testing/dom";
import { describe, expect, test } from "bun:test";
import type { ActiveView, Annotation } from "./runtime";
import {
  ANNOTATABLE_SELECTOR,
  BLOCK_SELECTOR,
  findAnnotationElement,
  getBlockSnippet,
  scrollToAnnotation,
} from "./annotationDom";
import { RESPONSE_ANNOTATION_PATH } from "./utils";

function annotation(
  props: { snippet: string; id?: string; filePath?: string; canvasFile?: string },
): Annotation {
  return {
    id: props.id ?? "ann-1",
    snippet: props.snippet,
    note: "why this matters",
    createdAt: "2026-01-01T00:00:00.000Z",
    filePath: props.filePath,
    canvasFile: props.canvasFile,
  };
}

/** The element a fixture nominates as the hit. Throws so a fixture typo fails at its cause. */
function target(root: HTMLElement, selector = "[data-testid='target']"): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`fixture has no ${selector}`);
  return el;
}

/** happy-dom runs no layout, so record the scroll call instead of measuring a scroll. */
function recordScrolls(el: HTMLElement): HTMLElement[] {
  const scrolled: HTMLElement[] = [];
  el.scrollIntoView = () => { scrolled.push(el); };
  return scrolled;
}

/**
 * Callout's markup, mirroring Callout.tsx: a decorative icon span ahead of the
 * content. Built here rather than hand-written, because a fixture tidier than
 * production hides exactly the defects worth catching — this one carried the
 * glyph into every snippet until the span was marked aria-hidden.
 */
const CALLOUT_ICONS = { info: "i", warning: "!", danger: "✕", tip: "✓" } as const;

function callout(
  type: keyof typeof CALLOUT_ICONS,
  content: string,
  options: { target?: boolean } = {},
): string {
  const testid = options.target ? ` data-testid="target"` : "";
  return `<div data-md="callout" data-md-type="${type}"${testid}>`
    + `<span aria-hidden="true">${CALLOUT_ICONS[type]}</span><div>${content}</div></div>`;
}

/** The file branch resolves on a timer; poll for the result instead of sleeping a guess. */
async function waitForFlash(el: HTMLElement): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!el.classList.contains("ann-flash")) {
    if (Date.now() > deadline) throw new Error("element never flashed");
    await Bun.sleep(5);
  }
}

describe("findAnnotationElement", () => {
  test("an inline mark wins over a block whose snippet also matches", () => {
    const container = mountContainer(
      `<p>the <mark data-annotation-id="ann-mark">rollout</mark> plan</p>`
      + `<div data-md="item" data-md-label="Ship the beta"></div>`,
    );
    const el = findAnnotationElement(annotation({ id: "ann-mark", snippet: "[Item] Ship the beta" }));
    expect(el).toBe(target(container, "mark"));
  });

  test("a text annotation resolves through its mark id, not through its text", () => {
    const container = mountContainer(`<p>the <mark data-annotation-id="ann-7">rewritten wording</mark> plan</p>`);
    const el = findAnnotationElement(annotation({ id: "ann-7", snippet: "the wording it had when annotated" }));
    expect(el).toBe(target(container, "mark"));
  });

  test("a text annotation whose mark is gone is not guessed from page text", () => {
    mountContainer(`<p>the rollout plan</p>`);
    expect(findAnnotationElement(annotation({ snippet: "rollout" }))).toBeNull();
  });

  // Each fixture carries a decoy of the same kind, so matching the first
  // annotatable block instead of the snippet fails the case.
  const blockCases: { name: string; html: string; snippet: string }[] = [
    {
      name: "[Item] identifies a task by its label",
      html: `<div data-md="item" data-md-label="Write the docs"></div>`
        + `<div data-md="item" data-md-label="Ship the beta" data-testid="target"></div>`,
      snippet: "[Item] Ship the beta",
    },
    {
      name: "[Section] identifies a section by its title",
      html: `<div data-md="section" data-md-title="Risks"></div>`
        + `<div data-md="section" data-md-title="Rollout" data-testid="target"></div>`,
      snippet: "[Section] Rollout",
    },
    {
      name: "[Callout:<type>] carries the callout type",
      html: callout("info", "Disk may fill up")
        + callout("warning", "Disk may fill up", { target: true }),
      snippet: "[Callout:warning] Disk may fill up",
    },
    {
      name: "[Callout:info] is what an untyped callout is called",
      html: callout("warning", "Nothing to worry about")
        + `<div data-md="callout" data-testid="target">`
        + `<span aria-hidden="true">i</span><div>Nothing to worry about</div></div>`,
      snippet: "[Callout:info] Nothing to worry about",
    },
    {
      name: "[Note] identifies a note by its text",
      html: `<div data-md="note">Numbers are from January</div>`
        + `<div data-md="note" data-testid="target">Numbers are from March</div>`,
      snippet: "[Note] Numbers are from March",
    },
    {
      name: "[Row] joins the data cells of a table row",
      html: `<div data-md="table"><table><thead><tr><th>Env</th><th>Owner</th></tr></thead><tbody>`
        + `<tr><td>staging</td><td>ana</td></tr>`
        + `<tr data-testid="target"><td>prod</td><td>bo</td></tr>`
        + `</tbody></table></div>`,
      snippet: "[Row] prod | bo",
    },
    {
      name: "[Checklist] identifies a checklist item by its label",
      html: `<li data-md="checklist-item" data-md-label="Warm the cache"></li>`
        + `<li data-md="checklist-item" data-md-label="Back up the DB" data-testid="target"></li>`,
      snippet: "[Checklist] Back up the DB",
    },
    {
      name: "[Image] identifies an image by its source",
      html: `<figure data-md="image" data-md-src="/img/before.png"></figure>`
        + `<figure data-md="image" data-md-src="/img/graph.png" data-testid="target"></figure>`,
      snippet: "[Image] /img/graph.png",
    },
  ];

  for (const { name, html, snippet } of blockCases) {
    test(name, () => {
      const container = mountContainer(html);
      expect(findAnnotationElement(annotation({ snippet }))).toBe(target(container));
    });
  }

  test("a callout is identified by the first 60 characters of its text", () => {
    const container = mountContainer(
      callout("warning", "Rolling this out to every tenant at once would break the nightly export job", { target: true }),
    );
    expect(findAnnotationElement(annotation({
      snippet: "[Callout:warning] Rolling this out to every tenant at once would break the nig",
    }))).toBe(target(container));
    // The stored snippet is the truncated one, so the untruncated text is a miss.
    expect(findAnnotationElement(annotation({
      snippet: "[Callout:warning] Rolling this out to every tenant at once would break the nightly export job",
    }))).toBeNull();
  });

  // The icon stands in for data-md-type, which the snippet already carries, so
  // it is decoration. It used to be glued to the front of the text the reader
  // sees in the sidebar and the agent reads in feedback.md.
  test("the callout icon glyph stays out of the snippet", () => {
    const container = mountContainer(callout("danger", "Data loss ahead", { target: true }));
    expect(findAnnotationElement(annotation({ snippet: "[Callout:danger] Data loss ahead" })))
      .toBe(target(container));
    // The glyph the block still renders is not part of what was stored.
    expect(findAnnotationElement(annotation({ snippet: "[Callout:danger] \u2715Data loss ahead" }))).toBeNull();
  });

  test("only the decoration is dropped, not the text beside it", () => {
    const container = mountContainer(
      `<div data-md="note" data-testid="target">`
      + `<span aria-hidden="true">*</span>Numbers are from <b>March</b>, not January</div>`,
    );
    expect(findAnnotationElement(annotation({ snippet: "[Note] Numbers are from March, not January" })))
      .toBe(target(container));
  });

  test("a block snippet that matches nothing on the page returns null", () => {
    mountContainer(`<div data-md="item" data-md-label="Ship the beta"></div>`);
    expect(findAnnotationElement(annotation({ snippet: "[Item] Ship something else" }))).toBeNull();
  });

  test("a block missing its identifying attribute never matches", () => {
    const container = mountContainer(
      `<div data-md="item"></div><div data-md="section"></div><figure data-md="image"></figure>`
      + `<div data-md="item" data-md-label="Ship the beta" data-testid="target"></div>`,
    );
    // The shapes a dropped guard would produce must all miss.
    for (const filler of ["", "null", "undefined"]) {
      expect(findAnnotationElement(annotation({ snippet: `[Item] ${filler}` }))).toBeNull();
      expect(findAnnotationElement(annotation({ snippet: `[Section] ${filler}` }))).toBeNull();
      expect(findAnnotationElement(annotation({ snippet: `[Image] ${filler}` }))).toBeNull();
    }
    // ...and the scan carries on past them to a usable block.
    expect(findAnnotationElement(annotation({ snippet: "[Item] Ship the beta" }))).toBe(target(container));
  });

  test("a table header row is not a scroll target", () => {
    const container = mountContainer(
      `<div data-md="table"><table><thead><tr><th>Env</th><th>Owner</th></tr></thead>`
      + `<tbody><tr data-testid="target"><td>prod</td><td>bo</td></tr></tbody></table></div>`,
    );
    expect(findAnnotationElement(annotation({ snippet: "[Row] Env | Owner" }))).toBeNull();
    expect(findAnnotationElement(annotation({ snippet: "[Row] prod | bo" }))).toBe(target(container));
  });

  test("rows of a table the canvas did not emit are not scroll targets", () => {
    mountContainer(
      `<div data-md="markdown"><table><tbody><tr><td>prod</td><td>bo</td></tr></tbody></table></div>`,
    );
    expect(findAnnotationElement(annotation({ snippet: "[Row] prod | bo" }))).toBeNull();
  });

  // Interactive controls are navigable but not annotatable: the arrows walk
  // them, no comment icon appears on them, and PlanRenderer's `a` shortcut
  // refuses them — precisely because a snippet minted there would name a block
  // this lookup can never return.
  test("interactive controls hold no annotations", () => {
    const container = mountContainer(
      `<div data-md="choice-option" data-md-label="Option A"></div>`
      + `<div data-md="userinput" data-md-label="Your name"></div>`
      + `<div data-md="rangeinput" data-md-label="Batch size"></div>`
      + `<div data-md="item" data-md-label="Ship the beta" data-testid="target"></div>`,
    );
    expect(findAnnotationElement(annotation({ snippet: "[Option] Option A" }))).toBeNull();
    expect(findAnnotationElement(annotation({ snippet: "[Input] Your name" }))).toBeNull();
    expect(findAnnotationElement(annotation({ snippet: "[Range] Batch size" }))).toBeNull();
    // The same scan does find an annotatable block, so the nulls are the selector, not a dead loop.
    expect(findAnnotationElement(annotation({ snippet: "[Item] Ship the beta" }))).toBe(target(container));
  });

  // The overview mounts every canvas at once, and two canvases in one push
  // routinely share a heading or a task label.
  describe("across several mounted canvases", () => {
    const TWO_CANVASES =
      `<div data-canvas-file="rollout.jsx">`
      + `<div data-md="item" data-md-label="Ship the beta"></div></div>`
      + `<div data-canvas-file="risks.jsx">`
      + `<div data-md="item" data-md-label="Ship the beta" data-testid="target"></div></div>`;

    test("a block annotation resolves inside the canvas it belongs to", () => {
      const container = mountContainer(TWO_CANVASES);
      const el = findAnnotationElement(annotation({
        snippet: "[Item] Ship the beta",
        canvasFile: "risks.jsx",
      }));
      // Document order would have handed back the one in rollout.jsx.
      expect(el).toBe(target(container));
    });

    test("a canvas that is not mounted is a miss, not a reason to look elsewhere", () => {
      mountContainer(TWO_CANVASES);
      expect(findAnnotationElement(annotation({
        snippet: "[Item] Ship the beta",
        canvasFile: "timeline.jsx",
      }))).toBeNull();
    });

    test("an annotation from before canvases were named still searches everywhere", () => {
      const container = mountContainer(TWO_CANVASES);
      expect(findAnnotationElement(annotation({ snippet: "[Item] Ship the beta" })))
        .toBe(target(container, `[data-canvas-file="rollout.jsx"] [data-md="item"]`));
    });
  });

  /** One of every kind the arrows walk, in the markup the components emit. */
  const ALL_BLOCK_KINDS =
    `<div data-md="item" data-md-label="Ship the beta"></div>`
    + `<div data-md="section" data-md-title="Rollout"></div>`
    + `<div data-md="table"><table><tbody><tr><td>prod</td><td>bo</td></tr></tbody></table></div>`
    + callout("info", "Disk may fill up")
    + `<div data-md="note">Numbers are from March</div>`
    + `<li data-md="checklist-item" data-md-label="Back up the DB"></li>`
    + `<div data-md="choice-option" data-md-label="Option A"></div>`
    + `<div data-md="multichoice-option" data-md-label="Option B"></div>`
    + `<div data-md="userinput" data-md-label="Your name"></div>`
    + `<div data-md="rangeinput" data-md-label="Batch size"></div>`
    + `<figure data-md="image" data-md-src="/img/graph.png"></figure>`;

  test("every annotatable block is also navigable", () => {
    const container = mountContainer(ALL_BLOCK_KINDS);
    const navigable = new Set(container.querySelectorAll(BLOCK_SELECTOR));
    const annotatable = Array.from(container.querySelectorAll(ANNOTATABLE_SELECTOR));

    expect(annotatable).not.toHaveLength(0);
    // An annotatable block the arrows cannot reach has no way to be annotated.
    for (const el of annotatable) expect(navigable.has(el)).toBe(true);
  });

  // The round trip the `a` shortcut depends on: it mints a snippet from a block
  // it reached, and this lookup has to give that same block back. Derived rather
  // than hardcoded, so it keeps holding when a snippet's wording changes.
  test("every annotatable block is found again by the snippet it mints", () => {
    const container = mountContainer(ALL_BLOCK_KINDS);
    const snippets: string[] = [];

    for (const el of container.querySelectorAll(ANNOTATABLE_SELECTOR)) {
      const snippet = getBlockSnippet(el as HTMLElement);
      if (!snippet) throw new Error(`annotatable block mints no snippet: ${el.outerHTML}`);
      expect(findAnnotationElement(annotation({ snippet }))).toBe(el as HTMLElement);
      snippets.push(snippet);
    }

    // Pinned, so a selector that shrank cannot pass this vacuously.
    expect(snippets).toHaveLength(7);
  });
});

describe("scrollToAnnotation", () => {
  test("a canvas annotation is revealed in place, without switching view", () => {
    const container = mountContainer(`<div data-md="item" data-md-label="Ship the beta" data-testid="target"></div>`);
    const el = target(container);
    const scrolled = recordScrolls(el);
    const views: ActiveView[] = [];

    scrollToAnnotation(annotation({ snippet: "[Item] Ship the beta" }), (view) => { views.push(view); });

    expect(views).toEqual([]);
    expect(scrolled).toEqual([el]);
    expect(el.classList.contains("ann-flash")).toBe(true);
  });

  test("a file annotation switches view first and flashes the element that appears", async () => {
    const container = mountContainer(`<p>overview</p>`);
    const views: ActiveView[] = [];
    const setActiveView = (view: ActiveView) => {
      views.push(view);
      // The host only mounts the file once the view switches, so the element
      // does not exist at call time.
      if (view.type === "file") container.innerHTML = `<pre><mark data-annotation-id="ann-file">line 12</mark></pre>`;
    };

    scrollToAnnotation(
      annotation({ id: "ann-file", snippet: "line 12", filePath: "src/server.ts" }),
      setActiveView,
    );

    expect(views).toEqual([{ type: "file", path: "src/server.ts" }]);
    const el = target(container, "mark");
    // Resolution is deferred, so the freshly mounted file is not touched yet.
    expect(el.classList.contains("ann-flash")).toBe(false);

    const scrolled = recordScrolls(el);
    await waitForFlash(el);
    expect(scrolled).toEqual([el]);
  });

  test("a response annotation is revealed in place, not in a file tab", () => {
    const container = mountContainer(
      `<div><mark data-annotation-id="ann-resp">the third option</mark></div>`,
    );
    const el = target(container, "mark");
    const scrolled = recordScrolls(el);
    const views: ActiveView[] = [];

    scrollToAnnotation(
      annotation({ id: "ann-resp", snippet: "the third option", filePath: RESPONSE_ANNOTATION_PATH }),
      (view) => { views.push(view); },
    );

    // The sentinel rides in filePath but names no file — switching to it opened
    // a tab for "__agent-response__" over a blank pane.
    expect(views).toEqual([]);
    expect(scrolled).toEqual([el]);
    expect(el.classList.contains("ann-flash")).toBe(true);
  });

  test("an annotation that is no longer on the page is a no-op", () => {
    mountContainer(`<p>plain</p>`);
    const views: ActiveView[] = [];
    expect(() => {
      scrollToAnnotation(annotation({ snippet: "[Item] Deleted in this revision" }), (view) => { views.push(view); });
    }).not.toThrow();
    expect(views).toEqual([]);
  });
});
