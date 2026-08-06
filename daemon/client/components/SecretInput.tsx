import React, { useEffect, useState } from "react";
import { useFeedback } from "#canvas/runtime";
import { MODE, clearLocalSecret, getLocalSecretStatus, storeLocalSecret } from "../clientApi";

const FIELD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface SecretInputProps {
  id: string;
  label: string;
  env: string;
  placeholder?: string;
  required?: boolean;
}

/** Local-only secret handoff that never enters annotation or feedback state. */
export function SecretInput({ id, label, env, placeholder, required }: SecretInputProps) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(!MODE.isShared);
  const [error, setError] = useState<string | null>(null);
  const validFieldId = FIELD_ID_RE.test(id);
  const validEnvName = ENV_NAME_RE.test(env);
  const locallyAvailable = !MODE.isShared;

  useEffect(() => {
    if (!locallyAvailable || !validFieldId) {
      setBusy(false);
      return;
    }

    let active = true;
    getLocalSecretStatus(id)
      .then((isReady) => {
        if (active) setReady(isReady);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not read secret status");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [id, locallyAvailable, validFieldId]);

  const feedback = ready
    ? `**${label}**\nSecret is ready. Field: \`${id}\`. Environment variable: \`${env}\`.\n`
    : "";
  useFeedback(`secret:${id}`, feedback, {
    label,
    required: required && locallyAvailable,
  });

  const store = async () => {
    if (!value || !validFieldId || !validEnvName) return;
    setBusy(true);
    setError(null);
    try {
      await storeLocalSecret(id, value);
      setValue("");
      setReady(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not store secret");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearLocalSecret(id);
      setReady(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not clear secret");
    } finally {
      setBusy(false);
    }
  };

  if (!locallyAvailable) {
    return (
      <div data-md="secretinput" data-md-label={label} className="-mx-4 px-4 py-3 my-1 rounded-lg bg-accent-amber-muted">
        <div className="text-[13px] font-body font-medium text-text-primary">{label}</div>
        <p className="text-[12px] font-body text-text-secondary mt-1">
          Secret input is unavailable in shared canvases. Open this runbook on the author's local canvas daemon.
        </p>
      </div>
    );
  }

  const configurationError = !validFieldId
    ? "Secret field IDs may contain letters, numbers, dots, underscores, and hyphens."
    : !validEnvName
      ? "Environment variable names must use letters, numbers, and underscores and may not start with a number."
      : null;

  return (
    <div data-md="secretinput" data-md-label={label} className="-mx-4 px-4 py-3 my-1 rounded-lg transition-colors duration-150 hover:bg-bg-input">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
          {required && <span className="text-[10px] text-accent-red font-body">*</span>}
        </div>
        <span className={`text-[11px] font-body ${ready ? "text-accent-green" : "text-text-tertiary"}`}>
          {busy ? "Working…" : ready ? "Ready in memory" : "Not stored"}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void store();
            }
          }}
          placeholder={placeholder || "Paste secret value"}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || !!configurationError}
          className="min-w-0 flex-1 bg-bg-input text-[13px] font-mono text-text-primary rounded-lg px-3 py-2 focus:outline-none border border-border-subtle focus:border-border-hover placeholder:text-text-tertiary disabled:opacity-50 transition-colors"
        />
        <button
          type="button"
          onClick={() => void store()}
          disabled={busy || !value || !!configurationError}
          className="px-3 py-2 rounded-lg bg-btn-primary text-btn-primary-text text-[12px] font-body font-medium disabled:opacity-40 disabled:cursor-default"
        >
          {ready ? "Replace" : "Store"}
        </button>
        {ready && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="px-3 py-2 rounded-lg border border-border-subtle text-text-secondary text-[12px] font-body font-medium hover:border-border-hover disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>

      <p className="text-[11px] font-body text-text-tertiary mt-1.5">
        Stored only in daemon memory. The agent receives field {id} for {env}, not the value.
      </p>
      {(configurationError || error) && (
        <p className="text-[11px] text-accent-red font-body mt-1">{configurationError || error}</p>
      )}
    </div>
  );
}
