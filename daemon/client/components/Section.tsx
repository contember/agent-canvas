import React, { useState } from "react";

interface SectionProps {
  title: string;
  children?: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="relative mb-8 p-4 group/section" data-md="section" data-md-title={title}>
      <div className="relative mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`absolute -left-8 top-1/2 -translate-y-1/2 text-text-tertiary opacity-0 group-hover/section:opacity-50 hover:!opacity-100 transition-all duration-150 p-0.5 ${collapsed ? "-rotate-90" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h2
          className="font-heading text-section text-text-primary"
          style={{ fontWeight: 400 }}
        >
          {title}
        </h2>
      </div>
      <div className={collapsed ? "mt-6 hidden" : "mt-6"}>{children}</div>
    </div>
  );
}
