// The harness registers the DOM globals, so it has to be evaluated first.
import { mountContainer } from "./testing/dom";
import { describe, expect, spyOn, test } from "bun:test";
import { autoResizeTextarea, generateAnnotationId, RESPONSE_ANNOTATION_PATH } from "./utils";

function mountTextarea(): HTMLTextAreaElement {
  const el = mountContainer("<textarea></textarea>").querySelector("textarea");
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("textarea did not mount");
  return el;
}

/** happy-dom measures nothing, so content height only exists where a test puts it. */
function stubScrollHeight(el: HTMLTextAreaElement, value: number, onRead?: () => void): void {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => {
      onRead?.();
      return value;
    },
  });
}

describe("RESPONSE_ANNOTATION_PATH", () => {
  test("is a truthy name no browsed file can carry", () => {
    // It travels in the same `filePath` field as real paths, and every consumer
    // splits buckets with `filePath && filePath !== SENTINEL`: an empty value
    // would land response annotations in the file *and* canvas buckets at once.
    expect(RESPONSE_ANNOTATION_PATH.length).toBeGreaterThan(0);
    expect(RESPONSE_ANNOTATION_PATH).not.toContain("/");
    expect(RESPONSE_ANNOTATION_PATH).toMatch(/^__.+__$/);
  });
});

describe("generateAnnotationId", () => {
  test("stamps the id with the creation time plus a random tail", () => {
    const now = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      expect(generateAnnotationId()).toMatch(/^ann-1700000000000-[0-9a-z]+$/);
    } finally {
      now.mockRestore();
    }
  });

  test("two annotations created in the same millisecond do not share an id", () => {
    const now = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const ids = new Set(Array.from({ length: 200 }, () => generateAnnotationId()));
      // A time-only id collapses the whole batch to one value. The single-item
      // slack is for the 36^4 suffix space, not a budget for real collisions.
      expect(ids.size).toBeGreaterThanOrEqual(199);
    } finally {
      now.mockRestore();
    }
  });
});

describe("autoResizeTextarea", () => {
  test("grows the box to the height its content needs", () => {
    const el = mountTextarea();
    stubScrollHeight(el, 140);

    autoResizeTextarea(el);
    expect(el.style.height).toBe("140px");
  });

  test("outgrows the floor once the content is taller than it", () => {
    const el = mountTextarea();
    stubScrollHeight(el, 200);

    autoResizeTextarea(el, 60);
    expect(el.style.height).toBe("200px");
  });

  test("holds the floor while the content is shorter than it", () => {
    const el = mountTextarea();
    stubScrollHeight(el, 30);

    autoResizeTextarea(el, 60);
    expect(el.style.height).toBe("60px");
  });

  test("measures only after collapsing the box, so deleted lines shrink it again", () => {
    const el = mountTextarea();
    el.style.height = "500px";
    const heightsWhenMeasured: string[] = [];
    stubScrollHeight(el, 90, () => heightsWhenMeasured.push(el.style.height));

    autoResizeTextarea(el);
    // Measuring at the old height would report it back and the box would never shrink.
    expect(heightsWhenMeasured).toEqual(["auto"]);
    expect(el.style.height).toBe("90px");
  });
});
