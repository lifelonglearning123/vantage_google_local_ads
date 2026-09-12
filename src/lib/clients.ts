import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";
import type { StageChoice } from "@/lib/qualify/stages";

/**
 * Each connected client's settings: one small JSON file per GoHighLevel
 * sub-account, `clients/<locationId>.json`, holding only what the client chose
 * on the settings page and their token (encrypted, src/lib/crypto.ts). No
 * calls or customer details are ever stored.
 *
 * On Vercel the files live in a PRIVATE Blob store connected to the project
 * (the SDK authenticates with OIDC). On localhost, without a Blob token, they
 * are plain files in .data/clients.
 */

export type ClientSettings = {
  version: 1;
  locationId: string;
  businessName: string | null;
  website: string | null;
  /** Private Integration token, AES-256-GCM. */
  tokenEnc: string;
  /** E.164. Calls to any other number are ignored. */
  numbers: string[];
  pipelineId: string | null;
  stages: StageChoice;
  services: string[];
  connectedAt: string;
  updatedAt: string;
};

// Location ids become file names, so nothing but letters and digits ever gets that far.
const LOCATION_ID = /^[A-Za-z0-9]{1,64}$/;
const FILE_NAME = /^([A-Za-z0-9]{1,64})\.json$/;

const BLOB_FOLDER = "clients/";
const blobPath = (locationId: string) => `${BLOB_FOLDER}${locationId}.json`;
const localDir = () => process.env.CLIENTS_DIR || path.join(process.cwd(), ".data", "clients");

function inBlobStore(): boolean {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return true;
  if (process.env.VERCEL) {
    throw new Error("No Blob store is connected. Connect a private Vercel Blob store to this project.");
  }
  return false;
}

export async function readClient(locationId: string): Promise<ClientSettings | null> {
  if (!LOCATION_ID.test(locationId)) return null;
  if (inBlobStore()) {
    // useCache: false — a save has to show up on the very next read, not up to a minute later.
    const result = await get(blobPath(locationId), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return parse(await new Response(result.stream).text());
  }
  try {
    return parse(await readFile(path.join(localDir(), `${locationId}.json`), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function saveClient(settings: ClientSettings): Promise<void> {
  if (!LOCATION_ID.test(settings.locationId)) throw new Error("Invalid location ID.");
  const body = JSON.stringify(settings, null, 2);
  if (inBlobStore()) {
    await put(blobPath(settings.locationId), body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return;
  }
  await mkdir(localDir(), { recursive: true });
  await writeFile(path.join(localDir(), `${settings.locationId}.json`), body, "utf8");
}

/** Every connected client, by business name. A file that can't be read is logged and left out. */
export async function listClients(): Promise<ClientSettings[]> {
  const ids = inBlobStore() ? await blobLocationIds() : await localLocationIds();
  const clients = await Promise.all(
    ids.map((id) =>
      readClient(id).catch((e: unknown) => {
        console.error("[clients] settings file unreadable", {
          locationId: id,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      }),
    ),
  );
  const name = (c: ClientSettings) => c.businessName ?? c.locationId;
  return clients.filter((c) => c !== null).sort((a, b) => name(a).localeCompare(name(b)));
}

async function blobLocationIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: BLOB_FOLDER, cursor });
    for (const blob of page.blobs) {
      const id = FILE_NAME.exec(blob.pathname.slice(BLOB_FOLDER.length))?.[1];
      if (id) ids.push(id);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return ids;
}

async function localLocationIds(): Promise<string[]> {
  try {
    return (await readdir(localDir())).flatMap((file) => FILE_NAME.exec(file)?.[1] ?? []);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export async function deleteClient(locationId: string): Promise<void> {
  if (!LOCATION_ID.test(locationId)) return;
  if (inBlobStore()) {
    await del(blobPath(locationId));
    return;
  }
  await rm(path.join(localDir(), `${locationId}.json`), { force: true });
}

function parse(text: string): ClientSettings {
  const data = JSON.parse(text) as ClientSettings;
  if (data.version !== 1) throw new Error(`Unsupported client settings version: ${String(data.version)}`);
  return data;
}
