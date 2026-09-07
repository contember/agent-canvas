import React, { useEffect, useState } from "react";
import { AnnotationCtx, SessionContext, useAnnotationHost } from "@fabrika/annotations/runtime";
import type { Annotation, AnnotationState } from "./runtime";
import { useAnnotationState } from "./useAnnotationState";

export type { Annotation, AnnotationContext, AnnotationState, AnnotationContextValue } from "./runtime";
export { useAnnotations } from "@fabrika/annotations/runtime";

export interface AnnotationProviderProps {
  scope: string;
  isReadOnly?: boolean;
  remoteAnnotations?: Annotation[];
  loadState: (scope: string) => Promise<AnnotationState | null>;
  saveState: (scope: string, state: AnnotationState) => void;
  children: React.ReactNode;
}

export function AnnotationProvider(props: AnnotationProviderProps) {
  return <AnnotationDraft key={props.scope} {...props} />;
}

function AnnotationDraft({ scope, isReadOnly = false, remoteAnnotations, loadState, saveState, children }: AnnotationProviderProps) {
  const host = useAnnotationHost();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [generalNote, setGeneralNote] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const value = useAnnotationState({
    annotations, setAnnotations, generalNote, setGeneralNote, remoteAnnotations, isReadOnly,
    onClear: () => saveState(scope, { annotations: [], generalNote: "" }),
  });

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    loadState(scope).then((saved) => {
      if (cancelled) return;
      setAnnotations(saved?.annotations ?? []);
      setGeneralNote(saved?.generalNote ?? "");
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [scope, loadState]);

  useEffect(() => {
    if (!hydrated || isReadOnly) return;
    const timer = setTimeout(() => saveState(scope, { annotations, generalNote }), 300);
    return () => clearTimeout(timer);
  }, [scope, annotations, generalNote, hydrated, isReadOnly, saveState]);

  return (
    <SessionContext.Provider value={host.sessionId}>
      <AnnotationCtx.Provider value={value}>{children}</AnnotationCtx.Provider>
    </SessionContext.Provider>
  );
}
