# Component: Mermaid

Renders a Mermaid diagram. Supports flowchart, sequence, ER, gantt, pie, and more. The daemon bundles mermaid.js with a custom dark theme matching Canvas colors.

## Usage

```jsx
<Mermaid>{`
  graph TD
    A[Client] -->|HTTP| B(API Gateway)
    B --> C{Auth?}
    C -->|Valid| D[Service]
    C -->|Invalid| E[401 Response]
`}</Mermaid>
```

### Sequence diagram

```jsx
<Mermaid>{`
  sequenceDiagram
    Client->>+API: POST /login
    API->>+DB: Find user
    DB-->>-API: User record
    API-->>-Client: JWT token
`}</Mermaid>
```

### ER diagram

```jsx
<Mermaid>{`
  erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    PRODUCT ||--o{ LINE-ITEM : "ordered in"
`}</Mermaid>
```

For complex diagrams, prefer Mermaid over raw SVG. Use raw `<svg>` only when Mermaid can't express what you need.
