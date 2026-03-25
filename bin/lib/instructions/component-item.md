# Component: Item

The primary content block. A flexible card-like row used for tasks, findings, requirements, observations, options — anything that has a title and details.

Previously called "Task" — Item is the generalized version.

## Props

- `id` (string) — unique ID. Required if the item should be individually addressable in feedback. Optional for informational items.
- `label` (string, required) — item title, rendered in Inter 600
- `badge` (string) — short label shown as a small tag. Freeform text.
- `badgeVariant` ("default" | "success" | "warning" | "danger" | "info") — badge color. Default is neutral gray.
- `status` ("todo" | "done" | "blocked" | "in-progress") — shows a colored dot. Alternative to badge for plan-style items.

**Badge vs Status**: Use `status` for things with a workflow state (tasks in a plan). Use `badge` for categorical labels (requirement priority, review severity, component type). You can use both on the same Item if needed.

**Children**: Any content — text, components, code blocks, file previews, nested items.

## Usage

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
