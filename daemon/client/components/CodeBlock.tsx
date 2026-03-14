import React, { useEffect, useRef } from "react";

interface CodeBlockProps {
  language?: string;
  children?: React.ReactNode;
}

export function CodeBlock({ language, children }: CodeBlockProps) {
  const code = typeof children === "string" ? children : String(children ?? "");
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = codeRef.current;
    const hljs = (window as any).hljs;
    if (!el || !hljs) return;
    // Reset previous highlighting
    el.removeAttribute("data-highlighted");
    el.className = language ? `language-${language}` : "";
    el.textContent = code;
    hljs.highlightElement(el);
  }, [code, language]);

  return (
    <div className="relative mt-3 group/code">
      {language && (
        <span className="absolute top-2 right-3 text-tiny text-text-tertiary opacity-0 group-hover/code:opacity-60 transition-opacity duration-150 z-10 font-mono">
          {language}
        </span>
      )}
      <pre className="bg-bg-code rounded-md p-4 overflow-x-auto text-code font-mono leading-relaxed !bg-transparent" style={{ background: "#1c1c1c" }}>
        <code ref={codeRef} className={language ? `language-${language}` : ""}>{code}</code>
      </pre>
    </div>
  );
}
