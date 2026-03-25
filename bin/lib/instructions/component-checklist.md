# Component: Checklist

Visual checklist. Read-only display (feedback via annotations).

## Props

- `items` (array of `{ label: string, checked: boolean }`)

## Usage

```jsx
<Checklist items={[
  { label: "Run migration on staging", checked: true },
  { label: "Verify data integrity", checked: false },
  { label: "Update API docs", checked: false },
]} />
```
