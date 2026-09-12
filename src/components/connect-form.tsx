"use client";

import { useActionState } from "react";
import type { ConnectState } from "@/lib/connect";
import { REQUIRED_SCOPES } from "@/lib/ghl-scopes";
import { Icon } from "./icons";

/** Location ID and token, with help beside each field: a client connecting their own sub-account, or the agency adding one. */
export function ConnectForm({
  action: connect,
  submitLabel,
}: {
  action: (prev: ConnectState, formData: FormData) => Promise<ConnectState>;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connect, null);
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="locationId">Location ID</label>
        <input
          id="locationId"
          name="locationId"
          type="text"
          autoComplete="off"
          spellCheck={false}
          defaultValue={state?.locationId ?? ""}
          aria-describedby="locationId-hint"
          required
        />
        <p id="locationId-hint" className="hint">
          Open the sub-account in Nexus Portal. It&apos;s the code in the web address after /location/
        </p>
        <span className="sample-url" aria-hidden>
          …/v2/location/<mark>aBc12dEf34GhIj56KlMn</mark>
        </span>
      </div>

      <div className="field">
        <label htmlFor="token">Private Integration token</label>
        <input id="token" name="token" type="password" autoComplete="off" placeholder="pit-…" required />
        <details className="disclosure">
          <summary>
            <Icon name="chevronRight" size={18} />
            How to make a token
          </summary>
          <ol>
            <li>In the sub-account, open Settings, then Private Integrations.</li>
            <li>
              Create a new integration with these permissions:
              <ul className="scopes">
                {REQUIRED_SCOPES.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </li>
            <li>Copy the token and paste it here. Nexus Portal only shows it once.</li>
          </ol>
        </details>
      </div>

      {state?.error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="attention" size={18} />
          <span>{state.error}</span>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "Checking with Nexus Portal…" : submitLabel}
      </button>
    </form>
  );
}
