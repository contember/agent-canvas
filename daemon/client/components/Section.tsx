import React, { useState } from "react";

interface SectionProps {
  title: string;
  children?: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-12 group/section">
      <div className="mb-2 flex items-baseline gap-3">
        <h2
          className="font-heading text-section text-text-primary cursor-default"
          style={{ fontWeight: 400 }}
        >
          {title}
        </h2>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`text-text-tertiary opacity-0 group-hover/section:opacity-40 hover:!opacity-100 transition-all text-xs ${collapsed ? "-rotate-90" : ""}`}
        >
          ▾
        </button>
      </div>
      {!collapsed && (
        <div className="mt-6">{children}</div>
      )}
    </div>
  );
}
