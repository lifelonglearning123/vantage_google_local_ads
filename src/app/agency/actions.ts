"use server";

import { redirect } from "next/navigation";
import { connectClient, type ConnectState } from "@/lib/connect";
import { agencyLogin, endAgencySession, requireAgency, startAgencySession } from "@/lib/session";
import { loginMatches } from "@/lib/session-token";

// `username` comes back so the form can refill it: React resets a form after its action runs.
export type AgencySignInState = { error: string; username: string } | null;

export async function agencySignInAction(_prev: AgencySignInState, formData: FormData): Promise<AgencySignInState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const setup = agencyLogin();
  if (!setup.ok) return { error: setup.reason, username };
  if (!loginMatches(setup.login, username, password)) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // slows down guessing
    console.warn("[agency] sign-in refused");
    return { error: "That username and password don't match.", username };
  }
  await startAgencySession(setup.login);
  redirect("/agency");
}

export async function agencySignOutAction() {
  await endAgencySession();
  redirect("/agency/sign-in");
}

/** Adding a client is connecting their sub-account for them (src/lib/connect.ts). It doesn't sign anyone in as them. */
export async function addClientAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  await requireAgency();
  const locationId = String(formData.get("locationId") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const result = await connectClient(locationId, token);
  if (!result.ok) return { error: result.error, locationId };
  redirect(`/agency/clients/${result.settings.locationId}`);
}
