// The harness registers `document`, so it has to be evaluated before the module
// under test — ESM runs imports in source order.
import { mountContainer } from "./testing/dom";
import { describe, expect, test } from "bun:test";
import type { ActiveView, Annotation } from "./runtime";
import { findAnnotationElement, scrollToAnnotation } from "./annotationDom";

function annotation(props: { snippet: string; id?: string; filePath?: string }): Annotation {
  return {
    id: props.id ?? "ann-1",
    snippet: props.snippet,
    note: "why this matters",
    createdAt: "2026-01-01T00:00:00.000Z",
    filePath: props.filePath,
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
      html: `<div data-md="callout" data-md-type="info">Disk may fill up</div>`
        + `<div data-md="callout" data-md-type="warning" data-testid="target">Disk may fill up</div>`,
      snippet: "[Callout:warning] Disk may fill up",
    },
    {
      name: "[Callout:info] is what an untyped callout is called",
      html: `<div data-md="callout" data-md-type="warning">Nothing to worry about</div>`
        + `<div data-md="callout" data-testid="target">Nothing to worry about</div>`,
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
      `<div data-md="callout" data-md-type="warning" data-testid="target">`
      + `Rolling this out to every tenant at once would break the nightly export job</div>`,
    );
    expect(findAnnotationElement(annotation({
      snippet: "[Callout:warning] Rolling this out to every tenant at once would break the nig",
    }))).toBe(target(container));
    // The stored snippet is the truncated one, so the untruncated text is a miss.
    expect(findAnnotationElement(annotation({
      snippet: "[Callout:warning] Rolling this out to every tenant at once would break the nightly export job",
    }))).toBeNull();
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

  test("interactive controls are not scroll targets — they cannot be annotated", () => {
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

  test("an annotation that is no longer on the page is a no-op", () => {
    mountContainer(`<p>plain</p>`);
    const views: ActiveView[] = [];
    expect(() => {
      scrollToAnnotation(annotation({ snippet: "[Item] Deleted in this revision" }), (view) => { views.push(view); });
    }).not.toThrow();
    expect(views).toEqual([]);
  });
});
