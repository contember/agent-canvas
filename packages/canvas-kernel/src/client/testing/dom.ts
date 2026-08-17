/**
 * DOM harness for the client tests.
 *
 * Import this **before** the module under test. ESM evaluates imports in order,
 * so putting it first is what guarantees the globals exist by the time anything
 * that reads `document` is evaluated.
 *
 * happy-dom is not a browser: it runs no layout. Everything geometric —
 * `getBoundingClientRect`, `scrollHeight`, `offsetWidth` — reads zero unless the
 * test stubs it, and `scrollIntoView` and CSS animations do nothing. Assert on
 * structure and on the values a function computes, never on real measurements.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Bun runs every test file in one process, so the second file to import this
// must not register over the first.
if (!globalThis.document) {
  GlobalRegistrator.register();
}

/**
 * Replace the document body with `html` inside a fresh container and return it.
 * Call it at the start of each test — the document is shared across every test
 * in the process, so whatever the previous one left behind is still there.
 */
export function mountContainer(html: string): HTMLElement {
  document.body.innerHTML = `<div data-testid="container">${html}</div>`;
  const container = document.body.firstElementChild;
  if (!(container instanceof HTMLElement)) throw new Error("container did not mount");
  return container;
}

/**
 * A Range over the first occurrence of `text` within a single text node of
 * `root`, which is how a reader's selection arrives in the annotation code.
 * Throws rather than returning null so a typo in the fixture fails the test at
 * its cause instead of somewhere downstream.
 */
export function selectText(root: HTMLElement, text: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const content = node.textContent ?? "";
    const index = content.indexOf(text);
    if (index === -1) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + text.length);
    return range;
  }
  throw new Error(`no text node in the fixture contains ${JSON.stringify(text)}`);
}

/** Ids of the marks currently wrapping annotated text, in document order. */
export function markIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll("[data-annotation-id]")]
    .map((el) => el.getAttribute("data-annotation-id") ?? "");
}
