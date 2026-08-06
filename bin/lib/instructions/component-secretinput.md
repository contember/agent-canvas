# Component: SecretInput

Local-only secret handoff for runbooks. Use it when the user must create or retrieve a token, password, private key, or other value that a command needs but the agent must not receive in its context.

The value stays outside normal canvas response state. It is not written to `localStorage`, annotations, feedback markdown, canvas revisions, or session metadata. The browser deposits it in the local daemon's in-memory vault. Feedback contains only the field ID and environment variable name.

## Props

- `id` (string, required) — unique field ID. Use letters, numbers, dots, underscores, and hyphens.
- `label` (string, required) — user-facing description.
- `env` (string, required) — environment variable used by the target command.
- `placeholder` (string) — input hint. Never put an example real secret here.
- `required` (boolean) — prevents feedback submission until the secret is stored.

## Usage

```jsx
<Section title="Create an API token">
  <Item id="open-settings" label="1. Open token settings">
    Open the service's token settings. Create a token with the minimum scopes needed for this task.
  </Item>

  <SecretInput
    id="service-token"
    label="2. Paste the new token"
    env="SERVICE_TOKEN"
    placeholder="Paste token"
    required
  />
</Section>
```

After feedback says the field is ready, run the target command through the wrapper:

```bash
bunx agent-canvas exec \
  --session <session-id> \
  --secret SERVICE_TOKEN=service-token \
  -- service-cli deploy
```

Repeat `--secret` for multiple values:

```bash
bunx agent-canvas exec \
  --session <session-id> \
  --secret CLIENT_ID=client-id \
  --secret CLIENT_SECRET=client-secret \
  -- service-cli login
```

## Security contract

- Use `SecretInput`, never `UserInput`, for secrets.
- Secret inputs work only on the local `localhost` canvas. They are unavailable in shared canvases.
- The CLI starts the command directly without a shell. The secret does not appear in the generated command or its arguments.
- Secret resolution requires a daemon capability that is available to the CLI but not to canvas JavaScript.
- The target program can still reveal its environment or print the secret. Use commands that do not echo credentials and do not enable verbose shell tracing.
- A new canvas revision clears all secrets for the session. Run the required commands before pushing the next revision.
- The same secret can be used by more than one wrapped command in the current revision. The user can replace or clear it in the browser.
- Daemon shutdown, session deletion, and stale-session cleanup clear the in-memory value.
