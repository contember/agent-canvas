/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/**/*.{tsx,ts,jsx,js}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#1a1a1a",
          surface: "#1e1e1e",
          elevated: "#242424",
          code: "#1c1c1c",
        },
        text: {
          primary: "#e8e4df",
          secondary: "#a09a92",
          tertiary: "#847d75",
          code: "#c4beb7",
        },
        border: {
          subtle: "rgba(255, 248, 240, 0.06)",
          hover: "rgba(255, 248, 240, 0.12)",
        },
        accent: {
          green: "#4a9e6d",
          "green-muted": "rgba(74, 158, 109, 0.12)",
          amber: "#c49a3a",
          "amber-muted": "rgba(196, 154, 58, 0.12)",
          red: "#c45a5a",
          "red-muted": "rgba(196, 90, 90, 0.12)",
          blue: "#5a8ec4",
          "blue-muted": "rgba(90, 142, 196, 0.10)",
        },
        highlight: {
          bg: "rgba(255, 220, 100, 0.15)",
          border: "rgba(255, 220, 100, 0.35)",
          annotation: "rgba(255, 220, 100, 0.08)",
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
        sm: "0 1px 2px rgba(0, 0, 0, 0.2)",
        md: "0 4px 12px rgba(0, 0, 0, 0.25)",
        lg: "0 8px 24px rgba(0, 0, 0, 0.3)",
      },
    },
  },
  plugins: [],
};
