"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icons";
import { disconnectAction, type SaveState, type SettingsTarget } from "./actions";

export function DisconnectForm({ target }: { target: SettingsTarget }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(disconnectAction.bind(null, target), null);
  const whose = target.viewer === "agency" ? "this client's" : "your";
  return (
    <section className="danger" aria-labelledby="disconnect-title">
      <h3 id="disconnect-title">Stop sorting calls</h3>
      <p>Removes {whose} token and settings from this app. Nothing in Nexus Portal is changed.</p>
      <form action={action} className="inline-actions">
        <label className="check">
          <input type="checkbox" name="confirm" required />
          Yes, disconnect this sub-account
        </label>
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
      </form>
      {state && !state.ok ? (
        <p className="status-line status-error" role="alert">
          <Icon name="attention" size={18} />
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
