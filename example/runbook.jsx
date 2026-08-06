<>
  <Section title="Runbook: connect a deployment service">
    <Callout type="info">
      Complete these steps in order. The token value stays in the local daemon and is not included in feedback.
    </Callout>

    <Item id="runbook-open-settings" label="1. Open token settings" status="todo">
      Sign in to the target service and open its API token settings.
    </Item>

    <Item id="runbook-create-token" label="2. Create a scoped token" status="todo">
      Create a short-lived token with only the permissions needed for this operation.
    </Item>

    <SecretInput
      id="deployment-token"
      label="3. Paste the token"
      env="DEPLOYMENT_TOKEN"
      placeholder="Paste token"
      required
    />
  </Section>
</>
