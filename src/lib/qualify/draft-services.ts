import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { askForJson } from "@/lib/openai";

const execFileAsync = promisify(execFile);

const MAX_CHARS = 12_000;
/** Less text than this and the page was probably drawn in the browser, so it's rendered first. */
const THIN_PAGE_CHARS = 400;
/** A title and meta description alone still say what a business does. */
const MIN_CHARS = 80;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const MAX_REDIRECTS = 5;
const READ_TIMEOUT_MS = 20_000;

export type WebsiteAddress = { ok: true; url: string; host: string } | { ok: false; message: string };

const NOT_A_WEBSITE: WebsiteAddress = {
  ok: false,
  message: "That isn't a website address. Enter one like www.example.co.uk.",
};

/**
 * An address the server may fetch: http or https, a domain name, the normal
 * port, no login in it, and nothing that points inside a network. The address
 * comes from the Nexus Portal business profile or is typed on the settings
 * page, so it's checked here and again on every redirect.
 */
export function websiteAddress(raw: string | null | undefined): WebsiteAddress {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, message: "Enter the website address." };
  if (text.length > 300) return NOT_A_WEBSITE;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return NOT_A_WEBSITE;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return NOT_A_WEBSITE;
  if (u.username || u.password || u.port) return NOT_A_WEBSITE;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // The URL parser turns every spelling of an IPv4 address into dotted digits, and IPv6 into [..].
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) return NOT_A_WEBSITE;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return NOT_A_WEBSITE;
  return { ok: true, url: u.toString(), host };
}

/** Where a redirect goes, if it's somewhere the server may follow; otherwise null. */
export function nextHop(location: string, from: string): string | null {
  try {
    const next = websiteAddress(new URL(location, from).toString());
    return next.ok ? next.url : null;
  } catch {
    return null;
  }
}

/** The website couldn't be read. `reason` says why, in words for the settings page. */
export class WebsiteReadError extends Error {
  readonly host: string;
  readonly reason: string;
  constructor(host: string, reason: string) {
    super(`${host}: ${reason}`);
    this.name = "WebsiteReadError";
    this.host = host;
    this.reason = reason;
  }
}

/** Why a website couldn't be read, from what fetch threw. */
export function readProblem(e: unknown): string {
  const err = (e ?? {}) as { name?: string; message?: string; cause?: { code?: string; cause?: { code?: string } } };
  if (err.name === "TimeoutError" || err.name === "AbortError") return "the site took too long to answer";
  const code = err.cause?.code ?? err.cause?.cause?.code ?? "";
  if (code === "ENOTFOUND") return "there's no website at that address";
  if (code === "EAI_AGAIN") return "its address couldn't be looked up just now";
  if (code === "ECONNREFUSED") return "the site refused the connection";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "the site dropped the connection";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "the site took too long to answer";
  if (code === "CERT_HAS_EXPIRED") return "its security certificate has expired";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code)) return "its security certificate isn't valid";
  const message = err.message ?? String(e);
  return message === "fetch failed" ? "the site couldn't be reached" : message;
}

/**
 * A first draft of a business's services list, read from its own website.
 * Only ever a draft: the settings page shows it and nothing is saved until
 * someone presses Save. A website that can't be read throws WebsiteReadError;
 * anything else (Vantage AI unavailable) throws as it is.
 */
export async function draftServicesFromWebsite(
  businessName: string,
  address: { url: string; host: string },
): Promise<string[]> {
  const { url } = address;
  let text: string;
  try {
    text = (await readWebsite(url)).slice(0, MAX_CHARS);
  } catch (e) {
    throw new WebsiteReadError(address.host, readProblem(e));
  }

  const { data } = await askForJson<{ services: string[] }>({
    name: "services_draft",
    instructions: [
      "You read a local trades or service business's website and list the services it supplies.",
      "The list is used to decide whether a caller wants something the business does.",
      '- Short labels of 2 to 5 words, in words a customer would use ("Boiler repairs", "Blocked drains").',
      "- Only services the text clearly says the business offers. No places, prices, brands, guarantees or slogans.",
      "- Split combined items into separate services and merge near-duplicates.",
      "- 3 to 15 entries. If the text shows no services, return an empty list.",
    ].join("\n"),
    input: `Business: ${businessName}\nWebsite: ${url}\n\n${text}`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["services"],
      properties: { services: { type: "array", items: { type: "string" } } },
    },
  });
  return [...new Set(data.services.map((s) => s.trim()).filter(Boolean))].slice(0, 20);
}

/**
 * The page's readable text. Plenty of small-business sites (Lovable, Wix,
 * plain React) send an empty page and draw it in the browser, so a thin page
 * is rendered in headless Chrome where there is one (a PC running the app).
 * On Vercel there isn't, and a thin page says so.
 *
 * Redirects are followed by hand so each one is checked like the address
 * itself: a public site can't bounce the server onto a private address.
 */
async function readWebsite(start: string): Promise<string> {
  const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
  let url = start;
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      signal,
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    await res.body?.cancel();
    const next = nextHop(location, url);
    if (!next) throw new Error("it redirects somewhere that isn't a public website");
    url = next;
    res = null;
  }
  if (!res) throw new Error("it redirects too many times");
  if (!res.ok) throw new Error(`the site answered ${res.status}`);
  const plain = htmlToText(await res.text());
  if (plain.length >= THIN_PAGE_CHARS) return plain;

  const rendered = await renderInBrowser(url).then(htmlToText, () => "");
  const best = rendered.length > plain.length ? rendered : plain;
  if (best.length < MIN_CHARS) throw new Error("the page has too little text to read services from");
  return best;
}

async function renderInBrowser(url: string): Promise<string> {
  const browser = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((p) => existsSync(p));
  if (!browser) throw new Error("no Chrome or Edge to render the page with");

  // A throwaway profile, so a browser window that's already open never gets in the way.
  const profile = mkdtempSync(path.join(tmpdir(), "lead-qualifier-"));
  try {
    const { stdout } = await execFileAsync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--user-data-dir=${profile}`,
        "--virtual-time-budget=10000",
        "--dump-dom",
        url,
      ],
      { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
    );
    return stdout;
  } finally {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // The browser can hold the folder a moment after exiting; the OS temp cleaner gets it.
    }
  }
}

/** Readable text from a page: title, meta description, then body text without scripts or markup. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|tr|a)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return [title, description, body].filter(Boolean).join("\n");
}
