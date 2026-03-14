import React from "react";

interface NoteProps {
  children?: React.ReactNode;
}

export function Note({ children }: NoteProps) {
  return (
    <div className="bg-bg-elevated rounded-lg px-5 py-4 mt-3 text-body text-text-secondary italic leading-relaxed" data-md="note">
      {children}
    </div>
  );
}
