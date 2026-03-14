# Component Reference

All components are available globally in canvas JSX — no imports needed.
For inline styling use `style={{ ... }}`. Tailwind classes are NOT available.

---

## Layout

### `<Section title="string">`

Top-level grouping. Rendered as a serif heading with generous spacing.
Collapsible (chevron appears on hover). Children are the section body.

```jsx
<Section title="Phase 1: Data Migration">
  A brief description of this section.
  
  {/* Items, callouts, code blocks, diagrams, etc. */}
</Section>
```

**Props:**
- `title` (string, required) — section heading, rendered in Instrument Serif
- `collapsed` (boolean, default false) — start collapsed

---

### `<Item id="string" label="string">`

The primary content block. A flexible card-like row used for tasks, findings, requirements, observations, options — anything that has a title and details.

Previously called "Task" — Item is the generalized version. It's a labeled sub-section with an optional status dot, badge, and children for details.

```jsx
{/* As a plan task */}
<Item id="migrate-db" label="Run database migration" badge="todo">
  Execute the migration script against staging first.
  <CodeBlock language="bash">npm run migrate:staging</CodeBlock>
</Item>

{/* As a review finding */}
<Item id="finding-1" label="Missing null check in auth handler" badge="critical" badgeVariant="danger">
  The handler doesn't check for missing tokens.
  <FilePreview path="src/auth.ts" lines={[42, 48]} />
</Item>

{/* As a requirement */}
<Item id="req-auth" label="JWT authentication" badge="must-have" badgeVariant="danger">
  All API endpoints must require a valid JWT token.
</Item>

{/* As an architecture component */}
<Item label="API Gateway" badge="core" badgeVariant="info">
  Routes requests to downstream services. Handles rate limiting.
</Item>
```

**Props:**
- `id` (string) — unique ID. Required if the item should be individually addressable in feedback. Optional for informational items.
- `label` (string, required) — item title, rendered in Inter 600
- `badge` (string) — short label shown as a small tag. Freeform text.
- `badgeVariant` ("default" | "success" | "warning" | "danger" | "info") — badge color. Default is neutral gray.
- `status` ("todo" | "done" | "blocked" | "in-progress") — shows a colored dot. Alternative to badge for plan-style items.

**Badge vs Status**: Use `status` for things with a workflow state (tasks in a plan). Use `badge` for categorical labels (requirement priority, review severity, component type). You can use both on the same Item if needed.

**Children**: Any content — text, components, code blocks, file previews, nested items. Rendered indented under the label.

---

## Code & Files

### `<FilePreview path="string">`

Shows a syntax-highlighted preview of a project file. The daemon serves the file content from the project root.

```jsx
<FilePreview path="src/auth/middleware.ts" />
<FilePreview path="src/auth/middleware.ts" lines={[42, 87]} />
```

**Props:**
- `path` (string, required) — relative to project root
- `lines` ([number, number]) — line range to show. Omit for full file.

### `<CodeBlock language="string">`

Inline code block with syntax highlighting. For code that's part of the narrative, not from a file on disk.

```jsx
<CodeBlock language="typescript">
  interface User {
    id: string;
    email: string;
  }
</CodeBlock>
```

**Props:**
- `language` (string) — syntax highlighting language

### `<Diff before="string" after="string">`

Shows a diff view between two code snippets.

```jsx
<Diff language="typescript"
  before={`function auth(req) {\n  return true;\n}`}
  after={`function auth(req) {\n  const token = req.headers.authorization;\n  if (!token) throw new Error('Unauthorized');\n  return verify(token);\n}`}
/>
```

**Props:**
- `before` (string, required) — original code
- `after` (string, required) — modified code
- `language` (string) — syntax highlighting language

---

## Content

### `<Callout type="string">`

Highlighted information block. Background-tinted, no border.

```jsx
<Callout type="warning">
  This will invalidate all existing sessions. Plan a maintenance window.
</Callout>
```

**Props:**
- `type` ("info" | "warning" | "danger" | "tip") — determines color and icon

### `<Note>`

Softer than Callout. For asides, context, non-critical info.

```jsx
<Note>
  This pattern is also used in the payment service — see src/payments/auth.ts.
</Note>
```

### `<Priority level="string" />`

Inline badge. Use inside Item labels or body text.

```jsx
<Item label="Fix the race condition">
  <Priority level="high" /> This causes data corruption under load.
</Item>
```

**Props:**
- `level` ("high" | "medium" | "low")

