# Hook: useFeedback

Hook for custom components to contribute computed/derived data to the feedback response. Use when built-in interactive components don't cover your needs.

## Signature

```typescript
useFeedback(id: string, markdown: string, options?: { label?: string; required?: boolean })
```

- `id` (string, required) — unique feedback entry identifier
- `markdown` (string, required) — markdown included in feedback, re-evaluated each render
- `options.label` — display label in feedback preview
- `options.required` — blocks submit while markdown is empty

Registers on mount, updates on change, unregisters on unmount.

## Usage

```jsx
function ProConList() {
  const [pros, setPros] = React.useState(["Fast builds"]);
  const [cons, setCons] = React.useState(["New runtime"]);

  useFeedback(
    "pro-con",
    `**Pros:** ${pros.join(", ")}\n**Cons:** ${cons.join(", ")}`,
    { label: "Pro/Con Analysis" },
  );

  return <div>{/* UI for managing pros/cons */}</div>;
}
```
