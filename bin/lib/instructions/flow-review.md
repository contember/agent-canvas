# REVIEW Flow

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
