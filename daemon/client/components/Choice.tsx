import React, { useEffect } from "react";
import { useAnnotations } from "@planner/runtime";

/** Radio — pick one option */
interface ChoiceProps {
  id: string;
  label: string;
  options: string[];
  /** Optional default value */
  defaultValue?: string;
}

export function Choice({ id, label, options, defaultValue }: ChoiceProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const selected = current?.value as string | undefined;

  // Register with default on mount
  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "radio", label, value: defaultValue || null, options });
    }
  }, [id]);

  const handleSelect = (opt: string) => {
    setResponse(id, { id, type: "radio", label, value: opt, options });
  };

  return (
    <div className="my-3">
      <div className="text-[13px] font-body font-medium text-text-primary mb-2">{label}</div>
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
    </div>
  );
}

/** Checkbox — pick multiple options */
interface MultiChoiceProps {
  id: string;
  label: string;
  options: string[];
  defaultValue?: string[];
}

export function MultiChoice({ id, label, options, defaultValue }: MultiChoiceProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const selected: string[] = (current?.value as string[]) || [];

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "checkbox", label, value: defaultValue || [], options });
    }
  }, [id]);

  const toggle = (opt: string) => {
    const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
    setResponse(id, { id, type: "checkbox", label, value: next, options });
  };

  return (
    <div className="my-3">
      <div className="text-[13px] font-body font-medium text-text-primary mb-2">{label}</div>
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
    </div>
  );
}
