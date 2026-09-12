import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TopBand } from "@/components/top-band";
import { ClientSettingsView } from "@/app/settings/client-settings";
import { readClient } from "@/lib/clients";
import { requireAgency } from "@/lib/session";
import { AgencySignOut } from "../../sign-out-button";

export const metadata: Metadata = { title: "Client settings" };

export default async function AgencyClientPage({ params }: PageProps<"/agency/clients/[locationId]">) {
  await requireAgency();
  const { locationId } = await params;
  const client = await readClient(locationId);
  if (!client) redirect("/agency");

  return (
    <>
      <TopBand
        brandHref="/agency"
        tag="Agency"
        back={{ href: "/agency", label: "All clients" }}
        title={client.businessName ?? "Unnamed sub-account"}
        subtitle={
          <>
            Nexus Portal sub-account <span className="num">{client.locationId}</span>
          </>
        }
        actions={<AgencySignOut />}
      />
      <main className="page">
        <ClientSettingsView client={client} viewer="agency" />
      </main>
    </>
  );
}
