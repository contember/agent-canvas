# DECISION Flow

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
    ["Performance", "---", "---"],
    ["Complexity", "---", "---"],
    ["Maintenance", "---", "---"],
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
