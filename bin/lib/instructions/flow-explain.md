# EXPLAIN Flow

**When**: User wants to understand how something works. "Explain the auth system", "how does X work", "walk me through the architecture".

**Phases**: Usually a single canvas, occasionally a follow-up if the user has questions.

```jsx
<Section title="How [System/Feature] Works">
  [High-level overview in plain language.]

  <Mermaid>{`
    graph TD
      A[Request] --> B{Auth?}
      B -->|Yes| C[Process]
      B -->|No| D[401]
  `}</Mermaid>
</Section>

<Section title="Key Components">
  <Item label="[Component name]" badge="core">
    [What it does, where it lives.]
    <FilePreview path="src/auth/middleware.ts" />
  </Item>

  <Item label="[Component name]" badge="core">
    [Description.]
  </Item>
</Section>

<Section title="Data Flow">
  [Step-by-step walkthrough of how data moves through the system.]

  <Mermaid>{`
    sequenceDiagram
      Client->>+API: POST /login
      API->>+DB: Find user
      DB-->>-API: User record
      API-->>-Client: JWT token
  `}</Mermaid>
</Section>

<Section title="Gotchas & Edge Cases">
  <Item label="[Non-obvious thing]" badge="warning" badgeVariant="warning">
    [Explanation of something surprising or easy to get wrong.]
  </Item>
</Section>
```
