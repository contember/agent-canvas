import React from "react";

interface CalloutProps {
  type?: "info" | "warning" | "danger" | "tip";
  children?: React.ReactNode;
}

const config = {
  info:    { bg: "bg-accent-blue-muted", icon: "i",  iconColor: "text-accent-blue" },
  warning: { bg: "bg-accent-amber-muted", icon: "!", iconColor: "text-accent-amber" },
  danger:  { bg: "bg-accent-red-muted", icon: "\u2715", iconColor: "text-accent-red" },
  tip:     { bg: "bg-accent-green-muted", icon: "\u2713", iconColor: "text-accent-green" },
};

export function Callout({ type = "info", children }: CalloutProps) {
  const cfg = config[type];
  return (
    <div className={`${cfg.bg} relative rounded-lg px-5 py-4 mt-3 flex gap-3 items-start`} data-md="callout" data-md-type={type}>
      <span className={`${cfg.iconColor} opacity-70 text-base leading-relaxed flex-shrink-0 mt-px`}>
        {cfg.icon}
      </span>
      <div className="text-body text-text-secondary leading-relaxed">{children}</div>
    </div>
  );
}
