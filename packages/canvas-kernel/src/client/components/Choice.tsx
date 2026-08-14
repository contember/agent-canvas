import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAnnotations, useResponseRegistration } from "#canvas/runtime";
import { ResponseNote } from "./ResponseNote";

export type ChoiceOption = string | { value: string; label?: string };

type NormalizedOption = { value: string; label: string };

function normalizeOptions(options: ChoiceOption[]): NormalizedOption[] {
  return options.map((opt) =>
    typeof opt === "string"
      ? { value: opt, label: opt }
      : { value: opt.value, label: opt.label ?? opt.value },
  );
}

/** Radio — pick one option */
interface ChoiceProps {
  id: string;
  label: string;
  options: ChoiceOption[];
  required?: boolean;
}

export function Choice({ id, label, options, required }: ChoiceProps) {
  const { responses, setResponse } = useAnnotations();
  useResponseRegistration(id);
  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const current = responses.get(id);
  const selected = current?.value as string | undefined;
  const note = current?.note || "";
  const [showNote, setShowNote] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (!responses.has(id)) {
    setResponse(id, { id, type: "radio", label, value: null, options: normalized.map((o) => o.value), required });
  }

  const handleSelect = (value: string) => {
    setResponse(id, { ...current!, value });
  };

  // Keyboard selection via custom event from PlanRenderer
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = (e.target as HTMLElement).closest("[data-md-label]");
      const labelAttr = target?.getAttribute("data-md-label");
      const match = normalized.find((o) => o.label === labelAttr);
      if (match) handleSelect(match.value);
    };
    el.addEventListener("kb-select", handler);
    return () => el.removeEventListener("kb-select", handler);
  }, [normalized, handleSelect]);

  const showError = current?.required && !selected;

  return (
    <div ref={wrapperRef} data-md="choice" data-md-label={label} className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
        {required && <span className="text-[10px] text-accent-red font-body">*</span>}
      </div>
      <div className="space-y-1">
        {normalized.map(({ value, label: optLabel }) => (
          <label
            key={value}
            data-md="choice-option"
            data-md-label={optLabel}
            onClick={() => handleSelect(value)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 ${
              selected === value
                ? "bg-highlight-selected"
                : "hover:bg-bg-elevated"
            }`}
          >
            <span className={`w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all ${
              selected === value
                ? "border-accent-amber bg-accent-amber"
                : "border-border-strong"
            }`}>
              {selected === value && <span className="w-1.5 h-1.5 rounded-full bg-text-inverse" />}
            </span>
            <span className="text-[13px] font-body text-text-secondary">{optLabel}</span>
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
  options: ChoiceOption[];
  required?: boolean;
}

export function MultiChoice({ id, label, options, required }: MultiChoiceProps) {
  const { responses, setResponse } = useAnnotations();
  useResponseRegistration(id);
  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const current = responses.get(id);
  const selected: string[] = (current?.value as string[]) || [];
  const note = current?.note || "";
  const [showNote, setShowNote] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (!responses.has(id)) {
    setResponse(id, { id, type: "checkbox", label, value: [], options: normalized.map((o) => o.value), required });
  }

  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((o) => o !== value) : [...selected, value];
    setResponse(id, { ...current!, value: next });
  };

  // Keyboard selection via custom event from PlanRenderer
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = (e.target as HTMLElement).closest("[data-md-label]");
      const labelAttr = target?.getAttribute("data-md-label");
      const match = normalized.find((o) => o.label === labelAttr);
      if (match) toggle(match.value);
    };
    el.addEventListener("kb-select", handler);
    return () => el.removeEventListener("kb-select", handler);
  }, [normalized, toggle]);

  const showError = current?.required && selected.length === 0;

  return (
    <div ref={wrapperRef} data-md="multichoice" data-md-label={label} className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
        {required && <span className="text-[10px] text-accent-red font-body">*</span>}
      </div>
      <div className="space-y-1">
        {normalized.map(({ value, label: optLabel }) => {
          const checked = selected.includes(value);
          return (
            <label
              key={value}
              data-md="multichoice-option"
              data-md-label={optLabel}
              onClick={() => toggle(value)}
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
              <span className="text-[13px] font-body text-text-secondary">{optLabel}</span>
            </label>
          );
        })}
      </div>
      <ResponseNote show={showNote} note={note} onToggle={() => setShowNote(!showNote)} onChange={(n) => setResponse(id, { ...current!, note: n })} />
      {showError && <p className="text-[11px] text-accent-red font-body mt-1">Please select at least one option.</p>}
    </div>
  );
}

