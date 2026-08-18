// The harness registers `document`, so it has to be evaluated before the module
// under test — ESM runs imports in source order.
import { mountContainer } from "./testing/dom";
import { describe, expect, test } from "bun:test";
import {
  describeRegion,
  findRegionHost,
  isDrawableRegion,
  regionBetween,
  regionPointIn,
  regionStyle,
  regionTarget,
  REGION_UNITS,
  type RegionLocator,
} from "./regionTarget";

/** An image block as ImageView emits it, with the box a region is measured against. */
function imageBlock(src: string, options: { host?: boolean; caption?: string } = {}): string {
  const box = options.host === false
    ? `<div><img /></div>`
    : `<div data-annotation-image="true"><img /></div>`;
  return `<figure data-md="image" data-md-src="${src}">${box}`
    + (options.caption ? `<figcaption>${options.caption}</figcaption>` : "")
    + `</figure>`;
}

function locator(props: Partial<RegionLocator> = {}): RegionLocator {
  return { src: "/img/graph.png", shape: "rect", x: 1234, y: 500, w: 900, h: 4000, ...props };
}

describe("the region snippet", () => {
  // A region has to ride in the same `snippet` string as everything else, and
  // come back out the same region — a locator that shifts on the way through
  // names a region nobody drew.
  const roundTrips: { name: string; locator: RegionLocator }[] = [
    { name: "an ordinary box", locator: locator() },
    { name: "an ellipse", locator: locator({ shape: "ellipse" }) },
    { name: "the whole image", locator: locator({ x: 0, y: 0, w: REGION_UNITS, h: REGION_UNITS }) },
    { name: "a box pinned to the far corner", locator: locator({ x: 9970, y: 9970, w: 30, h: 30 }) },
    { name: "a src with spaces", locator: locator({ src: "shots/first run.png" }) },
    { name: "a src carrying the coordinate separator", locator: locator({ src: "odd @1,2,3,4.png" }) },
    { name: "a src that reads like another snippet", locator: locator({ src: "[Item] Ship the beta" }) },
  ];

  for (const { name, locator: loc } of roundTrips) {
    test(`${name} survives format → parse`, () => {
      expect(regionTarget.parse(regionTarget.format(loc))).toEqual(loc);
    });
  }

  test("parse → format returns the snippet byte for byte", () => {
    const snippet = "[Region:ellipse] /img/graph.png @0,10000,7,1";
    const parsed = regionTarget.parse(snippet);
    expect(parsed).not.toBeNull();
    expect(parsed && regionTarget.format(parsed)).toBe(snippet);
  });

  test("the coordinates are read off the end, not the first thing that looks like them", () => {
    const parsed = regionTarget.parse("[Region:rect] a @1,2,3,4.png @1234,500,900,4000");
    expect(parsed).toEqual(locator({ src: "a @1,2,3,4.png" }));
  });

  // Every one of these would strand an annotation if it parsed to something
  // format could not write back.
  const rejected: Record<string, string> = {
    "a float coordinate": "[Region:rect] /a.png @0.5,0,900,900",
    "a padded coordinate": "[Region:rect] /a.png @0012,0,900,900",
    "a negative coordinate": "[Region:rect] /a.png @-12,0,900,900",
    "a coordinate off the grid": "[Region:rect] /a.png @10001,0,900,900",
    "a zero-width box": "[Region:rect] /a.png @0,0,0,900",
    "an unknown shape": "[Region:triangle] /a.png @0,0,900,900",
    "a missing coordinate": "[Region:rect] /a.png @0,0,900",
    "no src at all": "[Region:rect] @0,0,900,900",
    "trailing noise": "[Region:rect] /a.png @0,0,900,900 ",
  };

  for (const [name, snippet] of Object.entries(rejected)) {
    test(`${name} is not a region`, () => {
      expect(regionTarget.parse(snippet)).toBeNull();
    });
  }

  // The snippet space is shared with every block kind, so a region prefix that
  // collided with one of theirs would resolve two ways at once.
  test("no existing snippet kind reads as a region", () => {
    const others = [
      "[Item] Ship the beta",
      "[Section] Rollout",
      "[Callout:warning] Disk may fill up",
      "[Note] Numbers are from March",
      "[Row] prod | bo",
      "[Checklist] Back up the DB",
      "[Image] /img/graph.png",
      "[Option] Option A",
      "[Input] Your name",
      "[Range] Batch size",
      "plain selected text",
      "",
    ];
    for (const snippet of others) expect(regionTarget.parse(snippet)).toBeNull();
  });

  test("a region is not mistaken for the whole-image annotation", () => {
    const region = regionTarget.format(locator());
    expect(region.startsWith("[Image] ")).toBe(false);
  });
});

