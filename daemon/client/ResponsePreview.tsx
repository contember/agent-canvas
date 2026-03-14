import React, { useEffect, useState, useRef, useMemo } from "react";
import { useAnnotations } from "./AnnotationProvider";
import { generateMarkdown, getMissingRequired, getMissingRequiredFeedback } from "./generateMarkdown";

interface ResponsePreviewProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
}

export function ResponsePreview({ open, onClose, onSubmit }: ResponsePreviewProps) {
  const { annotations, generalNote, responses, feedbackEntries } = useAnnotations();
  const [text, setText] = useState("");
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) { setManuallyEdited(false); setEditMode(false); setValidationError(null); return; }
    if (manuallyEdited) return;
    setText(generateMarkdown(annotations, generalNote, responses, feedbackEntries));
  }, [annotations, generalNote, responses, feedbackEntries, manuallyEdited, open]);

  useEffect(() => {
    if (open && editMode && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open, editMode]);

  if (!open) return null;

  const hasContent = text.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-8" onClick={onClose}>
      <div className="bg-bg-surface border border-border-medium rounded-xl shadow-lg w-full max-w-2xl flex flex-col" style={{ height: "80vh" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-text-primary font-body">Response preview</span>
            {manuallyEdited && (
              <button onClick={() => { setManuallyEdited(false); setEditMode(false); }} className="text-[11px] text-text-tertiary hover:text-text-secondary font-body">
                Reset
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex items-center bg-bg-base rounded-md p-0.5">
              <button
                onClick={() => setEditMode(false)}
                className={`px-2.5 py-1 rounded text-[11px] font-body font-medium transition-colors ${
                  !editMode ? "bg-bg-elevated text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setEditMode(true)}
                className={`px-2.5 py-1 rounded text-[11px] font-body font-medium transition-colors ${
                  editMode ? "bg-bg-elevated text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Edit
              </button>
            </div>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary w-7 h-7 flex items-center justify-center rounded-md hover:bg-border-subtle transition-colors">
              &#x2715;
            </button>
          </div>
        </div>

        {/* Content */}
        {editMode ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setManuallyEdited(true); }}
            className="flex-1 w-full bg-bg-base p-5 text-[13px] font-mono text-text-code resize-none focus:outline-none leading-relaxed placeholder:text-text-disabled"
            placeholder="Your feedback will appear here..."
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <MarkdownPreview text={text} />
          </div>
        )}

        {/* Actions */}
        {validationError && (
          <div className="px-5 py-2 text-[12px] text-accent-red font-body border-t border-border-subtle flex-shrink-0 flex items-center justify-between gap-2">
            <span>{validationError}</span>
            <button
              onClick={() => {
                setValidationError(null);
                onSubmit(text);
              }}
              className="text-[11px] text-text-tertiary hover:text-text-secondary font-body whitespace-nowrap underline"
            >
              Submit anyway
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-subtle flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-body text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const missingResponses = getMissingRequired(responses);
              const missingFeedback = getMissingRequiredFeedback(feedbackEntries);
              const allMissing = [
                ...missingResponses.map((r) => r.label),
                ...missingFeedback.map((e) => e.label || e.id),
              ];
              if (allMissing.length > 0) {
                setValidationError(`Please answer: ${allMissing.join(", ")}`);
                return;
              }
              setValidationError(null);
              onSubmit(text);
            }}
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

export function MarkdownPreview({ text }: { text: string }) {
  const elements = useMemo(() => parseMarkdown(text), [text]);
  return <div className="font-body text-body text-text-primary leading-relaxed">{elements}</div>;
}

function InlineText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) parts.push(<strong key={key++} className="font-semibold text-text-primary">{match[2]}</strong>);
    else if (match[3]) parts.push(<code key={key++} className="font-mono text-code bg-bg-code px-1 py-px rounded">{match[3]}</code>);
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function parseMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith("#### ")) {
      elements.push(<h4 key={key++} className="text-[13px] font-body font-semibold text-text-primary mt-5 mb-1">{line.slice(5)}</h4>);
      i++; continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h3 key={key++} className="text-[14px] font-body font-semibold text-text-primary mt-5 mb-1">{line.slice(4)}</h3>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={key++} className="text-task-label font-body font-semibold text-text-primary mt-6 mb-2 pb-1 border-b border-border-subtle">{line.slice(3)}</h2>);
      i++; continue;
    }

    // Blockquote — collect consecutive > lines
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={key++} className="border-l-2 border-border-hover pl-3 my-2 text-text-secondary italic text-[13px]">
          {quoteLines.map((ql, j) => <div key={j}>{ql}</div>)}
        </blockquote>
      );
      continue;
    }

    // Checkbox list — collect consecutive - [x]/- [ ] lines
    if (line.startsWith("- [x] ") || line.startsWith("- [ ] ")) {
      const items: { checked: boolean; label: string }[] = [];
      while (i < lines.length && (lines[i].startsWith("- [x] ") || lines[i].startsWith("- [ ] "))) {
        items.push({ checked: lines[i].startsWith("- [x] "), label: lines[i].slice(6) });
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1 space-y-0.5">
          {items.map((item, j) => (
            <li key={j} className="flex items-center gap-2 text-[13px]">
              <span className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 ${item.checked ? "bg-accent-amber" : "border border-border-hover"}`}>
                {item.checked && (
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 5L4.5 7L7.5 3" style={{ stroke: "var(--color-text-inverse)" }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className={item.checked ? "text-text-primary" : "text-text-tertiary"}>{item.label}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Regular list — collect consecutive - lines
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1 space-y-0.5 list-disc list-inside">
          {items.map((item, j) => <li key={j} className="text-[13px] text-text-secondary"><InlineText text={item} /></li>)}
        </ul>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Paragraph
    elements.push(<p key={key++} className="my-1.5 text-[13px]"><InlineText text={line} /></p>);
    i++;
  }

  return elements;
}
