# RUNBOOK Flow

**When**: The agent needs the user to complete manual browser or account steps before automated work can continue. Examples: create an API token, approve an OAuth application, configure a webhook, or retrieve a credential.

**Phases**: Instructions → user action and secure handoff → agent command → result or next runbook revision

Runbooks are local-only when they include secrets. Read `component-secretinput` before authoring one.

## Phase 1: Instructions (`runbook.jsx`)

Give the user ordered, concrete steps. Include the exact destination, required permissions, expected result, and a safe secret field. Do not ask the user to paste a secret into annotations, general notes, `UserInput`, chat, or a terminal command.

```jsx
<Section title="Connect the service">
  <Callout type="info">
    Complete these steps in order. The token value will stay outside agent feedback and model context.
  </Callout>

  <Item id="open-token-page" label="1. Open token settings" status="todo">
    Open https://service.example/settings/tokens while signed in to the target account.
  </Item>

  <Item id="create-token" label="2. Create a scoped token" status="todo">
    Name it for this task. Grant only read:projects and write:deployments. Set the shortest practical expiry.
  </Item>

  <SecretInput
    id="service-token"
    label="3. Paste the token"
    env="SERVICE_TOKEN"
    required
  />

  <Choice
    id="target-confirmation"
    label="Which environment did you configure?"
    options={["Staging", "Production"]}
    required
  />
</Section>
```

Push and immediately watch as usual. The user first stores the secret, then submits feedback. The watcher receives a safe marker such as:

```text
Service token
Secret is ready. Field: service-token. Environment variable: SERVICE_TOKEN.
```

It never receives the value.

The raw-value resolver requires a daemon capability stored outside the browser. Canvas JSX can deposit, replace, clear, and check readiness, but it cannot read the value back.

## Phase 2: Run the command

Use the exact session ID and field-to-environment mapping from the runbook:

```bash
bunx agent-canvas exec \
  --session <session-id> \
  --secret SERVICE_TOKEN=service-token \
  -- service-cli configure --environment staging
```

Rules:

1. Put the target command after `--`.
2. Never interpolate the secret into the shell command, arguments, generated files, or logs.
3. Do not use commands that print their complete environment or enable debug output that includes credentials.
4. Preserve the wrapped command's output and exit code when reporting the result.
5. Run every command that needs the secret before pushing another revision. A new revision clears the vault.

## Phase 3: Continue or finish

If another manual action is needed, update the existing runbook with the next steps, push a new revision, and watch again. The user must deposit any required secrets again because revision changes clear them.

When the operation is complete, push the standard implementation summary. Report what succeeded, what remains, and whether the user should revoke the temporary token. Never include the token value.
