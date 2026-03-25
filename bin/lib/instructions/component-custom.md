# Custom Components

When you use the full module format (`export default function Canvas()`), you can define custom helper components. Standard components remain available without import.

## Usage

```jsx
function Metric({ label, value, trend }) {
  const color = trend === 'up' ? 'var(--color-accent-green)' : trend === 'down' ? 'var(--color-accent-red)' : 'var(--color-text-secondary)';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>{label}</span>
      <span style={{ color, fontSize: '1.25rem', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default function Canvas() {
  return (
    <Section title="Performance Summary">
      <Metric label="P95 Latency" value="42ms" trend="down" />
      <Metric label="Error Rate" value="0.3%" trend="up" />
      <Metric label="Throughput" value="1.2k rps" trend="up" />
    </Section>
  );
}
```

## Tips

- Use `style={{ }}` with CSS variables for theming (see `bunx agent-canvas instructions theming`)
- Standard components (Section, Item, etc.) are available without import even in module format
- You can use `React.useState`, `React.useEffect`, etc. — React is available globally
- Use `useFeedback` hook to contribute custom data to the feedback response
