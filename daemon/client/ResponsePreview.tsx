import React, { useEffect, useState, useRef } from "react";
import { useAnnotations } from "./AnnotationProvider";
import { generateMarkdown } from "./generateMarkdown";

interface ResponsePreviewProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
}

export function ResponsePreview({ open, onClose, onSubmit }: ResponsePreviewProps) {
  const { annotations, generalNote, responses } = useAnnotations();
  const [text, setText] = useState("");
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) { setManuallyEdited(false); setSubmitted(false); return; }
    if (manuallyEdited) return;
    setText(generateMarkdown(annotations, generalNote, responses));
  }, [annotations, generalNote, responses, manuallyEdited, open]);


  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
        <div className="bg-bg-elevated border border-border-hover rounded-xl shadow-lg p-8 flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <span className="text-accent-green text-body font-body">Feedback sent</span>
          <button onClick={onClose} className="text-meta text-text-tertiary hover:text-text-secondary font-body mt-2">Close</button>
        </div>
      </div>
    );
  }

  const hasContent = text.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-8" onClick={onClose}>
      <div className="bg-bg-surface border border-border-medium rounded-xl shadow-lg w-full max-w-2xl flex flex-col" style={{ height: "80vh" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-text-primary font-body">Response preview</span>
            {manuallyEdited && (
              <button onClick={() => setManuallyEdited(false)} className="text-[11px] text-text-tertiary hover:text-text-secondary font-body">
                Reset
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary w-7 h-7 flex items-center justify-center rounded-md hover:bg-border-subtle transition-colors">
            &#x2715;
          </button>
        </div>

        {/* Editable textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setManuallyEdited(true); }}
          className="flex-1 w-full bg-bg-base p-5 text-[13px] font-mono text-text-code resize-none focus:outline-none leading-relaxed placeholder:text-text-disabled"
          placeholder="Your feedback will appear here..."
        />

        {/* Actions */}
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border-subtle flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-body text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSubmit(text); setSubmitted(true); }}
            disabled={!hasContent}
            className={`px-6 py-2 rounded-lg font-body text-[13px] font-medium transition-all ${
              hasContent
                ? "bg-btn-primary text-btn-primary-text hover:opacity-90"
                : "bg-bg-input text-text-disabled cursor-default"
            }`}
          >
            Submit feedback
          </button>
        </div>
      </div>
    </div>
  );
}
