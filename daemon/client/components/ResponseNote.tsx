import React from "react";
import { autoResizeTextarea } from "../utils";

/** Seamless note input for response components */
export function ResponseNote({ note, onChange }: { show?: boolean; note: string; onToggle?: () => void; onChange: (n: string) => void }) {
  return (
    <div className="mt-1.5">
      <textarea
        value={note}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-[12px] font-body text-text-primary resize-none focus:outline-none border-none placeholder:text-text-disabled transition-colors min-h-[20px] p-0 leading-relaxed"
        placeholder="Add a note..."
        rows={1}
        onInput={(e) => autoResizeTextarea(e.target as HTMLTextAreaElement)}
        ref={(el) => { if (el) autoResizeTextarea(el); }}
      />
    </div>
  );
}
