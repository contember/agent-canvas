import React from "react";

/** Shared note toggle for response components */
export function ResponseNote({ show, note, onToggle, onChange }: { show: boolean; note: string; onToggle: () => void; onChange: (n: string) => void }) {
  return (
    <div className="mt-1.5">
      {!show && !note ? (
        <button onClick={onToggle} className="text-[11px] text-text-tertiary hover:text-text-secondary font-body transition-colors">
          + Add note
        </button>
      ) : (
        <textarea
          value={note}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-input text-[12px] font-body text-text-primary rounded-md px-2.5 py-1.5 resize-none focus:outline-none border border-border-subtle focus:border-border-hover placeholder:text-text-tertiary transition-colors min-h-[28px]"
          placeholder="Add a note..."
          rows={1}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = Math.max(28, t.scrollHeight) + "px";
          }}
          ref={(el) => {
            if (el) { el.style.height = "auto"; el.style.height = Math.max(28, el.scrollHeight) + "px"; }
          }}
        />
      )}
    </div>
  );
}
