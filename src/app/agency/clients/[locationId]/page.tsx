import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HelpButton } from "@/components/help-button";
import { TopBand } from "@/components/top-band";
import { ClientSettingsView } from "@/app/settings/client-settings";
import { agencyOf } from "@/lib/agencies";
import { readClient } from "@/lib/clients";
import { requireAgency } from "@/lib/session";
import { AgencySignOut } from "../../sign-out-button";

export const metadata: Metadata = { title: "Client settings" };

export default async function AgencyClientPage({ params }: PageProps<"/agency/clients/[locationId]">) {
  const agency = await requireAgency();
  const { locationId } = await params;
  const client = await readClient(locationId);
  // Another agency's client is as good as none: nothing about it is shown.
  if (!client || agencyOf(client)?.id !== agency.id) redirect("/agency");

  return (
    <>
      <TopBand
        brandHref="/agency"
        tag={agency.name}
        back={{ href: "/agency", label: "All clients" }}
        title={client.businessName ?? "Unnamed sub-account"}
        subtitle={
          <>
            Nexus Portal sub-account <span className="num">{client.locationId}</span>
          </>
        }
        actions={
          <>
            <HelpButton chapter="signal-number" label="Help" look="band" />
            <AgencySignOut />
          </>
        }
      />
      <main className="page">
        <ClientSettingsView client={client} viewer="agency" />
      </main>
    </>
  );
}
