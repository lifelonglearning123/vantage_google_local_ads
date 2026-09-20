"use server";

import { redirect } from "next/navigation";
import { connectClient, type ConnectState } from "@/lib/connect";
import { agencyForRequest, endSession, startSession } from "@/lib/session";

/** Connecting is signing in: a token that works for the location proves the sub-account is the visitor's. */
export async function connectAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const locationId = String(formData.get("locationId") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  // A new client belongs to the agency whose domain they connected on.
  const agency = await agencyForRequest();
  if (!agency) return { error: "This address isn't set up yet. Connect at the address your agency gave you.", locationId };
  const result = await connectClient(locationId, token, agency.id, "client");
  if (!result.ok) return { error: result.error, locationId };
  await startSession(result.settings.locationId);
  redirect("/settings");
}

export async function signOutAction() {
  await endSession();
  redirect("/");
}
