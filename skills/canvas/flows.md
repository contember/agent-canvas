# Flow Reference

Each flow is a sequence of canvas rounds. Phases can be skipped or combined based on context.

**Tooling reminder**: Write all `.jsx` files using the **Write** tool to `.claude/agent-canvas/${CLAUDE_SESSION_ID}/`. Edit them with the **Edit** tool. Push with `bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/<file>.jsx --session ${CLAUDE_SESSION_ID} --label "<Label>"`, then run `bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}` with `run_in_background: true` — you'll be notified when the user submits feedback. The JSX blocks below show what to write — they are the file content, not bash commands.

---

## FEATURE Flow

**When**: User wants something built but the requirements aren't fully clear.

**Phases**: Discovery → Requirements → Plan → [Implementation] → Summary

### Phase 1: Discovery (`discovery.jsx`)

Goal: understand scope, constraints, and user expectations. Start broad, go deep.

Write to `.claude/agent-canvas/${CLAUDE_SESSION_ID}/discovery.jsx`, then push and wait:

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
  This takes an extra round but catches edge cases early.

  <MultiChoice id="interview-areas" label="Want me to interview you about any of these?"
    options={["Backend architecture & data model", "API design & contracts", "UI/UX behavior & states", "Error handling & edge cases", "Performance & scaling", "Security", "Testing strategy"]} />
</Section>
```

If the user selects interview areas → push follow-up canvases with deep questions for each area. Example for "Backend architecture":

```jsx
<Section title="Backend Deep Dive">
  <UserInput id="data-shape" label="Describe the data shape / entities involved" required />
  <Choice id="mutation-pattern" label="How should mutations work?"
    options={["Sync — mutate and return", "Async — queue and process", "Event-driven — publish and react"]} />
  <UserInput id="invariants" label="What business rules / invariants must always hold?" />
  <UserInput id="existing-patterns" label="Any existing patterns in the codebase I should follow?" />
</Section>
```

### Phase 2: Requirements (`requirements.jsx`)

Goal: formalize what will be built. The user confirms or corrects before planning begins.

```jsx
<Section title="Requirements: [Feature Name]">
  Based on our discovery, here's what I'll build.
  
  <Callout type="info">
    Review each requirement. Annotate anything that's wrong or missing.
    Mark items you don't need with a comment.
  </Callout>
</Section>

<Section title="Functional Requirements">
  <Item id="req-1" label="[Requirement title]" badge="must-have" badgeVariant="danger">
    [Detailed description of the requirement.]
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
    [Expected throughput, latency constraints, etc.]
  </Item>
  <Item id="nfr-2" label="Security">
    [Auth model, data sensitivity, etc.]
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

### Phase 3: Plan (`plan.jsx`)

Goal: detailed implementation plan with file-level changes. The user approves before you start coding.

```jsx
<Section title="Implementation Plan: [Feature Name]">
  [Brief summary — what, why, rough approach.]
  
  <Item label="Estimated scope" badge="info">
    [N files changed, M new files, ~X lines. Estimated N rounds of implementation.]
  </Item>
</Section>

<Section title="Phase 1: [Phase name]">
  [What this phase accomplishes and why it's first.]
  
  <Item id="step-1" label="[Step description]" badge="todo">
    [What exactly will change.]
    <FilePreview path="src/relevant/file.ts" lines={[10, 30]} />
    <Callout type="tip">
      [Any non-obvious approach or tradeoff you're making.]
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

<Section title="Phase 2: [Phase name]">
  [Steps for this phase...]
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

### Phase 4: Summary (`summary.jsx`)

Push AFTER implementation is complete. Always do this, even briefly.

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
  <Item id="done-2" label="[Change description]" badge="done" badgeVariant="success">
    [Details.]
  </Item>
</Section>

<Section title="Deviations from Plan">
  [What changed during implementation and why. If nothing changed, say so.]
  <Item id="dev-1" label="[What changed]" badge="changed" badgeVariant="warning">
    [Why it deviated and what was done instead.]
  </Item>
</Section>

<Section title="Manual Testing Needed">
  <Callout type="warning">
    These need manual verification:
  </Callout>
  <Checklist items={[
    { label: "[Thing to test manually]", checked: false },
    { label: "[Another thing]", checked: false }
  ]} />
</Section>

<Section title="Next Steps">
  <Item id="next-1" label="[Follow-up task]" badge="todo">
    [What should happen next, if anything.]
  </Item>
</Section>
```

---

## PLAN Flow

**When**: User has clear requirements, skip discovery. Go straight to planning.

**Phases**: Plan → [Implementation] → Summary

