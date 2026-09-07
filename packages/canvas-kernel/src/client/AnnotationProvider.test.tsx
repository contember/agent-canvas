import { mountContainer } from "@fabrika/annotations/testing/dom.ts";
import { afterEach, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useAnnotations as useSurfaceAnnotations, useAnnotationHost } from "@fabrika/annotations/runtime";
import { AnnotationProvider, type PersistedState } from "./AnnotationProvider";
import { useAnnotations, type AnnotationContextValue } from "#canvas/runtime";
import { CanvasHostContext, localCanvasHost } from "./hostContext";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

test("annotation runtime is the sole owner of annotation and session contexts", async () => {
  const surface = await import("@fabrika/annotations");
  const runtime = await import("@fabrika/annotations/runtime");
  const canvas = await import("#canvas/runtime");
  expect(surface.AnnotationCtx).toBe(runtime.AnnotationCtx);
  expect(surface.AnnotationHostContext).toBe(runtime.AnnotationHostContext);
  expect(surface.SessionContext).toBe(runtime.SessionContext);
  expect(canvas.SessionContext).toBe(runtime.SessionContext);
  expect(canvas.AnnotationCtx).not.toBe(runtime.AnnotationCtx);
});

test("canvas controls and annotation surface share state but not canvas responsibilities", async () => {
  let canvas: AnnotationContextValue | undefined;
  const writes: PersistedState[] = [];
  const host = { ...localCanvasHost, sessionId: "bridge", uploadUrl: () => "/upload" };
  function Probe() {
    canvas = useAnnotations();
    const surface = useSurfaceAnnotations();
    expect(surface.annotations).toBe(canvas.annotations);
    expect(surface.updateAnnotation).toBe(canvas.updateAnnotation);
    expect(useAnnotationHost()).toBe(host);
    expect("responses" in surface).toBe(false);
    return null;
  }
  root = createRoot(mountContainer(""));
  await act(async () => root?.render(
    <CanvasHostContext.Provider value={host}>
      <AnnotationProvider sessionId="bridge" revision={1} isReadOnly={false} draftPhase="current" canvasFiles={["plan.jsx"]}
        loadState={async () => ({ annotations: [], generalNote: "", responses: [["old", { id: "old", type: "text", label: "Old", value: "previous" }]] })}
        saveState={(_session, _revision, state) => writes.push(state)}
      ><Probe /></AnnotationProvider>
    </CanvasHostContext.Provider>,
  ));
  expect(canvas?.submittableResponses.has("old")).toBe(true);
  await act(async () => {
    canvas?.addAnnotationWithId("note", "text", "comment");
    canvas?.setResponse("new", { id: "new", type: "text", label: "New", value: "answer" });
    canvas?.registerResponse("new");
    canvas?.registerCanvasRendered("plan.jsx");
  });
  expect(canvas?.submittableResponses.has("old")).toBe(false);
  expect(canvas?.submittableResponses.has("new")).toBe(true);
  await act(async () => { await Bun.sleep(350); });
  expect(writes.at(-1)?.annotations[0]?.note).toBe("comment");
  expect(writes.at(-1)?.responses.map(([id]) => id)).toEqual(["old", "new"]);
  await act(async () => canvas?.clearAll());
  expect(canvas?.responses.size).toBe(0);
  expect(canvas?.annotations).toEqual([]);
  expect(writes.at(-1)).toEqual({ annotations: [], generalNote: "", responses: [], feedbackEntries: [] });
});
