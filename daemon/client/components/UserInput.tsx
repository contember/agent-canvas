import React, { useEffect, useRef, useState } from "react";
import { useAnnotations } from "@planner/runtime";
import { ResponseNote } from "./ResponseNote";

/** Free text input from user */
interface UserInputProps {
  id: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export function UserInput({ id, label, placeholder, multiline, required }: UserInputProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const value = (current?.value as string) ?? "";
  const note = current?.note || "";
  const [showNote, setShowNote] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "text", label, value: "", required });
    }
  }, [id]);

  const handleChange = (v: string) => {
    setResponse(id, { ...current!, value: v });
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.max(multiline ? 60 : 32, el.scrollHeight) + "px";
  };

  const showError = current?.required && !value.trim();

  return (
    <div className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
        {required && <span className="text-[10px] text-accent-red font-body">*</span>}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => { handleChange(e.target.value); autoResize(e.target); }}
        placeholder={placeholder || "Type your response..."}
        rows={multiline ? 3 : 1}
        className="w-full bg-bg-input text-[13px] font-body text-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none border border-border-subtle focus:border-border-hover placeholder:text-text-tertiary transition-colors"
        onInput={(e) => autoResize(e.target as HTMLTextAreaElement)}
        onFocus={(e) => autoResize(e.target)}
      />
      <ResponseNote show={showNote} note={note} onToggle={() => setShowNote(!showNote)} onChange={(n) => setResponse(id, { ...current!, note: n })} />
      {showError && <p className="text-[11px] text-accent-red font-body mt-1">This field is required.</p>}
    </div>
  );
}

/** Numeric range / slider */
interface RangeInputProps {
  id: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  minLabel?: string;
  maxLabel?: string;
}

export function RangeInput({ id, label, min = 1, max = 10, step = 1, required, minLabel, maxLabel }: RangeInputProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const value = current?.value as number | null;
  const note = current?.note || "";
  const [showNote, setShowNote] = useState(false);

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "range", label, value: null, required });
    }
  }, [id]);

  const handleChange = (v: number) => {
    setResponse(id, { ...current!, value: v });
  };

  const hasValue = value !== null && value !== undefined;
  const displayValue = hasValue ? value : Math.round((min + max) / 2);
  const pct = ((displayValue - min) / (max - min)) * 100;

  const showError = current?.required && !hasValue;

  return (
    <div className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
          {required && <span className="text-[10px] text-accent-red font-body">*</span>}
        </div>
        <span className={`text-[13px] font-mono ${hasValue ? "text-accent-amber" : "text-text-disabled"}`}>
          {hasValue ? value : "—"}
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        {/* Track background */}
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-border-medium">
          {hasValue && <div className="h-full rounded-full bg-accent-amber" style={{ width: `${pct}%` }} />}
        </div>
        {/* Thumb indicator */}
        {hasValue && (
          <div className="absolute h-5 w-5 rounded-full bg-accent-amber shadow-md pointer-events-none" style={{ left: `calc(${pct}% - 10px)`, borderWidth: "2px", borderStyle: "solid", borderColor: "var(--color-bg-base)" }} />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between -mt-0.5">
          <span className="text-[11px] text-text-tertiary font-body">{minLabel || min}</span>
          <span className="text-[11px] text-text-tertiary font-body">{maxLabel || max}</span>
        </div>
      )}
      <ResponseNote show={showNote} note={note} onToggle={() => setShowNote(!showNote)} onChange={(n) => setResponse(id, { ...current!, note: n })} />
      {showError && <p className="text-[11px] text-accent-red font-body mt-1">Please select a value.</p>}
    </div>
  );
}
