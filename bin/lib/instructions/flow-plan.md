# PLAN Flow

**When**: User has clear requirements — skip discovery. Go straight to planning.

**Phases**: Plan → [Implementation] → Summary

If during planning you realize requirements are ambiguous, pivot to a quick discovery round (see `flow-feature`).

## Phase 1: Plan (`plan.jsx`)

Goal: detailed implementation plan with file-level changes. The user approves before coding.

```jsx
<Section title="Implementation Plan: [Feature Name]">
  [Brief summary — what, why, rough approach.]

  <Item label="Estimated scope" badge="info">
    [N files changed, M new files. Estimated N rounds of implementation.]
  </Item>
</Section>

<Section title="Phase 1: [Phase name]">
  [What this phase accomplishes and why it's first.]

  <Item id="step-1" label="[Step description]" badge="todo">
    [What exactly will change.]
    <FilePreview path="src/relevant/file.ts" lines={[10, 30]} />
    <Callout type="tip">
      [Any non-obvious approach or tradeoff.]
    </Callout>
  </Item>

  <Item id="step-2" label="[Step description]" badge="todo">
    [Description with code example if helpful.]
    <CodeBlock language="typescript">
      // Proposed interface
      interface AuthToken {
        userId: string;
        expiresAt: number;
      }
    </CodeBlock>
  </Item>
</Section>

<Section title="Testing Strategy">
  <Checklist items={[
    { label: "[Test case 1]", checked: false },
    { label: "[Test case 2]", checked: false }
  ]} />
</Section>

<Section title="Risks & Tradeoffs">
  <Item label="[Risk]" badge="warning" badgeVariant="warning">
    [Description and mitigation.]
  </Item>
</Section>
```

## Phase 2: Summary (`summary.jsx`)

Push AFTER implementation is complete. Always do this, even briefly. **After pushing the summary, start a background watch** — the user may want to provide feedback (follow-up requests, corrections, questions about what was done).

```jsx
<Section title="Implementation Summary: [Feature Name]">
  <Item label="Status" badge="done" badgeVariant="success">
    [One-line summary of what was accomplished.]
  </Item>
</Section>

<Section title="What Was Done">
  <Item id="done-1" label="[Change description]" badge="done" badgeVariant="success">
    [Details of what was implemented and where.]
  </Item>
</Section>

<Section title="Deviations from Plan">
  [What changed during implementation and why.]
  <Item id="dev-1" label="[What changed]" badge="changed" badgeVariant="warning">
    [Why it deviated and what was done instead.]
  </Item>
</Section>

<Section title="Manual Testing Needed">
  <Callout type="warning">These need manual verification:</Callout>
  <Checklist items={[
    { label: "[Thing to test manually]", checked: false },
  ]} />
</Section>

<Section title="Next Steps">
  <Item id="next-1" label="[Follow-up task]" badge="todo">
    [What should happen next, if anything.]
  </Item>
</Section>
```

## Skipping & Combining

| Situation | Action |
|---|---|
| User said "just do it" with clear instructions | Implement directly, push summary after |
| Simple change (< 3 files) | Probably skip canvas entirely |
| User explicitly says "don't plan, just code" | Implement, push summary |
| Mid-flow user says "looks good, go ahead" | Skip remaining review rounds |

**Always push a summary after implementation** (unless trivially small) **and watch for feedback** — the user may want to respond with follow-ups or corrections.
