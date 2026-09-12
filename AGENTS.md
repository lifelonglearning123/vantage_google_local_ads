<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lead Qualifier

Signal (`C:\python\Signal`) POSTs a signed `call.synced` webhook, and this app sorts the caller's opportunity in that client's GoHighLevel. Contract v1 lives in `src/lib/signal/contract.ts` and Signal's AGENTS.md ("Call webhook"). Change both together.

**No database, by Chao's design.**
- Customers and opportunities live in GoHighLevel; calls live in Signal.
- The only thing this app keeps is each client's settings: one JSON file per sub-account (`src/lib/clients.ts`).
  - On Vercel: a PRIVATE Blob store, read with `useCache: false` so a save shows up immediately.
  - On localhost: `.data/clients`.
- The file holds the encrypted token, chosen numbers, pipeline id, stage ids and services — never calls or customer data.

**Clients** connect at `/` with location ID and token (`connectClient` in `src/lib/connect.ts`). A token that lists the location's pipelines and contacts proves the sub-account is theirs.
- Connecting is signing in: a signed cookie holds only the location ID (`session-token.ts`).
- `/settings` loads pipelines live and lets them choose numbers, pipeline, stages (pre-selected by name, `stages.ts`) and services. "Suggest from my website" (`draft-services.ts`) fills the form but saves nothing.

**The agency** signs in at `/agency/sign-in` with `AGENCY_USERNAME` and `AGENCY_PASSWORD` (`src/app/agency`).
- Its session is a separate signed cookie, `lq_agency`. The signing key includes the password, so changing the password signs the agency out everywhere, and neither kind of session passes for the other.
- `/agency` lists every settings file (`listClients`). Each row's live check streams in.
- "Add client" goes through the same `connectClient` a client uses, without signing anyone in as that client.
- `/agency/clients/<location ID>` renders the same view as `/settings` (`src/app/settings/client-settings.tsx`).

**Settings actions** receive `{ viewer, locationId }` from the page and trust neither value (`allowedClient` in `src/app/settings/actions.ts`).
- The agency needs its own session.
- A client gets only the sub-account in their own session.
- Either way, the settings file must still exist.

**Flow (`src/lib/qualify/process.ts`).**

`acceptCall` runs before the response. Throwing here answers 500, so Signal sends the call again.
1. Reads the client's settings.
2. Checks the number.
3. `loadLiveConfig` checks the chosen pipeline and stages against GoHighLevel now.
4. Finds the contact, then the open opportunity, or creates one in New Leads.

`finish` runs in `after()` and never throws:
1. `classifyCall`, then `planOpportunity`, then the update.
2. A note ending `Ref: Signal call <id>`. That ref is the idempotency key: a resent call whose note exists is a duplicate.

**Deliberate rules.**
- `settleVerdict` downgrades to Qualification Required when Lost lacks a reason or is low-confidence, or when Qualified doesn't match the services list.
- Hang-ups are decided by rule, not the model.
- `planOpportunity` only moves forward through the chosen stages. Any other stage belongs to the client's team, and a qualified opportunity is never marked Lost.

**Don't:**
- add a database, or store call or customer data;
- answer non-2xx for calls the app chooses to ignore (Signal retries for about 25h);
- save a suggested services list without the client pressing Save;
- let a settings action act on the location ID it's sent without `allowedClient`;
- remove the `key` on the settings forms: a remount per client stops one client's typed settings being saved into another's;
- read env at import time;
- log tokens.

**Checks:** `npm run verify` (no network), `npm run try:qualifier`, `npm run typecheck`, `npm run lint`.

**Local dev:** `npm run dev` goes through `scripts/dev.mjs`, which raises Node's 16 KB request-header limit.
- Why: browsers send every localhost cookie to every port, and other local apps' Supabase logins push server-action requests over the limit.
- What it looks like: Node answers 431, the save "didn't go through", and the server logs nothing.

**Design.** The UI follows the Vantage brand book (`vantage Google Ads brand book.pdf`, in this folder). Its tokens are in `src/app/globals.css`.
- **Colour:** ink `#201E1D`, ground `#F3F2F2`, surface `#EAE9E9`, and one amber `#D9820B`, plus the book's neutral and amber ramps.
  - Amber marks the primary action and any state that needs acting on.
  - Amber words at paragraph size use 700 (`#8C5100`).
  - There's no second colour, so status is shown with Lucide icons and words, never green or red.
- **Type:** Archivo only, weights 400, 600 and 800, flush left.
  - It's self-hosted from `@fontsource-variable/archivo`, because `next/font/google` crashes Turbopack on Windows ARM64.
- **Surfaces:** square corners, 2px rules, no shadows and no gradients.
  - Depth comes from flat layers: the ink band, the first panel overlapping it, fields in the surface tone, and the ink call-sorting panel.
- **Logo:** `src/components/brand.tsx` and `src/app/icon.svg` use the book's exact paths. Never round it, stretch it or put it in a pill.
- **Voice:** "like a good foreman": short, certain, specific. The AI that reads calls is "Vantage AI".
- **The CRM is called Nexus Portal.** Clients use GoHighLevel under that white-label name.
  - Every word a person sees says Nexus Portal: page text, buttons, messages, contact notes, and errors that reach Signal.
  - Code, comments, API names and these docs keep saying GoHighLevel, the system underneath.
