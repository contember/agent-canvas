import React, { useEffect, useRef, useState } from "react";
import { useAnnotations } from "./AnnotationProvider";
import { AnnotationCreatePopover } from "./Popover";
import {
  applyRegionStyle,
  createRegionOverlay,
  describeRegion,
  isDrawableRegion,
  regionBetween,
  regionPointIn,
  regionTarget,
  REGION_HOST_ATTR,
  type RegionPoint,
  type RegionShape,
} from "./regionTarget";
import { generateAnnotationId } from "./utils";

interface UseRegionAnnotationOptions {
  /** Container holding the image blocks a region can be drawn on. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Re-registers the drawing listener when the canvas remounts. */
  restoreKey: unknown;
  /** Shape a new region takes. */
  shape?: RegionShape;
  /** Canvas file the created annotation belongs to. */
  canvasFile?: string;
  /** Scroll container for popover positioning. */
  scrollContainer?: HTMLElement | null;
}

/** One region being drawn out, held outside React: the box follows the pointer
 *  at pointer rate, which is no reason to re-render the canvas. */
interface RegionDrag {
  pointerId: number;
  host: HTMLElement;
  src: string;
  start: RegionPoint;
  shape: RegionShape;
  overlay: HTMLElement;
  id: string;
}

/** A region drawn but not yet given a note. */
interface PendingRegion {
  overlay: HTMLElement;
  id: string;
  snippet: string;
  label: string;
}

/**
 * Drag on an image block to annotate one part of it.
 *
 * An image carries no text, so a plain drag over one is unambiguous and takes
 * no modifier: the selection this would compete with cannot start there. It
 * still has to stay off the two things that already live on an image block —
 * the whole-image comment button and any region already drawn.
 */
export function useRegionAnnotation(options: UseRegionAnnotationOptions) {
  const { containerRef, restoreKey, shape = "rect", canvasFile, scrollContainer } = options;
  const { addAnnotationWithId } = useAnnotations();

  const [pending, setPending] = useState<PendingRegion | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const addAnnotationRef = useRef(addAnnotationWithId);
  addAnnotationRef.current = addAnnotationWithId;
  const canvasFileRef = useRef(canvasFile);
  canvasFileRef.current = canvasFile;
  const shapeRef = useRef(shape);
  shapeRef.current = shape;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let drag: RegionDrag | null = null;

    /** Where the pointer is, on the region grid of `host`. */
    function pointIn(host: HTMLElement, e: PointerEvent): RegionPoint | null {
      const rect = host.getBoundingClientRect();
      return regionPointIn(rect, e.clientX - rect.left, e.clientY - rect.top);
    }

    function endDrag() {
      if (!drag) return;
      const { host, pointerId } = drag;
      if (host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      drag = null;
      setIsDrawing(false);
    }

    function onDown(e: PointerEvent) {
      if (drag || e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      // The comment button mints the whole-image annotation, and a region
      // already drawn is its own click target; neither starts a new one.
      if (target.closest("[data-block-comment-btn]")) return;
      if (target.closest("[data-annotation-id]")) return;

      const host = target.closest(`[${REGION_HOST_ATTR}]`);
      if (!(host instanceof HTMLElement) || !container?.contains(host)) return;
      const src = host.closest("[data-md='image']")?.getAttribute("data-md-src");
      if (!src) return;
      const start = pointIn(host, e);
      if (!start) return;

      // Without this the browser starts its own image drag instead.
      e.preventDefault();
      host.setPointerCapture(e.pointerId);

      const id = generateAnnotationId();
      const overlay = createRegionOverlay({ ...start, w: 0, h: 0 }, shapeRef.current, id);
      overlay.classList.add("ann-region-draft");
      host.appendChild(overlay);

      drag = { pointerId: e.pointerId, host, src, start, shape: shapeRef.current, overlay, id };
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onCancel);
      setIsDrawing(true);
    }

    function onMove(e: PointerEvent) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const point = pointIn(drag.host, e);
      if (!point) return;
      applyRegionStyle(drag.overlay, regionBetween(drag.start, point));
    }

    function onUp(e: PointerEvent) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const { overlay, id, src, shape: drawnShape } = drag;
      const point = pointIn(drag.host, e) ?? drag.start;
      const box = regionBetween(drag.start, point);
      endDrag();

      if (!isDrawableRegion(box)) {
        overlay.remove();
        return;
      }
      applyRegionStyle(overlay, box);
      const locator = { src, shape: drawnShape, ...box };
      setPending({ overlay, id, snippet: regionTarget.format(locator), label: describeRegion(locator) });
    }

    function onCancel(e: PointerEvent) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      drag.overlay.remove();
      endDrag();
    }

    container.addEventListener("pointerdown", onDown);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      if (drag) {
        drag.overlay.remove();
        endDrag();
      }
    };
  }, [restoreKey]);

  const popovers = pending ? (
    <AnnotationCreatePopover
      anchorEl={pending.overlay}
      scrollContainer={scrollContainer}
      snippet={pending.label}
      truncateAt={80}
      onAdd={(note, images) => {
        // The overlay already carries the annotation's real id, so committing
        // is only dropping the draft look — no redraw, no flicker.
        pending.overlay.classList.remove("ann-region-draft");
        addAnnotationRef.current(pending.id, pending.snippet, note, undefined, undefined, images, canvasFileRef.current);
        setPending(null);
      }}
      onCancel={() => {
        pending.overlay.remove();
        setPending(null);
      }}
    />
  ) : null;

  return { popovers, isDrawing, isPopoverOpen: !!pending };
}
