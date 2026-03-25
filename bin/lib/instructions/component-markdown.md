# Component: Markdown

Renders markdown content with full GFM support (headings, lists, tables, code blocks, links, etc.). Two modes:

## Inline source — markdown as children

```jsx
<Markdown>{`
# Summary

This is **bold** and *italic*. Here's a list:

- First item
- Second item
  - Nested item

\`\`\`typescript
const x = 42;
\`\`\`
`}</Markdown>
```

## File reference — loads file content at compile time

```jsx
<Markdown file="docs/architecture.md" />
<Markdown file="CHANGELOG.md" />
```

## Props

- `file` (string) — path relative to project root. Content resolved at compile time.
- Children (string) — inline markdown source. Used when `file` is not specified.
