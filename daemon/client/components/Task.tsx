import React from "react";

type Status = "todo" | "done" | "blocked" | "in-progress";
type BadgeVariant = "info" | "success" | "warning" | "danger" | "neutral";

interface ItemProps {
  id: string;
  label: string;
  status?: Status;
  badge?: string;
  badgeVariant?: BadgeVariant;
  children?: React.ReactNode;
}

const dotColors: Record<Status, string> = {
  todo: "bg-border-hover",
  done: "bg-accent-green",
  blocked: "bg-accent-red",
  "in-progress": "bg-accent-blue",
};

const statusLabels: Record<Status, string> = {
  todo: "Todo",
  done: "Done",
  blocked: "Blocked",
  "in-progress": "In progress",
};

const badgeStyles: Record<BadgeVariant, string> = {
  info: "bg-accent-blue-muted text-accent-blue",
  success: "bg-accent-green-muted text-accent-green",
  warning: "bg-accent-amber-muted text-accent-amber",
  danger: "bg-accent-red-muted text-accent-red",
  neutral: "bg-border-subtle text-text-tertiary",
};

export function Item({ id, label, status, badge, badgeVariant = "neutral", children }: ItemProps) {
  return (
    <div
      className="group/task relative -mx-4 px-4 py-3 rounded-md transition-colors duration-150 hover:bg-bg-input"
      data-task-id={id}
      data-md="item"
      data-md-label={label}
      {...(status ? { "data-md-status": status } : {})}
      {...(badge ? { "data-md-badge": badge } : {})}
    >
      <div className="flex items-start gap-3">
        {status && <span className={`w-2 h-2 rounded-full mt-[7px] flex-shrink-0 ${dotColors[status]}`} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-body text-task-label font-semibold text-text-primary">{label}</span>
            {status && (
              <span className="font-body text-tiny uppercase tracking-wider text-text-tertiary opacity-0 group-hover/task:opacity-100 transition-opacity duration-150">
                {statusLabels[status]}
              </span>
            )}
            {badge && (
              <span className={`font-body text-tiny font-medium px-1.5 py-px rounded-full ${badgeStyles[badgeVariant]}`}>
                {badge}
              </span>
            )}
          </div>
          {children && (
            <div className="text-body text-text-secondary mt-1 leading-relaxed">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use <Item> instead */
export function Task(props: ItemProps) {
  return <Item {...props} />;
}
