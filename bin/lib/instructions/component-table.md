# Component: Table

Simple data table.

## Props

- `headers` (string[]) — column headers
- `rows` (string[][]) — row data

## Usage

```jsx
<Table
  headers={["Endpoint", "Method", "Auth"]}
  rows={[
    ["/users", "GET", "Required"],
    ["/users/:id", "PUT", "Owner only"],
    ["/health", "GET", "None"],
  ]}
/>
```
