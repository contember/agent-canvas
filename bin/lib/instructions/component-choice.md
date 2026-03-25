# Component: Choice

Single-select radio group.

## Props

- `id` (string, required) — unique, used as key in feedback
- `label` (string, required) — question text
- `options` (string[], required) — radio options
- `required` (boolean) — prevents submit until answered

## Usage

```jsx
<Choice id="db-choice" label="Which database?" required
  options={["PostgreSQL", "SQLite", "MongoDB"]} />

<Choice id="review-action" label="How should I proceed?" required
  options={[
    "Fix all critical + warnings",
    "Fix critical only, I'll handle warnings",
    "Don't fix anything, this was informational",
    "Let me annotate which ones to fix"
  ]} />
```

Appears in feedback as: `[db-choice]: PostgreSQL`
