import React, { useEffect, useState } from "react";
import { useAnnotations } from "@canvas/runtime";
import { ResponseNote } from "./ResponseNote";

/** Radio — pick one option */
interface ChoiceProps {
  id: string;
  label: string;
  options: string[];
  required?: boolean;
}

export function Choice({ id, label, options, required }: ChoiceProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const selected = current?.value as string | undefined;
  const note = current?.note || "";
  const [showNote, setShowNote] = useState(false);

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "radio", label, value: null, options, required });
    }
  }, [id]);

  const handleSelect = (opt: string) => {
    setResponse(id, { ...current!, value: opt });
  };

  const showError = current?.required && !selected;

  return (
    <div className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
        {required && <span className="text-[10px] text-accent-red font-body">*</span>}
      </div>
      <div className="space-y-1">
        {options.map((opt) => (
          <label
            key={opt}
            onClick={() => handleSelect(opt)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 ${
              selected === opt
                ? "bg-highlight-selected"
                : "hover:bg-bg-elevated"
            }`}
          >
            <span className={`w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all ${
              selected === opt
                ? "border-accent-amber bg-accent-amber"
                : "border-border-strong"
            }`}>
              {selected === opt && <span className="w-1.5 h-1.5 rounded-full bg-text-inverse" />}
            </span>
            <span className="text-[13px] font-body text-text-secondary">{opt}</span>
          </label>
        ))}
      </div>
      <ResponseNote show={showNote} note={note} onToggle={() => setShowNote(!showNote)} onChange={(n) => setResponse(id, { ...current!, note: n })} />
      {showError && <p className="text-[11px] text-accent-red font-body mt-1">Please select an option.</p>}
    </div>
  );
}

/** Checkbox — pick multiple options */
interface MultiChoiceProps {
  id: string;
  label: string;
  options: string[];
  required?: boolean;
}

export function MultiChoice({ id, label, options, required }: MultiChoiceProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const selected: string[] = (current?.value as string[]) || [];
  const note = current?.note || "";
  const [showNote, setShowNote] = useState(false);

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "checkbox", label, value: [], options, required });
    }
  }, [id]);

  const toggle = (opt: string) => {
    const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
    setResponse(id, { ...current!, value: next });
  };

  const showError = current?.required && selected.length === 0;

  return (
    <div className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
        {required && <span className="text-[10px] text-accent-red font-body">*</span>}
      </div>
      <div className="space-y-1">
        {options.map((opt) => {
          const checked = selected.includes(opt);
          return (
            <label
              key={opt}
              onClick={() => toggle(opt)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 ${
                checked ? "bg-highlight-selected" : "hover:bg-bg-elevated"
              }`}
            >
              <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                checked
                  ? "bg-accent-amber"
                  : "border-[1.5px] border-border-strong"
              }`}>
                {checked && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 5L4.5 7L7.5 3" style={{ stroke: "var(--color-text-inverse)" }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className="text-[13px] font-body text-text-secondary">{opt}</span>
            </label>
          );
        })}
      </div>
      <ResponseNote show={showNote} note={note} onToggle={() => setShowNote(!showNote)} onChange={(n) => setResponse(id, { ...current!, note: n })} />
      {showError && <p className="text-[11px] text-accent-red font-body mt-1">Please select at least one option.</p>}
    </div>
  );
}

