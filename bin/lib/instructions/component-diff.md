# Component: Diff

Shows a diff view between two code snippets.

## Props

- `before` (string, required) — original code
- `after` (string, required) — modified code
- `language` (string) — syntax highlighting language

## Usage

```jsx
<Diff language="typescript"
  before={`function auth(req) {\n  return true;\n}`}
  after={`function auth(req) {\n  const token = req.headers.authorization;\n  if (!token) throw new Error('Unauthorized');\n  return verify(token);\n}`}
/>
```
