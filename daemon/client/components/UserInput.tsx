import React, { useEffect, useRef, useState } from "react";
import { useAnnotations } from "#canvas/runtime";
import { ResponseNote } from "./ResponseNote";
import { autoResizeTextarea } from "../utils";

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

  const autoResize = (el: HTMLTextAreaElement) => autoResizeTextarea(el, multiline ? 60 : 32);

  const showError = current?.required && !value.trim();

  return (
    <div data-md="userinput" data-md-label={label} className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
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
  const stepCount = Math.round((max - min) / step);
  const showDots = stepCount <= 20;

  const showError = current?.required && !hasValue;

  return (
    <div data-md="rangeinput" data-md-label={label} className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
          {required && <span className="text-[10px] text-accent-red font-body">*</span>}
        </div>
        <span className="flex items-center gap-1.5">
          <span className={`text-[13px] font-mono ${hasValue ? "text-accent-amber" : "text-text-disabled"}`}>
            {hasValue ? value : "—"}
          </span>
          {hasValue && (
            <button
              onClick={() => setResponse(id, { ...current!, value: null })}
              className="text-text-disabled hover:text-text-tertiary transition-colors text-[10px] leading-none"
              title="Clear"
            >
              &#x2715;
            </button>
          )}
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        {/* Track background */}
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-border-medium">
          {hasValue && <div className="h-full rounded-full bg-accent-amber transition-all duration-150" style={{ width: `${pct}%` }} />}
        </div>
        {/* Discrete step dots */}
        {showDots && Array.from({ length: stepCount + 1 }, (_, i) => {
          const dotVal = min + i * step;
          const dotPct = ((dotVal - min) / (max - min)) * 100;
          const isSelected = hasValue && dotVal <= value!;
          const isActive = hasValue && dotVal === value;
          return (
            <div
              key={i}
              className={`absolute rounded-full pointer-events-none transition-all duration-150 ${
                isActive ? "w-2.5 h-2.5 bg-accent-amber" : isSelected ? "w-1.5 h-1.5 bg-accent-amber" : "w-1.5 h-1.5 bg-border-hover"
              }`}
              style={{ left: `${dotPct}%`, transform: "translate(-50%, -50%)", top: "50%" }}
            />
          );
        })}
        {/* Thumb indicator */}
        {hasValue ? (
          <div className="absolute h-5 w-5 rounded-full bg-accent-amber shadow-md pointer-events-none transition-all duration-150" style={{ left: `calc(${pct}% - 10px)`, borderWidth: "2px", borderStyle: "solid", borderColor: "var(--color-bg-base)" }} />
        ) : (
          <div className="absolute h-4 w-4 rounded-full bg-border-hover pointer-events-none opacity-50" style={{ left: "calc(50% - 8px)", borderWidth: "2px", borderStyle: "solid", borderColor: "var(--color-bg-base)" }} />
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
      {/* Labels: show step values if few enough, otherwise just min/max */}
      {showDots && stepCount <= 10 ? (
        <div className="flex justify-between -mt-0.5 px-0">
          {Array.from({ length: stepCount + 1 }, (_, i) => {
            const dotVal = min + i * step;
            const isActive = hasValue && dotVal === value;
            return (
              <span key={i} className={`text-[10px] font-mono transition-colors ${isActive ? "text-accent-amber font-medium" : "text-text-disabled"}`} style={{ minWidth: "1ch", textAlign: "center" }}>
                {dotVal}
              </span>
            );
          })}
        </div>
      ) : (
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
