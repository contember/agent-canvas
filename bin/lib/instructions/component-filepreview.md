# Component: FilePreview

Shows a syntax-highlighted preview of a project file. The daemon serves the file content from the project root.

## Props

- `path` (string, required) — relative to project root
- `lines` ([number, number]) — line range to show. Omit for full file.

## Usage

```jsx
<FilePreview path="src/auth/middleware.ts" />
<FilePreview path="src/auth/middleware.ts" lines={[42, 87]} />
```
