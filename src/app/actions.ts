"use server";

import { redirect } from "next/navigation";
import { connectClient, type ConnectState } from "@/lib/connect";
import { endSession, startSession } from "@/lib/session";

/** Connecting is signing in: a token that works for the location proves the sub-account is the visitor's. */
export async function connectAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const locationId = String(formData.get("locationId") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const result = await connectClient(locationId, token);
  if (!result.ok) return { error: result.error, locationId };
  await startSession(result.settings.locationId);
  redirect("/settings");
}

export async function signOutAction() {
  await endSession();
  redirect("/");
}
