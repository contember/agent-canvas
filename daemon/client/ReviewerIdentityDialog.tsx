import React, { useState, useEffect, useRef } from "react";

/**
 * Modal shown in shared mode when a reviewer submits feedback without a
 * cached identity. Asks for a display name that will appear on the
 * reviewer's annotations when they land in the canvas author's local view.
 *
 * Identity is persisted in localStorage so the prompt only appears once
 * per browser per share worker origin. The id is a random UUID — never
 * tied to any authenticated account, just enough to group annotations by
 * the same reviewer across revisions.
 */
interface ReviewerIdentityDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function ReviewerIdentityDialog({ open, onClose, onSubmit }: ReviewerIdentityDialogProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 80;

  const handleSubmit = () => {
    if (!valid) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-surface border border-border-medium rounded-lg shadow-xl w-full max-w-md mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-primary font-body">
            Your name
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          >
            <span className="text-xs">&#x2715;</span>
          </button>
        </div>

        <p className="text-[13px] text-text-secondary font-body mb-3 leading-relaxed">
          Before you leave feedback, please enter a name so the canvas author
          knows who reviewed it. This is stored locally in your browser.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          maxLength={80}
          placeholder="e.g. Alice"
          className="w-full px-3 py-2 text-[13px] font-body bg-bg-input border border-border-medium rounded text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-accent-blue"
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] font-body font-medium rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid}
            className="px-3 py-1.5 text-[12px] font-body font-medium rounded bg-accent-blue text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Submit feedback
          </button>
        </div>
      </div>
    </div>
  );
}
