import React, { useEffect, useRef } from "react";
import { useAnnotations } from "@planner/runtime";

/** Free text input from user */
interface UserInputProps {
  id: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  defaultValue?: string;
}

export function UserInput({ id, label, placeholder, multiline, defaultValue }: UserInputProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const value = (current?.value as string) ?? "";
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "text", label, value: defaultValue || "" });
    }
  }, [id]);

  const handleChange = (v: string) => {
    setResponse(id, { id, type: "text", label, value: v });
  };

  // Auto-resize textarea
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.max(multiline ? 60 : 32, el.scrollHeight) + "px";
  };

  return (
    <div className="my-3">
      <div className="text-[13px] font-body font-medium text-text-primary mb-2">{label}</div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => { handleChange(e.target.value); autoResize(e.target); }}
        placeholder={placeholder || "Type your response..."}
        rows={multiline ? 3 : 1}
        className="w-full bg-[rgba(255,248,240,0.03)] text-[13px] font-body text-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none border border-[rgba(255,248,240,0.06)] focus:border-[rgba(255,248,240,0.12)] placeholder:text-text-tertiary transition-colors"
        onInput={(e) => autoResize(e.target as HTMLTextAreaElement)}
        onFocus={(e) => autoResize(e.target)}
      />
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
  defaultValue?: number;
  /** Labels for min and max ends */
  minLabel?: string;
  maxLabel?: string;
}

export function RangeInput({ id, label, min = 1, max = 10, step = 1, defaultValue, minLabel, maxLabel }: RangeInputProps) {
  const { responses, setResponse } = useAnnotations();
  const current = responses.get(id);
  const value = (current?.value as number) ?? defaultValue ?? Math.round((min + max) / 2);

  useEffect(() => {
    if (!responses.has(id)) {
      setResponse(id, { id, type: "range", label, value: defaultValue ?? Math.round((min + max) / 2) });
    }
  }, [id]);

  const handleChange = (v: number) => {
    setResponse(id, { id, type: "range", label, value: v });
  };

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="my-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
        <span className="text-[13px] font-mono text-[#c49a3a]">{value}</span>
      </div>
      <div className="relative h-8 flex items-center">
        {/* Track background */}
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-[rgba(255,248,240,0.08)]">
          <div className="h-full rounded-full bg-[#c49a3a]" style={{ width: `${pct}%` }} />
        </div>
        {/* Thumb indicator */}
        <div className="absolute h-5 w-5 rounded-full bg-[#c49a3a] border-2 border-[#1a1a1a] shadow-md pointer-events-none" style={{ left: `calc(${pct}% - 10px)` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between mt-1">
          <span className="text-[11px] text-text-tertiary font-body">{minLabel || min}</span>
          <span className="text-[11px] text-text-tertiary font-body">{maxLabel || max}</span>
        </div>
      )}
    </div>
  );
}
