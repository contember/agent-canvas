import { mountContainer } from "./testing/dom";
import { afterEach, describe, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationProvider } from "./AnnotationProvider";
import { useAnnotations, type AnnotationContextValue, type AnnotationState } from "@fabrika/annotations/runtime";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

const saved: AnnotationState = {
  annotations: [{ id: "local", snippet: "example", note: "saved", createdAt: "2026-01-01" }],
  generalNote: "draft",
};

describe("standalone annotation provider", () => {
  test("hydrates and persists only annotation state without canvas responses", async () => {
    let state: AnnotationContextValue | undefined;
    const writes: AnnotationState[] = [];
    function Probe() {
      state = useAnnotations();
      return <span>{state.generalNote}</span>;
    }
    root = createRoot(mountContainer(""));
    await act(async () => {
      root?.render(<AnnotationProvider scope="document" loadState={async () => saved} saveState={(_scope, value) => writes.push(value)}><Probe /></AnnotationProvider>);
    });
    expect(state?.annotations).toEqual(saved.annotations);
    expect(state?.generalNote).toBe("draft");
    await act(async () => state?.updateAnnotation("local", "edited"));
    await act(async () => { await Bun.sleep(350); });
    expect(writes.at(-1)).toEqual({
      annotations: saved.annotations.map((annotation) => ({ ...annotation, note: "edited" })), generalNote: "draft",
    });
  });

  test("a late load cannot overwrite another scope or save an empty loading state", async () => {
    const first = Promise.withResolvers<AnnotationState | null>();
    const second = Promise.withResolvers<AnnotationState | null>();
    const writes: string[] = [];
    const loadState = (scope: string) => scope === "first" ? first.promise : second.promise;
    const saveState = (scope: string) => { writes.push(scope); };
    function Probe() {
      return <span>{useAnnotations().generalNote}</span>;
    }
    const container = mountContainer("");
    root = createRoot(container);
    const render = (scope: string) => root?.render(
      <AnnotationProvider scope={scope} loadState={loadState} saveState={saveState}><Probe /></AnnotationProvider>,
    );
    await act(async () => render("first"));
    await act(async () => render("second"));
    await act(async () => { first.resolve(saved); await Bun.sleep(350); });
    expect(writes).toEqual([]);
    expect(container.textContent).toBe("");
    await act(async () => second.resolve({ annotations: [], generalNote: "second" }));
    expect(container.textContent).toBe("second");
    await act(async () => { await Bun.sleep(350); });
    expect(writes).toEqual(["second"]);
  });

  test("remote annotations stay read-only and are not persisted", async () => {
    let state: AnnotationContextValue | undefined;
    const writes: AnnotationState[] = [];
    function Probe() { state = useAnnotations(); return null; }
    root = createRoot(mountContainer(""));
    await act(async () => root?.render(
      <AnnotationProvider scope="remote" loadState={async () => saved} saveState={(_scope, value) => writes.push(value)}
        remoteAnnotations={[{ id: "remote", snippet: "remote text", note: "remote note", createdAt: "2026-01-01" }]}
      ><Probe /></AnnotationProvider>,
    ));
    await act(async () => {
      state?.updateAnnotation("remote", "changed");
      state?.removeAnnotation("remote");
    });
    expect(state?.annotations.find((annotation) => annotation.id === "remote")?.note).toBe("remote note");
    await act(async () => state?.clearAll());
    expect(writes.at(-1)).toEqual({ annotations: [], generalNote: "" });
    expect(state?.annotations.map((annotation) => annotation.id)).toEqual(["remote"]);
  });
});
