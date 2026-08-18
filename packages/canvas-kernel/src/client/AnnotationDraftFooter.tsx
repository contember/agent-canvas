import type React from "react";
import { useAnnotations } from "./AnnotationProvider";
import { autoResizeTextarea } from "./utils";

/**
 * The foot of a draft: the note that belongs to no one annotation, and the
 * action that sends the draft off.
 *
 * What counts as content, and what the payload looks like, is the host's —
 * hence `hasContent` and a bare `onSubmit`. The two slots are where a host
 * hangs whatever else its submit step needs (a preview button, a validation
 * notice) without this component learning about it.
 */
export interface AnnotationDraftFooterProps {
  /** Whether the draft says anything. Hosts count more than annotations and
   *  the general note, so they decide. */
  hasContent: boolean;
  onSubmit: () => void;
  /** Submitting an empty draft — an explicit "nothing to say", not a no-op. */
  onSubmitEmpty: () => void;
  /** Sits between the note and the actions: validation, status, a warning. */
  notice?: React.ReactNode;
  /** Sits left of the submit button, sharing the row. */
  secondaryAction?: React.ReactNode;
  placeholder?: string;
  submitLabel?: string;
  emptyLabel?: string;
}

export function AnnotationDraftFooter({
  hasContent, onSubmit, onSubmitEmpty, notice, secondaryAction,
  placeholder = "General notes...",
  submitLabel = "Submit",
  emptyLabel = "Submit without feedback",
}: AnnotationDraftFooterProps) {
  const { generalNote, setGeneralNote } = useAnnotations();

  return (
    <>
      {/* General note — seamless */}
      <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
        <textarea
          value={generalNote}
          onChange={(e) => setGeneralNote(e.currentTarget.value)}
          className="w-full bg-transparent text-[13px] font-body text-text-primary resize-none leading-relaxed p-0 border-none ring-0 shadow-none outline-none focus:outline-none focus:ring-0 focus:border-none placeholder:text-text-disabled min-h-[40px]"
          placeholder={placeholder}
          onInput={(e) => autoResizeTextarea(e.currentTarget, 40)}
          ref={(el) => { if (el) autoResizeTextarea(el, 40); }}
        />
      </div>

      {notice}

      <div className="px-4 py-3 border-t border-border-subtle flex-shrink-0">
        {hasContent ? (
          <div className="flex gap-2">
            {secondaryAction}
            <button
              onClick={onSubmit}
              className="flex-1 py-2 rounded-lg font-body text-[13px] font-medium transition-all bg-btn-primary text-btn-primary-text hover:opacity-90 hover:-translate-y-px shadow-sm"
            >
              {submitLabel}
            </button>
          </div>
        ) : (
          <button
            onClick={onSubmitEmpty}
            className="w-full py-2 rounded-lg font-body text-[13px] font-medium border border-border-medium text-text-secondary hover:text-text-primary hover:border-border-hover hover:bg-bg-input transition-all"
          >
            {emptyLabel}
          </button>
        )}
      </div>
    </>
  );
}
