import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Just enough of GoHighLevel's API, in memory, to exercise every request the
 * app makes. One sub-account (FAKE_LOCATION) with a "Sales" pipeline and a
 * services Custom Value; tests reshape `pipelines` and `customValues` freely.
 */

export const FAKE_TOKEN = "test-token";
export const FAKE_LOCATION = "loc1";

export type FakeOpp = {
  id: string;
  name: string;
  status: string;
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  locationId: string;
  updatedAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function startFakeGhl() {
  const pipelines = [
    {
      id: "p-sales",
      name: "Sales",
      stages: [
        { id: "st-new", name: "New Leads", position: 0 },
        { id: "st-qr", name: "Qualification Required", position: 1 },
        { id: "st-q", name: "Qualified", position: 2 },
        { id: "st-quote", name: "Quote Sent", position: 3 },
      ],
    },
  ];
  const customValues = [
    { id: "cv-services", name: "Lead Qualifier Services", value: "Boiler repairs\nBlocked drains\nBathroom fitting" },
  ];
  const opps: FakeOpp[] = [];
  const notes: Array<{ contactId: string; body: string }> = [];
  const contacts: Array<{ id: string; phone: string; locationId: string }> = [];
  const log: string[] = [];
  let n = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const path = url.pathname;
    const body = await readJson(req);
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    log.push(`${req.method} ${path}`);
    if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}` || req.headers.version !== "2021-07-28") {
      return send(401, { message: "Invalid Private Integration token" });
    }
    const stamp = () => new Date(Date.now() + n++).toISOString();

    if (req.method === "GET" && path === "/opportunities/pipelines") {
      return send(200, { pipelines: url.searchParams.get("locationId") === FAKE_LOCATION ? pipelines : [] });
    }
    if (req.method === "GET" && path === `/locations/${FAKE_LOCATION}`) {
      return send(200, {
        location: { id: FAKE_LOCATION, name: "Hartley Plumbing & Heating", website: "hartley-plumbing.example" },
      });
    }
    if (req.method === "GET" && path === `/locations/${FAKE_LOCATION}/customValues`) {
      return send(200, { customValues });
    }
    if (req.method === "POST" && path === `/locations/${FAKE_LOCATION}/customValues`) {
      const value = { id: `cv-${++n}`, name: body.name, value: body.value };
      customValues.push(value);
      return send(201, { customValue: value });
    }
    const valuePath = new RegExp(`^/locations/${FAKE_LOCATION}/customValues/([^/]+)$`).exec(path);
    if (req.method === "PUT" && valuePath) {
      const value = customValues.find((v) => v.id === valuePath[1]);
      if (!value) return send(404, { message: "Custom value not found" });
      value.name = body.name;
      value.value = body.value;
      return send(200, { customValue: value });
    }
    if (req.method === "GET" && path === "/opportunities/search") {
      const q = url.searchParams;
      return send(200, {
        opportunities: opps.filter(
          (o) =>
            o.locationId === q.get("location_id") &&
            o.contactId === q.get("contact_id") &&
            o.pipelineId === q.get("pipeline_id") &&
            (!q.get("status") || o.status === q.get("status")),
        ),
      });
    }
    if (req.method === "POST" && path === "/opportunities/") {
      const opp: FakeOpp = {
        id: `opp-${++n}`,
        name: body.name,
        status: body.status,
        pipelineId: body.pipelineId,
        pipelineStageId: body.pipelineStageId,
        contactId: body.contactId,
        locationId: body.locationId,
        updatedAt: stamp(),
      };
      opps.push(opp);
      return send(201, { opportunity: opp });
    }
    const oppPath = /^\/opportunities\/([^/]+)$/.exec(path);
    if (req.method === "PUT" && oppPath) {
      const opp = opps.find((o) => o.id === oppPath[1]);
      if (!opp) return send(404, { message: "Opportunity not found" });
      for (const key of ["name", "status", "pipelineId", "pipelineStageId"] as const) {
        if (body[key] !== undefined) opp[key] = body[key];
      }
      opp.updatedAt = stamp();
      return send(200, { opportunity: opp });
    }
    const notePath = /^\/contacts\/([^/]+)\/notes$/.exec(path);
    if (notePath && req.method === "GET") {
      return send(200, {
        notes: notes.filter((x) => x.contactId === notePath[1]).map((x, i) => ({ id: `note-${i}`, body: x.body })),
      });
    }
    if (notePath && req.method === "POST") {
      notes.push({ contactId: notePath[1], body: body.body });
      return send(201, { note: { id: `note-${++n}` } });
    }
    if (req.method === "POST" && path === "/contacts/search") {
      const phone = body.filters?.[0]?.value;
      return send(200, { contacts: contacts.filter((c) => c.phone === phone && c.locationId === body.locationId) });
    }
    if (req.method === "POST" && path === "/contacts/") {
      const contact = { id: `contact-new-${++n}`, phone: body.phone, locationId: body.locationId };
      contacts.push(contact);
      return send(201, { contact });
    }
    send(404, { message: `no fake for ${req.method} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    pipelines,
    customValues,
    opps,
    notes,
    contacts,
    log,
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}
