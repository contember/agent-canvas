# Component: Section

Top-level grouping. Rendered as a serif heading with generous spacing. Collapsible (chevron appears on hover).

## Props

- `title` (string, required) — section heading, rendered in Instrument Serif
- `collapsed` (boolean, default false) — start collapsed

## Usage

```jsx
<Section title="Phase 1: Data Migration">
  A brief description of this section.

  {/* Items, callouts, code blocks, diagrams, etc. */}
</Section>

<Section title="Advanced Details" collapsed>
  This section starts collapsed — user clicks to expand.
</Section>
```
