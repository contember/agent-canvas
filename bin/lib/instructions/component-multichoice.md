# Component: MultiChoice

Multi-select checkboxes.

## Props

- `id` (string, required) — unique, used as key in feedback
- `label` (string, required) — question text
- `options` (string[], required) — checkbox options
- `required` (boolean) — prevents submit until at least one selected

## Usage

```jsx
<MultiChoice id="affected-areas" label="Which areas need changes?" required
  options={["Models", "API", "Frontend", "Tests"]} />
```

Appears in feedback as: `[affected-areas]: Models, API, Tests`
