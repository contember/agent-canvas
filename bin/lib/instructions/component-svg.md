# Diagrams with Raw SVG

For custom visuals that Mermaid can't express, write `<svg>` directly. Use CSS variables for colors to match the theme.

## Usage

```jsx
<svg viewBox="0 0 400 200" style={{ width: '100%', maxWidth: 400 }}>
  <rect x="10" y="10" width="120" height="50" rx="8"
        fill="var(--color-accent-blue-muted)" stroke="var(--color-accent-blue)" strokeOpacity="0.3" />
  <text x="70" y="40" textAnchor="middle" fill="var(--color-text-primary)" fontSize="13"
        fontFamily="var(--font-body)">API Gateway</text>

  <line x1="130" y1="35" x2="180" y2="35" stroke="var(--color-text-tertiary)" strokeWidth="1.5"
        markerEnd="url(#arrow)" />

  <rect x="180" y="10" width="120" height="50" rx="8"
        fill="var(--color-accent-green-muted)" stroke="var(--color-accent-green)" strokeOpacity="0.3" />
  <text x="240" y="40" textAnchor="middle" fill="var(--color-text-primary)" fontSize="13"
        fontFamily="var(--font-body)">Auth Service</text>

  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6"
            orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-tertiary)" />
    </marker>
  </defs>
</svg>
```

Keep SVG diagrams simple. For anything with more than ~5 nodes, prefer Mermaid.
