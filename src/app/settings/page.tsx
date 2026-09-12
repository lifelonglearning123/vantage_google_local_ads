import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { TopBand } from "@/components/top-band";
import { readClient } from "@/lib/clients";
import { getSignedInLocation } from "@/lib/session";
import { signOutAction } from "../actions";
import { ClientSettingsView } from "./client-settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const locationId = await getSignedInLocation();
  const client = locationId ? await readClient(locationId) : null;
  if (!client) redirect("/");

  return (
    <>
      <TopBand
        title={client.businessName ?? "Your settings"}
        subtitle={
          <>
            Nexus Portal sub-account <span className="num">{client.locationId}</span>
          </>
        }
        actions={
          <form action={signOutAction}>
            <button type="submit" className="btn btn-quiet">
              <Icon name="signOut" size={18} />
              Sign out
            </button>
          </form>
        }
      />
      <main className="page">
        <ClientSettingsView client={client} viewer="client" />
      </main>
    </>
  );
}
