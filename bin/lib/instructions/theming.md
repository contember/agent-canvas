# Theming

Canvas supports light/dark themes. **Never hardcode hex colors** — use CSS variables in `style={{ }}`.

## CSS Variables

### Text
- `--color-text-primary` — main text
- `--color-text-secondary` — supporting text
- `--color-text-tertiary` — meta text, labels
- `--color-text-code` — inline code
- `--color-text-inverse` — text on dark backgrounds

### Backgrounds
- `--color-bg-base` — page background
- `--color-bg-surface` — card/section background
- `--color-bg-elevated` — floating elements
- `--color-bg-code` — code block background
- `--color-bg-input` — form input background

### Accents
- `--color-accent-green`, `--color-accent-green-muted`
- `--color-accent-amber`, `--color-accent-amber-muted`
- `--color-accent-red`, `--color-accent-red-muted`
- `--color-accent-blue`, `--color-accent-blue-muted`

### Borders
- `--color-border-subtle` — light separators
- `--color-border-medium` — visible borders
- `--color-border-hover` — interactive hover state

### Fonts
- `--font-heading` — section headings (Instrument Serif)
- `--font-body` — body text (Inter)
- `--font-mono` — code (JetBrains Mono)

## Usage

```jsx
<span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>meta text</span>

<div style={{
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: '8px',
  padding: '16px',
}}>
  Custom styled container
</div>
```
