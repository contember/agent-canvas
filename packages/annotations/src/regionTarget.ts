import type { AnnotationTarget } from "./annotationTarget";

/**
 * A rectangle or ellipse drawn inside an image block, so a reader can point at
 * one corner of a screenshot instead of the whole picture.
 *
 * Coordinates are normalized against the image box, which is a uniform scale of
 * the image's natural size — that is what lets a region survive a resize, a
 * zoom or a different screen. They are stored on a fixed integer grid rather
 * than as floats: a float printed into the snippet and read back is not
 * guaranteed to be the same float, and a locator that shifts by one ulp names
 * a region nobody drew.
 */

/** The grid a region snaps to: hundredths of a percent of the image box. */
export const REGION_UNITS = 10000;

/** Under this a drag is a stray click, not a region — 0.3% of the image. */
const MIN_REGION_SIZE = 30;

export type RegionShape = "rect" | "ellipse";

export interface RegionPoint {
  x: number;
  y: number;
}

/** Left, top, width and height, all in REGION_UNITS. */
export interface RegionBox extends RegionPoint {
  w: number;
  h: number;
}

export interface RegionLocator extends RegionBox {
  /** The image block the region sits in — the same `src` `[Image]` is keyed by. */
  src: string;
  shape: RegionShape;
}

/** Marks the element a region is measured against: the image's own box, not the
 *  `<figure>`, which also holds the caption and would skew every percentage. */
export const REGION_HOST_ATTR = "data-annotation-image";

// The coordinates are anchored at the end and strictly numeric, so the greedy
// `src` group can hold anything at all — including a literal " @1,2,3,4" — and
// still hand the real coordinates to the tail.
const REGION_PATTERN = /^\[Region:(rect|ellipse)\] ([\s\S]+) @(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*)$/;

function readShape(value: string | undefined): RegionShape | null {
  if (value === "rect") return "rect";
  if (value === "ellipse") return "ellipse";
  return null;
}

/** A coordinate as `format` would have written it, or null. */
function readUnit(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > REGION_UNITS) return null;
  return n;
}

export function clampUnit(value: number): number {
  return Math.min(REGION_UNITS, Math.max(0, value));
}

/** Where a pointer landed inside a box, on the region grid. Null for a box with
 *  no extent — happy-dom and a not-yet-laid-out image both report zero. */
export function regionPointIn(box: { width: number; height: number }, offsetX: number, offsetY: number): RegionPoint | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  return {
    x: clampUnit(Math.round((offsetX / box.width) * REGION_UNITS)),
    y: clampUnit(Math.round((offsetY / box.height) * REGION_UNITS)),
  };
}

/** The box two drag corners span, kept inside the image. */
export function regionBetween(a: RegionPoint, b: RegionPoint): RegionBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.min(REGION_UNITS - x, Math.abs(a.x - b.x)),
    h: Math.min(REGION_UNITS - y, Math.abs(a.y - b.y)),
  };
}

export function isDrawableRegion(box: RegionBox): boolean {
  return box.w >= MIN_REGION_SIZE && box.h >= MIN_REGION_SIZE;
}

/** CSS geometry for the overlay. REGION_UNITS is percent × 100, so every value
 *  the grid holds divides out exactly. */
export function regionStyle(box: RegionBox): { left: string; top: string; width: string; height: string } {
  return {
    left: `${box.x / 100}%`,
    top: `${box.y / 100}%`,
    width: `${box.w / 100}%`,
    height: `${box.h / 100}%`,
  };
}

function pct(units: number): string {
  return `${(units / 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function describeRegion(locator: RegionLocator): string {
  const x = `${pct(locator.x)}-${pct(locator.x + locator.w)}`;
  const y = `${pct(locator.y)}-${pct(locator.y + locator.h)}`;
  return `[Region] ${locator.src} — ${locator.shape} x ${x}, y ${y} of the image`;
}

/** The image box a region belongs to. Compared attribute by attribute rather
 *  than through a selector, because an image src is a path and may carry any
 *  character a selector would have to escape. */
export function findRegionHost(src: string, root: ParentNode): HTMLElement | null {
  for (const figure of root.querySelectorAll("[data-md='image']")) {
    if (!(figure instanceof HTMLElement)) continue;
    if (figure.getAttribute("data-md-src") !== src) continue;
    const host = figure.querySelector(`[${REGION_HOST_ATTR}]`);
    if (host instanceof HTMLElement) return host;
  }
  return null;
}

export function applyRegionStyle(el: HTMLElement, box: RegionBox): void {
  const style = regionStyle(box);
  el.style.left = style.left;
  el.style.top = style.top;
  el.style.width = style.width;
  el.style.height = style.height;
}

/** The overlay box for one region. It carries `data-annotation-id`, so the
 *  hover, active-state and delete plumbing that already drives inline marks
 *  drives these too. */
export function createRegionOverlay(box: RegionBox, shape: RegionShape, annotationId: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "ann-region";
  el.setAttribute("data-annotation-id", annotationId);
  el.setAttribute("data-annotation-region", shape);
  applyRegionStyle(el, box);
  return el;
}

export const regionTarget: AnnotationTarget<RegionLocator> = {
  kind: "region",

  parse: (snippet) => {
    const match = REGION_PATTERN.exec(snippet);
    if (!match) return null;
    const shape = readShape(match[1]);
    const src = match[2];
    const x = readUnit(match[3]);
    const y = readUnit(match[4]);
    const w = readUnit(match[5]);
    const h = readUnit(match[6]);
    if (shape === null || src === undefined) return null;
    if (x === null || y === null || w === null || h === null) return null;
    if (w < 1 || h < 1) return null;
    return { src, shape, x, y, w, h };
  },

  format: (locator) =>
    `[Region:${locator.shape}] ${locator.src} @${locator.x},${locator.y},${locator.w},${locator.h}`,

  // The overlay is found by annotation id like any other decoration; this is
  // the fallback for before it is drawn, and it lands on the right image.
  find: (locator, root) => findRegionHost(locator.src, root),

  restore: (locator, root, ann) => {
    if (root.querySelector(`[data-annotation-id="${ann.id}"]`)) return;
    const host = findRegionHost(locator.src, root);
    if (!host) return;
    host.appendChild(createRegionOverlay(locator, locator.shape, ann.id));
  },

  describe: describeRegion,
};