Same as FEATURE Phase 3 + 4, but the plan may be simpler since requirements are already known. If during planning you realize requirements are ambiguous, pivot to a quick discovery round.

---

## EXPLAIN Flow

**When**: User wants to understand how something works. "Explain the auth system", "how does X work", "walk me through the architecture".

**Phases**: Usually single canvas, occasionally follow-up if user has questions.

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

---

## REVIEW Flow

**When**: User wants code review, architecture audit, security review, or similar.

**Phases**: Findings → (optional) Fix Plan → Summary

```jsx
<Section title="Review: [What's Being Reviewed]">
  [Scope of the review — what was examined, methodology.]
  
  <Item label="Files reviewed" badge="scope" badgeVariant="info">
    [List or count of what was examined.]
  </Item>
</Section>

<Section title="Critical Issues">
  <Item id="crit-1" label="[Issue title]" badge="critical" badgeVariant="danger">
    [Description of the issue and its impact.]
    <FilePreview path="src/auth.ts" lines={[42, 55]} />
    <CodeBlock language="typescript">
      // Proposed fix
      if (!token) throw new UnauthorizedError();
    </CodeBlock>
  </Item>
</Section>

<Section title="Warnings">
  <Item id="warn-1" label="[Issue title]" badge="warning" badgeVariant="warning">
    [Description. Less severe but should be addressed.]
  </Item>
</Section>

<Section title="Suggestions">
  <Item id="sug-1" label="[Suggestion]" badge="suggestion" badgeVariant="info">
    [Nice-to-have improvement. Not blocking.]
  </Item>
</Section>

<Section title="What Looks Good">
  <Item label="[Positive observation]" badge="good" badgeVariant="success">
    [Call out things that are well-implemented. Important for balanced reviews.]
  </Item>
</Section>

<Section title="Action Items">
  <Checklist items={[
    { label: "[Fix critical-1: description]", checked: false },
    { label: "[Address warning-1: description]", checked: false },
    { label: "[Consider suggestion-1: description]", checked: false }
  ]} />
  
  <Choice id="review-action" label="How should I proceed?" required
    options={[
      "Fix all critical + warnings",
      "Fix critical only, I'll handle warnings",
      "Don't fix anything, this was informational",
      "Let me annotate which ones to fix"
    ]} />
</Section>
```

---

## DECISION Flow

**When**: User needs help choosing between options. "Should we use X or Y?", "What database?", "Monorepo or polyrepo?"

**Phases**: Single canvas, possibly follow-up for deeper comparison.

```jsx
<Section title="Decision: [What needs to be decided]">
  [Context — why this decision matters and what constraints exist.]
</Section>

<Section title="Option A: [Name]">
  <Item label="Pros" badge="pro" badgeVariant="success">
    [Benefits of this option.]
  </Item>
  <Item label="Cons" badge="con" badgeVariant="danger">
    [Drawbacks.]
  </Item>
  <Item label="Effort" badge="effort" badgeVariant="info">
    [Rough effort estimate.]
  </Item>
</Section>

<Section title="Option B: [Name]">
  <Item label="Pros" badge="pro" badgeVariant="success">
    [Benefits.]
  </Item>
  <Item label="Cons" badge="con" badgeVariant="danger">
    [Drawbacks.]
  </Item>
  <Item label="Effort" badge="effort" badgeVariant="info">
    [Effort.]
  </Item>
</Section>

<Section title="Comparison">
  <Table headers={["Criteria", "Option A", "Option B"]} rows={[
    ["Performance", "★★★", "★★"],
    ["Complexity", "★★", "★★★"],
    ["Maintenance", "★★★", "★"],
  ]} />
</Section>

<Section title="Recommendation">
  <Callout type="tip">
    I recommend **Option A** because [reasoning].
    However, if [condition], Option B would be better.
  </Callout>
  
  <Choice id="decision" label="Which direction?" required
    options={["Go with Option A", "Go with Option B", "Need more info — I'll annotate questions"]} />
</Section>
```

---

## Skipping & Combining Phases

You don't always need every phase. Guidelines:

| Situation | Skip to |
|---|---|
| User gave a detailed spec | PLAN (skip discovery + requirements) |
| User said "just do it" with clear instructions | Implement directly, push SUMMARY after |
| Simple change (< 3 files) | Probably skip canvas entirely |
| User explicitly says "don't plan, just code" | Implement, push SUMMARY |
| Mid-flow user says "looks good, go ahead" | Skip remaining review rounds |
| Discovery reveals it's trivial | Collapse remaining phases into one canvas |

**Always push a summary after implementation** unless the change was trivially small (1-2 file edit). The summary is how the user verifies what happened.
