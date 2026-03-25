# Component: RangeInput

Slider for numeric ranges or scales.

## Props

- `id` (string, required) — unique, used as key in feedback
- `label` (string, required) — question text
- `min` (number) — minimum value
- `max` (number) — maximum value
- `minLabel` (string) — label for minimum end
- `maxLabel` (string) — label for maximum end
- `required` (boolean) — prevents submit until set

## Usage

```jsx
<RangeInput id="effort-tolerance" label="How much refactoring is acceptable?"
  min={1} max={5} minLabel="Minimal changes" maxLabel="Full rewrite OK" required />
```
