import React, { useEffect, useState, useContext, useCallback, useMemo } from "react";
import { SessionContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { ActiveViewContext } from "./App";
import { FileIcon } from "./FileIcon";
import { RESPONSE_ANNOTATION_PATH } from "./utils";
import { FS_AVAILABLE } from "./clientApi";

interface TreeEntry { name: string; type: "file" | "dir"; }
interface DirState { entries: TreeEntry[]; expanded: boolean; loaded: boolean; }

export function FileBrowser({ embedded }: { embedded?: boolean } = {}) {
  const sessionId = useContext(SessionContext);
  const { annotations, addAnnotation } = useAnnotations();
  const { setActiveView } = useContext(ActiveViewContext);
  const [collapsed, setCollapsed] = useState(false);
  const [dirs, setDirs] = useState<Record<string, DirState>>({});

  // Shared-mode canvases have no filesystem backing — the daemon's /api/tree
  // endpoint isn't reachable. Render a simple placeholder so reviewers see
  // something informative instead of a broken tree.
  if (!FS_AVAILABLE) {
    return (
      <div className={embedded ? "px-4 py-3" : "p-4"}>
        <div className="text-[11px] uppercase tracking-widest text-text-tertiary font-body mb-2">Files</div>
        <p className="text-[11px] text-text-tertiary font-body leading-relaxed">
          File browsing is not available in shared view. File previews embedded
          in the canvas still work.
        </p>
      </div>
    );
  }

  const { annCountMap, annotatedFiles } = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) {
      if (a.filePath && a.filePath !== RESPONSE_ANNOTATION_PATH) map.set(a.filePath, (map.get(a.filePath) || 0) + 1);
    }
    return { annCountMap: map, annotatedFiles: [...map.keys()] };
  }, [annotations]);

  const loadDir = async (path: string) => {
    const res = await fetch(`/api/tree?session=${sessionId}&path=${encodeURIComponent(path)}`);
    const data = await res.json() as any;
    if (data.entries) setDirs((prev) => ({ ...prev, [path]: { entries: data.entries, expanded: true, loaded: true } }));
  };

  useEffect(() => { if (!collapsed && !dirs[""]) loadDir(""); }, [collapsed]);

  const toggleDir = (path: string) => {
    if (dirs[path]?.loaded) setDirs((prev) => ({ ...prev, [path]: { ...prev[path], expanded: !prev[path].expanded } }));
    else loadDir(path);
  };

  const openFile = (path: string) => {
    setActiveView({ type: "file", path });
  };

  const addWholeFile = async (path: string) => {
    const res = await fetch(`/api/file?session=${sessionId}&path=${encodeURIComponent(path)}`);
    const data = await res.json() as any;
    if (!data.error) {
      const preview = data.content.split("\n").slice(0, 3).join("\n") + (data.content.split("\n").length > 3 ? "\n..." : "");
      addAnnotation(preview, "Include this file for context", path);
    }
  };

  const addWholeDir = async (path: string) => {
    // Load dir if needed, then add all files
    let entries: TreeEntry[] = [];
    if (dirs[path]?.loaded) {
      entries = dirs[path].entries;
    } else {
      const res = await fetch(`/api/tree?session=${sessionId}&path=${encodeURIComponent(path)}`);
      const data = await res.json() as any;
      if (data.entries) entries = data.entries;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.type === "file")
        .map((entry) => addWholeFile(path ? `${path}/${entry.name}` : entry.name))
    );
  };

  const getAnnCount = (path: string) => annCountMap.get(path) || 0;

  const renderTree = (basePath: string, depth: number = 0): React.ReactNode => {
    const dir = dirs[basePath];
    if (!dir?.expanded) return null;
    return dir.entries.map((entry) => {
      const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      const annCount = getAnnCount(fullPath);

      return (
        <div key={fullPath}>
          <div
            className="group/item flex items-center py-[3px] hover:bg-bg-elevated text-[13px] font-body cursor-default transition-colors duration-100"
            style={{ paddingLeft: `${16 + depth * 16}px`, paddingRight: "8px" }}
          >
            {entry.type === "dir" ? (
              <>
                <span onClick={() => toggleDir(fullPath)} className="flex items-center gap-1.5 flex-1 text-text-secondary hover:text-text-primary cursor-pointer truncate">
                  <FileIcon name={entry.name} type="dir" expanded={dirs[fullPath]?.expanded} />
                  <span className="truncate">{entry.name}</span>
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); addWholeDir(fullPath); }}
                  className="text-[11px] text-text-tertiary hover:text-text-secondary opacity-0 group-hover/item:opacity-100 transition-opacity px-1 flex-shrink-0"
                  title="Add all files in folder"
                >
                  +
                </button>
              </>
            ) : (
              <>
                <span
                  onClick={() => openFile(fullPath)}
                  className={`flex-1 truncate cursor-pointer flex items-center gap-1.5 ${annCount > 0 ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
                >
                  <FileIcon name={entry.name} type="file" />
                  <span className="truncate">{entry.name}</span>
                </span>
                {/* Right side: annotation badge + add button */}
                <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                  {annCount > 0 && (
                    <span className="text-[10px] font-medium bg-badge-bg text-accent-amber px-1.5 py-px rounded-full min-w-[18px] text-center">
                      {annCount}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); addWholeFile(fullPath); }}
                    className="text-[11px] text-text-tertiary hover:text-text-secondary opacity-0 group-hover/item:opacity-100 transition-opacity px-1"
                    title="Add file to context"
                  >
                    +
                  </button>
                </div>
              </>
            )}
          </div>
          {entry.type === "dir" && renderTree(fullPath, depth + 1)}
        </div>
      );
    });
  };

  if (embedded) {
    return (
      <>
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
          <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body">Files</span>
        </div>
        <div className="flex-1 overflow-y-auto">{renderTree("")}</div>
        {annotatedFiles.length > 0 && (
          <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
            <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body mb-1.5">Referenced</div>
            {annotatedFiles.map((f) => (
              <div key={f} onClick={() => openFile(f)} className="flex items-center justify-between text-[12px] font-body text-text-secondary hover:text-text-primary cursor-pointer py-0.5">
                <span className="truncate">{f.split("/").pop()}</span>
                <span className="text-[10px] font-medium bg-badge-bg text-accent-amber px-1.5 py-px rounded-full min-w-[18px] text-center flex-shrink-0 ml-1">
                  {getAnnCount(f)}
                </span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (collapsed) {
    return (
      <div className="hidden lg:flex w-8 border-r border-border-subtle bg-bg-surface flex-col items-center flex-shrink-0">
        <button onClick={() => setCollapsed(false)} className="mt-3 p-1 text-text-tertiary hover:text-text-secondary transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex w-60 border-r border-border-subtle bg-bg-surface flex-col flex-shrink-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body">Files</span>
        <button onClick={() => setCollapsed(true)} className="text-text-tertiary hover:text-text-secondary transition-colors p-0.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{renderTree("")}</div>

      {annotatedFiles.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body mb-1.5">Referenced</div>
          {annotatedFiles.map((f) => (
            <div key={f} onClick={() => openFile(f)} className="flex items-center justify-between text-[12px] font-body text-text-secondary hover:text-text-primary cursor-pointer py-0.5">
              <span className="truncate">{f.split("/").pop()}</span>
              <span className="text-[10px] font-medium bg-badge-bg text-accent-amber px-1.5 py-px rounded-full min-w-[18px] text-center flex-shrink-0 ml-1">
                {getAnnCount(f)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
