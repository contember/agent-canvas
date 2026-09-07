import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AnnotationCtx } from "#canvas/runtime";
import type { Annotation, AnnotationContext, PlanResponse, FeedbackEntry, AnnotationContextValue } from "#canvas/runtime";
import { annotationDraftKey, clearPersistedDraft, type AnnotationDraftPhase } from "./annotationDraft";
import { canPruneResponses, pruneStaleResponses } from "./generateMarkdown";
import { useAnnotationState } from "@fabrika/annotations";
import { AnnotationCtx as SurfaceAnnotationCtx, AnnotationHostContext } from "@fabrika/annotations/runtime";
import { useCanvasHost } from "./hostContext";

// Re-export types for convenience
export type { Annotation, AnnotationContext, PlanResponse, FeedbackEntry, AnnotationContextValue };
export { useAnnotations } from "#canvas/runtime";

export interface PersistedState {
  annotations: Annotation[];
  generalNote: string;
  responses: [string, PlanResponse][];
  feedbackEntries?: [string, FeedbackEntry][];
}

interface AnnotationProviderProps {
  sessionId: string;
  revision: number;
  isReadOnly: boolean;
  draftPhase: AnnotationDraftPhase;
  /** Remote annotations fetched from shared views. Merged read-only into
   *  the annotation list so they render alongside the author's own. */
  remoteAnnotations?: Annotation[];
  /** Canvas files this revision is made of. Supplying it enables pruning of
   *  answers to questions the revision no longer asks; omit it and every
   *  answer is submitted, which is what a host without canvas tabs wants. */
  canvasFiles?: readonly string[];
  /** Server-authoritative persistence. When supplied, the draft is loaded and
   *  saved through these instead of localStorage, so it survives reloads and
   *  follows the author across browsers. Omit for the localStorage default. */
  loadState?: (sessionId: string, revision: number, phase: AnnotationDraftPhase) => Promise<PersistedState | null>;
  saveState?: (sessionId: string, revision: number, state: PersistedState, phase: AnnotationDraftPhase) => void;
  children: React.ReactNode;
}

