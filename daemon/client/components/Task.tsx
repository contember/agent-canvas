import React from "react";

interface TaskProps {
  id: string;
  label: string;
  status?: "todo" | "done" | "blocked";
  children?: React.ReactNode;
}

const dotColors = {
  todo: "bg-border-hover",
  done: "bg-accent-green",
  blocked: "bg-accent-red",
};

const statusLabels = {
  todo: "Todo",
  done: "Done",
  blocked: "Blocked",
};

export function Task({ id, label, status = "todo", children }: TaskProps) {
  return (
    <div
      className="group/task -mx-4 px-4 py-3 rounded-lg transition-colors duration-150 hover:bg-bg-input"
      data-task-id={id}
    >
      <div className="flex items-start gap-3">
        <span className={`w-2 h-2 rounded-full mt-[7px] flex-shrink-0 ${dotColors[status]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-body text-task-label font-semibold text-text-primary">{label}</span>
            <span className="font-body text-tiny uppercase tracking-wider text-text-tertiary opacity-0 group-hover/task:opacity-100 transition-opacity duration-150">
              {statusLabels[status]}
            </span>
          </div>
          {children && (
            <div className="text-body text-text-secondary mt-1 leading-relaxed">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
