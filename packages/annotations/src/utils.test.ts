// The harness registers the DOM globals, so it has to be evaluated first.
import { mountContainer } from "./testing/dom";
import { describe, expect, spyOn, test } from "bun:test";
import {
  autoResizeTextarea,
  fileAnnotationPath,
  generateAnnotationId,
  hostAcceptsUploads,
  RESPONSE_ANNOTATION_PATH,
} from "./utils";

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
  test("is a truthy sentinel, distinguishable from a real path", () => {
    // It rides in the same `filePath` field as real paths. Bucketing code that
    // compares against it needs it non-empty; a falsy value would put response
    // annotations in the file and canvas buckets at once.
    expect(RESPONSE_ANNOTATION_PATH.length).toBeGreaterThan(0);
    expect(RESPONSE_ANNOTATION_PATH).toMatch(/^__.+__$/);
  });
});

describe("fileAnnotationPath", () => {
  test("gives back the path of an annotation that lives in a file", () => {
    expect(fileAnnotationPath({ filePath: "src/server.ts" })).toBe("src/server.ts");
  });

  test("a response annotation has no file, though it carries a filePath", () => {
    // Reading the field directly is what opened a tab named after the sentinel.
    expect(fileAnnotationPath({ filePath: RESPONSE_ANNOTATION_PATH })).toBeUndefined();
  });

  test("a canvas annotation has no file either", () => {
    expect(fileAnnotationPath({})).toBeUndefined();
    expect(fileAnnotationPath({ filePath: "" })).toBeUndefined();
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
    // Driving the random source directly instead of drawing a batch: a sample
    // large enough to be convincing also carries a real birthday-collision rate,
    // and a test that fails once every few thousand runs teaches people to
    // rerun rather than to look.
    const now = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const random = spyOn(Math, "random");
    try {
      random.mockReturnValue(0.111111);
      const first = generateAnnotationId();
      random.mockReturnValue(0.222222);
      const second = generateAnnotationId();
      random.mockReturnValue(0.111111);
      const repeat = generateAnnotationId();

      // A time-only id would make all three equal.
      expect(first).not.toBe(second);
      // And the tail is a pure function of the draw, not of call order.
      expect(first).toBe(repeat);
    } finally {
      random.mockRestore();
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

describe("hostAcceptsUploads", () => {
  test("a host with an upload endpoint keeps the attach affordances", () => {
    expect(hostAcceptsUploads({ uploadUrl: () => "/api/session/x/upload" })).toBe(true);
  });

  test("a host with none loses them, rather than posting into the void", () => {
    expect(hostAcceptsUploads({ uploadUrl: null })).toBe(false);
  });
});
