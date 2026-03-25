# Component: CodeBlock

Inline code block with syntax highlighting. For code that's part of the narrative, not from a file on disk.

## Props

- `language` (string) — syntax highlighting language (typescript, javascript, bash, python, sql, etc.)

## Usage

```jsx
<CodeBlock language="typescript">
  interface User {
    id: string;
    email: string;
  }
</CodeBlock>

<CodeBlock language="bash">
  npm run migrate:staging
</CodeBlock>
```

**Tip**: For showing code from an actual project file, use `<FilePreview>` instead — it shows the real file with line numbers and the user can browse it.
