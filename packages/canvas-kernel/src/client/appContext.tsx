import { createContext } from "react";
import type { ActiveView } from "#canvas/runtime";

/**
 * Shell state the annotation surface reads but does not own.
 *
 * The kernel ships no app shell — each host builds its own chrome — but the
 * reusable annotation surface still needs to know which revision is on screen
 * and how to navigate. The host provides both contexts around the surface.
 */

export type { ActiveView };

export interface CanvasFileInfo {
  filename: string;
  diffStats?: { added: number; removed: number };
}

export interface RevisionInfo {
  revision: number;
  label?: string;
  canvasFiles: CanvasFileInfo[];
  createdAt: string;
  hasFeedback: boolean;
  feedbackConsumed: boolean;
  response?: string;
}

export const ActiveViewContext = createContext<{
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
  openFiles: string[];
  closeFile: (path: string) => void;
  canvasFiles: string[];
}>({
  activeView: { type: "overview" },
  setActiveView: () => {},
  openFiles: [],
  closeFile: () => {},
  canvasFiles: [],
});

export const RevisionContext = createContext<{
  currentRevision: number;
  selectedRevision: number;
  revisions: RevisionInfo[];
  setSelectedRevision: (rev: number) => void;
  isReadOnly: boolean;
  compareRevision: { left: number; right: number } | null;
  setCompareRevision: (rev: { left: number; right: number } | null) => void;
  agentWatching: boolean;
}>({
  currentRevision: 1,
  selectedRevision: 1,
  revisions: [],
  setSelectedRevision: () => {},
  isReadOnly: false,
  compareRevision: null,
  setCompareRevision: () => {},
  agentWatching: false,
});
