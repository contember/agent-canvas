---
name: planner
description: >
  Interactive visual plan review. Use when creating implementation plans,
  refactoring plans, migration plans, or any multi-step plan that benefits
  from user review and annotation. Trigger on: "create a plan", "let me
  review the plan", "plan this refactor", "show me what you'll change",
  or when the user asks to review proposed changes interactively.
---

# Interactive Planner

Create visual, annotatable implementation plans that open in the user's browser.

## How to use

1. Write your plan as JSX to a file using the available components:

   ```jsx
   <Section title="Phase 1: Extract modules">
     High-level description of this phase.

     <Task id="extract-auth" label="Extract auth module" status="todo">
       Move JWT validation from monolith to dedicated module.
       <FilePreview path="src/auth.ts" lines={[42, 87]} />
     </Task>

     <Task id="add-tests" label="Add unit tests" status="todo">
       Cover the extracted module with tests.
       <Priority level="high" />
     </Task>
   </Section>

   <Section title="Phase 2: Update imports">
     <Callout type="warning">
       This will break existing imports. Run codemod first.
     </Callout>

     <Task id="codemod" label="Run import codemod" status="todo">
       <CodeBlock language="bash">
         npx jscodeshift -t transforms/update-imports.ts src/
       </CodeBlock>
     </Task>
   </Section>
   ```

2. Save the plan and push it to the planner UI:

   ```bash
   cat > ~/.planner/sessions/$PLANNER_SESSION_ID/plan.jsx << 'PLAN_EOF'
   ... your JSX plan here ...
   PLAN_EOF

   planner push ~/.planner/sessions/$PLANNER_SESSION_ID/plan.jsx
   ```

   This opens the plan in the user's browser and **blocks until they submit feedback**.

3. Read the feedback from stdout. It will be markdown with the user's annotations:

   ```markdown
   ## Annotations
   > Extract JWT validation from monolith
   Use jose library instead of jsonwebtoken

   ## Added context
   - src/session.ts

   ## General
   Looks good, but add error handling step
   ```

4. Based on the feedback, edit `plan.jsx` using str_replace (do NOT regenerate the whole file). Then push again:

   ```bash
   planner push ~/.planner/sessions/$PLANNER_SESSION_ID/plan.jsx
   ```

5. Repeat until the user approves (feedback will say something like "approved" or "looks good, go ahead").

## Available JSX Components

- `<Section title="...">` — collapsible section with heading
- `<Task id="..." label="..." status="todo|done|blocked">` — task item
- `<FilePreview path="..." lines={[start, end]} />` — syntax-highlighted file preview
- `<CodeBlock language="...">` — inline code
- `<Callout type="info|warning|danger|tip">` — callout box
- `<Mermaid>` — mermaid diagram
- `<Table headers={[...]} rows={[[...], ...]} />` — table
- `<Priority level="high|medium|low" />` — priority badge
- `<Checklist items={[{label, checked}]} />` — visual checklist
- `<Note>` — aside/note
- `<Diff before="..." after="..." language="..." />` — diff view

## Important rules

- Always use `$PLANNER_SESSION_ID` for the session directory — this is set automatically.
- `plan.jsx` is a JSX fragment — do NOT include import statements or function declarations. Just write the JSX directly.
- Every `<Task>` must have a unique `id` prop.
- `<FilePreview path="...">` paths are relative to the project root. The planner serves them from disk.
- After receiving feedback, use `str_replace` to edit plan.jsx — do NOT rewrite the entire file.
- The user can add files to context via the file browser. These appear under "Added context" in the feedback. Read those files before the next iteration.
- When the user is satisfied, proceed with implementation based on the final plan.
