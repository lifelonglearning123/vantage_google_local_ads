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

/**
 * A first draft of a business's services list, read from its own website.
 * Only ever a draft: `npm run setup` shows it and saves nothing until the
 * services are passed back explicitly.
 */
export async function draftServicesFromWebsite(businessName: string, website: string): Promise<string[]> {
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const text = (await readWebsite(url)).slice(0, MAX_CHARS);

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
 * is rendered in local headless Chrome. That's fine here: `npm run setup`
 * runs on a PC, never on Vercel.
 */
async function readWebsite(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
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
