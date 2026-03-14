/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/**/*.{tsx,ts,jsx,js}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "var(--color-bg-base)",
          surface: "var(--color-bg-surface)",
          elevated: "var(--color-bg-elevated)",
          code: "var(--color-bg-code)",
          input: "var(--color-bg-input)",
          "elevated-half": "var(--color-bg-elevated-half)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
          code: "var(--color-text-code)",
          disabled: "var(--color-text-disabled)",
          inverse: "var(--color-text-inverse)",
        },
        border: {
          subtle: "var(--color-border-subtle)",
          medium: "var(--color-border-medium)",
          hover: "var(--color-border-hover)",
          strong: "var(--color-border-strong)",
        },
        accent: {
          green: "var(--color-accent-green)",
          "green-muted": "var(--color-accent-green-muted)",
          amber: "var(--color-accent-amber)",
          "amber-muted": "var(--color-accent-amber-muted)",
          red: "var(--color-accent-red)",
          "red-muted": "var(--color-accent-red-muted)",
          blue: "var(--color-accent-blue)",
          "blue-muted": "var(--color-accent-blue-muted)",
        },
        highlight: {
          bg: "var(--color-highlight-bg)",
          border: "var(--color-highlight-border)",
          annotation: "var(--color-highlight-annotation)",
          active: "var(--color-highlight-active)",
          selected: "var(--color-highlight-selected)",
        },
        badge: {
          bg: "var(--color-badge-bg)",
        },
        btn: {
          primary: "var(--color-btn-primary)",
          "primary-text": "var(--color-btn-primary-text)",
        },
      },
      fontFamily: {
        heading: ["'Instrument Serif'", "Georgia", "'Times New Roman'", "serif"],
        body: ["'Inter'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Fira Code'", "Consolas", "monospace"],
      },
      fontSize: {
        "section": ["1.75rem", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        "task-label": ["0.9375rem", { lineHeight: "1.4" }],
        "body": ["0.875rem", { lineHeight: "1.65" }],
        "code": ["0.8125rem", { lineHeight: "1.6" }],
        "meta": ["0.75rem", { lineHeight: "1.4", letterSpacing: "0.02em" }],
        "tiny": ["0.6875rem", { lineHeight: "1.4" }],
      },
      boxShadow: {
        sm: "0 1px 2px var(--color-shadow)",
        md: "0 4px 12px var(--color-shadow)",
        lg: "0 8px 24px var(--color-shadow)",
      },
    },
  },
  plugins: [],
};