// happy-dom runs no layout, so every measurement is handed in as a number and
// the arithmetic is what gets asserted.
describe("region geometry", () => {
  test("a pointer offset lands on the grid", () => {
    expect(regionPointIn({ width: 800, height: 400 }, 200, 100)).toEqual({ x: 2500, y: 2500 });
  });

  test("a pointer outside the image is pulled back onto it", () => {
    expect(regionPointIn({ width: 800, height: 400 }, -50, 900)).toEqual({ x: 0, y: REGION_UNITS });
  });

  test("a box with no extent yields no point", () => {
    expect(regionPointIn({ width: 0, height: 400 }, 10, 10)).toBeNull();
    expect(regionPointIn({ width: 800, height: 0 }, 10, 10)).toBeNull();
  });

  test("dragging up-left is the same box as dragging down-right", () => {
    const a = { x: 2000, y: 3000 };
    const b = { x: 5000, y: 8000 };
    const box = { x: 2000, y: 3000, w: 3000, h: 5000 };
    expect(regionBetween(a, b)).toEqual(box);
    expect(regionBetween(b, a)).toEqual(box);
  });

  test("a box never runs off the image", () => {
    const box = regionBetween({ x: 9000, y: 9000 }, { x: REGION_UNITS, y: REGION_UNITS });
    expect(box.x + box.w).toBeLessThanOrEqual(REGION_UNITS);
    expect(box.y + box.h).toBeLessThanOrEqual(REGION_UNITS);
  });

  test("a stray click is not a region", () => {
    expect(isDrawableRegion({ x: 0, y: 0, w: 29, h: 4000 })).toBe(false);
    expect(isDrawableRegion({ x: 0, y: 0, w: 4000, h: 29 })).toBe(false);
    expect(isDrawableRegion({ x: 0, y: 0, w: 30, h: 30 })).toBe(true);
  });

  test("the grid divides into percentages exactly", () => {
    expect(regionStyle({ x: 1234, y: 1, w: REGION_UNITS, h: 50 })).toEqual({
      left: "12.34%",
      top: "0.01%",
      width: "100%",
      height: "0.5%",
    });
  });

  test("a region says in words what it points at", () => {
    expect(describeRegion(locator())).toBe(
      "[Region] /img/graph.png — rect x 12.3%-21.3%, y 5%-45% of the image",
    );
  });
});

describe("finding the image a region belongs to", () => {
  test("the region host is the image box, not the figure", () => {
    const container = mountContainer(imageBlock("/img/graph.png", { caption: "Fig 1" }));
    const host = findRegionHost("/img/graph.png", container);
    expect(host).toBe(container.querySelector("[data-annotation-image]"));
  });

  test("each image keeps its own regions", () => {
    const container = mountContainer(imageBlock("/img/before.png") + imageBlock("/img/after.png"));
    const host = findRegionHost("/img/after.png", container);
    expect(host?.closest("[data-md='image']")?.getAttribute("data-md-src")).toBe("/img/after.png");
  });

  test("an image the page does not show is a miss", () => {
    const container = mountContainer(imageBlock("/img/graph.png"));
    expect(findRegionHost("/img/missing.png", container)).toBeNull();
  });

  test("an image block with no measurable box holds no regions", () => {
    const container = mountContainer(imageBlock("/img/graph.png", { host: false }));
    expect(findRegionHost("/img/graph.png", container)).toBeNull();
  });

  test("the target resolves the host from the snippet", () => {
    const container = mountContainer(imageBlock("/img/graph.png"));
    const parsed = regionTarget.parse(regionTarget.format(locator()));
    expect(parsed).not.toBeNull();
    expect(parsed && regionTarget.find(parsed, container))
      .toBe(container.querySelector("[data-annotation-image]"));
  });
});

// The step a reload depends on: the annotation comes back from storage as a
// string and has to draw its box again.
describe("restoring a region", () => {
  const ann = { id: "ann-region", snippet: regionTarget.format(locator()) };

  function restore(container: HTMLElement, target = ann) {
    const parsed = regionTarget.parse(target.snippet);
    if (!parsed) throw new Error("fixture snippet does not parse");
    regionTarget.restore?.(parsed, container, target);
  }

  test("the overlay is drawn where the region was", () => {
    const container = mountContainer(imageBlock("/img/graph.png"));
    restore(container);

    const overlay = container.querySelector("[data-annotation-id='ann-region']");
    if (!(overlay instanceof HTMLElement)) throw new Error("no overlay was drawn");
    expect(overlay.parentElement).toBe(container.querySelector("[data-annotation-image]"));
    expect(overlay.getAttribute("data-annotation-region")).toBe("rect");
    expect(overlay.style.left).toBe("12.34%");
    expect(overlay.style.top).toBe("5%");
    expect(overlay.style.width).toBe("9%");
    expect(overlay.style.height).toBe("40%");
  });

  test("restoring twice leaves one overlay", () => {
    const container = mountContainer(imageBlock("/img/graph.png"));
    restore(container);
    restore(container);
    expect(container.querySelectorAll("[data-annotation-id='ann-region']")).toHaveLength(1);
  });

  test("an ellipse is drawn as one", () => {
    const container = mountContainer(imageBlock("/img/graph.png"));
    restore(container, { id: "ann-e", snippet: regionTarget.format(locator({ shape: "ellipse" })) });
    expect(container.querySelector("[data-annotation-id='ann-e']")?.getAttribute("data-annotation-region"))
      .toBe("ellipse");
  });

  test("a region whose image is gone from this revision draws nothing", () => {
    const container = mountContainer(imageBlock("/img/other.png"));
    restore(container);
    expect(container.querySelector("[data-annotation-id='ann-region']")).toBeNull();
  });
});
