# Component: Callout

Highlighted information block. Background-tinted, no border.

## Props

- `type` ("info" | "warning" | "danger" | "tip") — determines color and icon

## Usage

```jsx
<Callout type="warning">
  This will invalidate all existing sessions. Plan a maintenance window.
</Callout>

<Callout type="tip">
  Consider using connection pooling for better performance.
</Callout>

<Callout type="danger">
  This action is irreversible.
</Callout>

<Callout type="info">
  Review each requirement. Annotate anything that's wrong or missing.
</Callout>
```