---

## Data Display

### `<Table headers={[...]} rows={[[...], ...]} />`

Simple data table.

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

### `<Checklist items={[...]} />`

Visual checklist. Read-only display (feedback via annotations).

```jsx
<Checklist items={[
  { label: "Run migration on staging", checked: true },
  { label: "Verify data integrity", checked: false },
  { label: "Update API docs", checked: false },
]} />
```

### `<Mermaid>`

Renders a Mermaid diagram. Supports flowchart, sequence, ER, gantt, pie, etc.
The daemon bundles mermaid.js with a custom dark theme matching Canvas colors.

```jsx
<Mermaid>{`
  graph TD
    A[Client] -->|HTTP| B(API Gateway)
    B --> C{Auth?}
    C -->|Valid| D[Service]
    C -->|Invalid| E[401 Response]
`}</Mermaid>
```

For complex diagrams, prefer Mermaid over raw SVG. Use raw `<svg>` only when Mermaid can't express what you need (custom visual layouts, non-standard diagrams).

---

## Interactive (User Input)

Interactive components collect structured responses. They appear in feedback as `[component-id]: value`. Each has an optional "Add note" affordance for extra context.

### `<Choice id="string" label="string" options={[...]} />`

Single-select radio group.

```jsx
<Choice id="db-choice" label="Which database?" required
  options={["PostgreSQL", "SQLite", "MongoDB"]} />
```

### `<MultiChoice id="string" label="string" options={[...]} />`

Multi-select checkboxes.

```jsx
<MultiChoice id="affected-areas" label="Which areas need changes?" required
  options={["Models", "API", "Frontend", "Tests"]} />
```

### `<UserInput id="string" label="string" />`

Free text input.

```jsx
<UserInput id="constraints" label="Any constraints I should know about?" 
  placeholder="e.g. must work with existing Redis setup" required />
```

### `<RangeInput id="string" label="string" />`

Slider for numeric ranges or scales.

```jsx
<RangeInput id="effort-tolerance" label="How much refactoring is acceptable?"
  min={1} max={5} minLabel="Minimal changes" maxLabel="Full rewrite OK" required />
```

**Common props for all interactive components:**
- `id` (string, required) — unique, used as key in feedback
- `label` (string, required) — question text
- `required` (boolean) — prevents submit until answered
- `placeholder` (string) — hint text (UserInput only)

---

## Custom Components

When you use the full module format (`export default function Canvas()`), you can define custom helper components:

```jsx
function Metric({ label, value, trend }) {
  const color = trend === 'up' ? '#4a9e6d' : trend === 'down' ? '#c45a5a' : '#a09a92';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
      <span style={{ color: '#6b6560', fontSize: '0.75rem' }}>{label}</span>
      <span style={{ color, fontSize: '1.25rem', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default function Canvas() {
  return (
    <Section title="Performance Summary">
      <Metric label="P95 Latency" value="42ms" trend="down" />
      <Metric label="Error Rate" value="0.3%" trend="up" />
      <Metric label="Throughput" value="1.2k rps" trend="up" />
    </Section>
  );
}
```

Standard components remain available without import even in full module format.

---

## Diagrams with Raw SVG

For custom visuals that Mermaid can't express, write `<svg>` directly.
Use Canvas CSS variables for colors to match the theme:

```jsx
<svg viewBox="0 0 400 200" style={{ width: '100%', maxWidth: 400 }}>
  <rect x="10" y="10" width="120" height="50" rx="8" 
        fill="rgba(90, 142, 196, 0.12)" stroke="rgba(90, 142, 196, 0.3)" />
  <text x="70" y="40" textAnchor="middle" fill="#e8e4df" fontSize="13" 
        fontFamily="Inter, sans-serif">API Gateway</text>
  
  <line x1="130" y1="35" x2="180" y2="35" stroke="#6b6560" strokeWidth="1.5"
        markerEnd="url(#arrow)" />
  
  <rect x="180" y="10" width="120" height="50" rx="8"
        fill="rgba(74, 158, 109, 0.12)" stroke="rgba(74, 158, 109, 0.3)" />
  <text x="240" y="40" textAnchor="middle" fill="#e8e4df" fontSize="13"
        fontFamily="Inter, sans-serif">Auth Service</text>
  
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6"
            orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b6560" />
    </marker>
  </defs>
</svg>
```

Keep SVG diagrams simple. For anything with more than ~5 nodes, prefer Mermaid.
