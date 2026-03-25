# FEATURE Flow

**When**: User wants something built but the requirements aren't fully clear.

**Phases**: Discovery → Requirements → Plan → [Implementation] → Summary

## Phase 1: Discovery (`discovery.jsx`)

Goal: understand scope, constraints, and user expectations.

```jsx
<Section title="Discovery: [Feature Name]">
  Let me understand what we're building before diving into implementation.

  <Item label="My understanding so far" badge="context" badgeVariant="info">
    [Summarize what you already know from the conversation and codebase exploration.]
  </Item>
</Section>

<Section title="Scope & Direction">
  <Choice id="scope" label="How broad should this be?" required
    options={["Minimal — just the core", "Standard — core + common edge cases", "Comprehensive — production-ready with all edge cases"]} />

  <UserInput id="must-have" label="What's the one thing this absolutely must do?" required />
  <UserInput id="must-not" label="Anything I should explicitly avoid or not touch?" />
</Section>

<Section title="Technical Context">
  <MultiChoice id="areas" label="Which areas will be affected?" required
    options={["Database / models", "API / backend logic", "Frontend / UI", "Auth / permissions", "Infrastructure / deployment", "Tests"]} />

  <UserInput id="constraints" label="Any technical constraints? (existing libs, patterns to follow, things to avoid)" />
</Section>

<Section title="Deep Dive (optional)">
  I can do a thorough interview in specific areas before planning.

  <MultiChoice id="interview-areas" label="Want me to interview you about any of these?"
    options={["Backend architecture & data model", "API design & contracts", "UI/UX behavior & states", "Error handling & edge cases", "Performance & scaling", "Security", "Testing strategy"]} />
</Section>
```

If the user selects interview areas, push follow-up canvases with deep questions for each area. Example for "Backend architecture":

```jsx
<Section title="Backend Deep Dive">
  <UserInput id="data-shape" label="Describe the data shape / entities involved" required />
  <Choice id="mutation-pattern" label="How should mutations work?"
    options={["Sync — mutate and return", "Async — queue and process", "Event-driven — publish and react"]} />
  <UserInput id="invariants" label="What business rules / invariants must always hold?" />
  <UserInput id="existing-patterns" label="Any existing patterns in the codebase I should follow?" />
</Section>
```

## Phase 2: Requirements (`requirements.jsx`)

Goal: formalize what will be built. The user confirms or corrects before planning.

```jsx
<Section title="Requirements: [Feature Name]">
  Based on our discovery, here's what I'll build.

  <Callout type="info">
    Review each requirement. Annotate anything that's wrong or missing.
  </Callout>
</Section>

<Section title="Functional Requirements">
  <Item id="req-1" label="[Requirement title]" badge="must-have" badgeVariant="danger">
    [Detailed description.]
  </Item>
  <Item id="req-2" label="[Requirement title]" badge="should-have" badgeVariant="warning">
    [Description.]
  </Item>
  <Item id="req-3" label="[Requirement title]" badge="nice-to-have" badgeVariant="info">
    [Description.]
  </Item>
</Section>

<Section title="Non-Functional Requirements">
  <Item id="nfr-1" label="Performance">
    [Expected throughput, latency constraints.]
  </Item>
  <Item id="nfr-2" label="Security">
    [Auth model, data sensitivity.]
  </Item>
</Section>

<Section title="Out of Scope">
  Explicitly NOT doing in this iteration:
  <Checklist items={[
    { label: "[Thing deliberately excluded]", checked: true },
    { label: "[Another exclusion]", checked: true }
  ]} />
</Section>

<Section title="Open Questions">
  <UserInput id="open-1" label="[Question that emerged during discovery]" required />
</Section>
```

## Phase 3: Plan (`plan.jsx`)

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

## Phase 4: Summary (`summary.jsx`)

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
