"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icons";
import { agencySignInAction, type AgencySignInState } from "../actions";

export function AgencySignInForm() {
  const [state, action, pending] = useActionState<AgencySignInState, FormData>(agencySignInAction, null);
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          spellCheck={false}
          defaultValue={state?.username ?? ""}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="attention" size={18} />
          <span>{state.error}</span>
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