function loadPersisted(sessionId: string, revision: number, phase: AnnotationDraftPhase): PersistedState | null {
  try {
    const raw = localStorage.getItem(annotationDraftKey(sessionId, revision, phase));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersisted(sessionId: string, revision: number, phase: AnnotationDraftPhase, state: PersistedState) {
  try {
    localStorage.setItem(annotationDraftKey(sessionId, revision, phase), JSON.stringify(state));
  } catch {}
}

/** What the reader has been shown for one draft. Stamped with the draft it
 *  belongs to rather than cleared in an effect: response controls register from
 *  their own effects, which run before the provider's, so an effect-based reset
 *  would wipe registrations that already happened. */
interface SeenState {
  draft: string;
  responseIds: Set<string>;
  canvases: Set<string>;
}

function seenFor(draft: string): SeenState {
  return { draft, responseIds: new Set(), canvases: new Set() };
}

export function AnnotationProvider({ sessionId, revision, isReadOnly, draftPhase, remoteAnnotations, canvasFiles, loadState, saveState, children }: AnnotationProviderProps) {
  // Server-authoritative persistence loads asynchronously, so that mode starts
  // empty and hydrates in an effect. localStorage mode seeds synchronously.
  const serverMode = !!loadState;
  const seed = serverMode ? null : loadPersisted(sessionId, revision, draftPhase);

  const [localAnnotations, setAnnotations] = useState<Annotation[]>(() =>
    (seed?.annotations ?? []).map((a) => ({ ...a, source: a.source ?? "local" as const })),
  );

  const [generalNote, setGeneralNote] = useState(() => seed?.generalNote ?? "");
  const [responses, setResponses] = useState<Map<string, PlanResponse>>(() =>
    seed?.responses ? new Map(seed.responses) : new Map(),
  );
  const draftId = `${sessionId}:${revision}:${draftPhase}`;
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  const [seen, setSeen] = useState<SeenState>(() => seenFor(draftId));
  const [feedbackEntries, setFeedbackEntries] = useState<Map<string, FeedbackEntry>>(() =>
    seed?.feedbackEntries ? new Map(seed.feedbackEntries) : new Map(),
  );

  // Re-hydrate when the draft identity changes. Hosts that remount the provider
  // per revision (via a key) get this for free from the initializers, but hosts
  // that keep it mounted need it here — otherwise one revision's answers leak
  // into the next and the persist effect writes them over the new revision's
  // saved draft. `hydrated` gates that effect so an async server load cannot be
  // clobbered by the empty initial state.
  const [hydrated, setHydrated] = useState(!serverMode);
  useEffect(() => {
    const apply = (saved: PersistedState | null) => {
      setAnnotations((saved?.annotations ?? []).map((a) => ({ ...a, source: a.source ?? "local" as const })));
      setGeneralNote(saved?.generalNote ?? "");
      setResponses(saved?.responses ? new Map(saved.responses) : new Map());
      setFeedbackEntries(saved?.feedbackEntries ? new Map(saved.feedbackEntries) : new Map());
      setActiveAnnotationId(null);
    };
    if (serverMode) {
      let cancelled = false;
      setHydrated(false);
      loadState!(sessionId, revision, draftPhase).then((saved) => {
        if (cancelled) return;
        apply(saved);
        setHydrated(true);
      });
      return () => { cancelled = true; };
    }
    apply(loadPersisted(sessionId, revision, draftPhase));
    setHydrated(true);
    return undefined;
  }, [sessionId, revision, draftPhase, serverMode, loadState]);

  // Post-feedback drafts save immediately so a new revision can carry the latest edit.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isReadOnly && draftPhase !== "next") return;
    if (!hydrated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const state: PersistedState = {
      // Persist only local annotations — remote ones are re-fetched on load.
      annotations: localAnnotations,
      generalNote,
      responses: Array.from(responses.entries()),
      feedbackEntries: Array.from(feedbackEntries.entries()),
    };
    const persist = () => {
      if (saveState) saveState(sessionId, revision, state, draftPhase);
      else savePersisted(sessionId, revision, draftPhase, state);
    };
    if (draftPhase === "next") {
      persist();
      return;
    }
    persistTimerRef.current = setTimeout(persist, 300);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [localAnnotations, generalNote, responses, feedbackEntries, sessionId, revision, isReadOnly, draftPhase, hydrated, saveState]);

  const setResponse = useCallback((id: string, response: PlanResponse) => {
    setResponses((prev) => {
      const next = new Map(prev);
      next.set(id, response);
      return next;
    });
  }, []);

  // Both registrations accumulate for the life of one draft and are idempotent,
  // so re-running the caller's effect cannot loop.
  const registerResponse = useCallback((id: string) => {
    setSeen((prev) => {
      const base = prev.draft === draftIdRef.current ? prev : seenFor(draftIdRef.current);
      if (base.responseIds.has(id)) return base;
      return { ...base, responseIds: new Set(base.responseIds).add(id) };
    });
  }, []);

  const registerCanvasRendered = useCallback((filename: string) => {
    setSeen((prev) => {
      const base = prev.draft === draftIdRef.current ? prev : seenFor(draftIdRef.current);
      if (base.canvases.has(filename)) return base;
      return { ...base, canvases: new Set(base.canvases).add(filename) };
    });
  }, []);

  // Answers survive until a canvas proves the question is gone. `seen` can lag
  // the draft by a render when the host keeps the provider mounted across
  // revisions, and stale evidence must never prune.
  const current = seen.draft === draftId ? seen : null;
  const submittableResponses = useMemo(() => {
    if (!current || !canPruneResponses(canvasFiles, current.canvases)) return responses;
    return pruneStaleResponses(responses, current.responseIds);
  }, [current, canvasFiles, responses]);

  const setFeedbackEntry = useCallback((id: string, entry: FeedbackEntry) => {
    setFeedbackEntries((prev) => {
      const existing = prev.get(id);
      if (existing && existing.markdown === entry.markdown && existing.label === entry.label && existing.required === entry.required) {
        return prev; // same reference → no re-render
      }
      const next = new Map(prev);
      next.set(id, entry);
      return next;
    });
  }, []);

  const removeFeedbackEntry = useCallback((id: string) => {
    setFeedbackEntries((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearCanvasState = useCallback(() => {
    setResponses(new Map());
    setFeedbackEntries(new Map());
    if (saveState) {
      saveState(sessionId, revision, { annotations: [], generalNote: "", responses: [], feedbackEntries: [] }, draftPhase);
    } else if (draftPhase === "next") {
      localStorage.removeItem(annotationDraftKey(sessionId, revision, draftPhase));
    } else {
      clearPersistedDraft(localStorage, sessionId, revision);
    }
  }, [sessionId, revision, draftPhase, saveState]);

  const annotationState = useAnnotationState({
    annotations: localAnnotations, setAnnotations, generalNote, setGeneralNote,
    remoteAnnotations, isReadOnly, onClear: clearCanvasState,
  });
  const { setActiveAnnotationId } = annotationState;
  const host = useCanvasHost();

  return (
    <AnnotationHostContext.Provider value={host}>
      <SurfaceAnnotationCtx.Provider value={annotationState}>
        <AnnotationCtx.Provider
          value={{
            ...annotationState,
            responses, setResponse, submittableResponses,
            registerResponse, registerCanvasRendered,
            feedbackEntries, setFeedbackEntry, removeFeedbackEntry,
          }}
        >
          {children}
        </AnnotationCtx.Provider>
      </SurfaceAnnotationCtx.Provider>
    </AnnotationHostContext.Provider>
  );
}
