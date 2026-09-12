import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectForm } from "@/components/connect-form";
import { Icon } from "@/components/icons";
import { TopBand } from "@/components/top-band";
import { listClients, type ClientSettings } from "@/lib/clients";
import { formatPhone } from "@/lib/phone";
import { checkClient, type ClientCheck } from "@/lib/qualify/config";
import { requireAgency } from "@/lib/session";
import { addClientAction } from "./actions";
import { ClientList, type ClientRow, type ClientState } from "./client-list";
import { AgencySignOut } from "./sign-out-button";

export const metadata: Metadata = { title: "Clients" };

export default async function AgencyPage() {
  await requireAgency();
  const clients = await listClients();

  return (
    <>
      <TopBand
        brandHref="/agency"
        tag="Agency"
        title="Clients"
        subtitle="Every sub-account connected to the app, whether you added it or the client connected it themselves."
        actions={<AgencySignOut />}
      />
      <main className="page">
        <Suspense
          fallback={
            <section className="panel panel-top panel-pad">
              <p className="status-line muted">
                <Icon name="waiting" size={20} />
                Checking {clients.length === 1 ? "1 client" : `${clients.length} clients`} with Nexus Portal…
              </p>
            </section>
          }
        >
          <CheckedClients clients={clients} />
        </Suspense>
      </main>
    </>
  );
}

// Clients who need a hand come first: a refused token stops calls outright, a missing setting stops them too.
const ORDER: Record<ClientState, number> = { refused: 0, unknown: 1, todo: 2, live: 3 };

async function CheckedClients({ clients }: { clients: ClientSettings[] }) {
  const checks = await Promise.all(clients.map(checkClient));
  const rows = clients
    .map((client, i) => toRow(client, checks[i]))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
  return <ClientList rows={rows} addForm={<ConnectForm action={addClientAction} submitLabel="Add client" />} />;
}

function toRow(client: ClientSettings, check: ClientCheck): ClientRow {
  const base = {
    locationId: client.locationId,
    name: client.businessName ?? "Unnamed sub-account",
    numbers: client.numbers.map(formatPhone),
  };
  if (check.tokenRefused) {
    return { ...base, state: "refused", detail: "Nexus Portal refused the saved token. Add them again with a new one." };
  }
  if (check.ghlError) return { ...base, state: "unknown", detail: "Couldn't reach Nexus Portal just now. Reload to try again." };
  if (check.problems.length === 0) {
    return { ...base, state: "live", detail: `Sorting calls into “${check.pipeline?.name}”` };
  }
  const more = check.problems.length - 1;
  return { ...base, state: "todo", detail: more ? `${check.problems[0]} (${more} more to finish)` : check.problems[0] };
}
