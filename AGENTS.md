<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lead Qualifier

Signal (`C:\python\Signal`) POSTs a signed `call.synced` webhook, and this app sorts the caller's opportunity in that client's GoHighLevel. Contract v1 lives in `src/lib/signal/contract.ts` and Signal's AGENTS.md ("Call webhook", "Call-backs"). Change both together. Fields added since v1 shipped (`callBackUrl`, `call.callBackOf`, `call.endReason`) are optional, so an older sender still parses.

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
2. When the client has call-backs on, it may ask Signal to ring the caller back (below).
3. A note ending `Ref: Signal call <id>`. That ref is the idempotency key: a resent call whose note exists is a duplicate.

**Call-backs (`src/lib/qualify/call-back.ts`).** A per-client switch in settings (`callBacks` in the settings file; missing reads as off).
- **When it asks:** an inbound call whose verdict is Qualification Required and whose opportunity ends in that stage. A hang-up asks with reason `hang_up` (decided by rule), anything else unclear with `unclear`. A Qualified or Lost caller, an opportunity already further along, or a call that couldn't be sorted never asks.
- **How:** POST to the payload's `callBackUrl`, signed like the webhook with `SIGNAL_WEBHOOK_SECRET`. Signal owns the when (about 5 minutes after the call, in opening hours), the number (the line they rang), the re-checks (they rang again, someone called them, the account is paused) and the call itself: its AGENTS.md, "Call-backs". No `callBackUrl` means Signal can't ring back that line; the note says so.
- **The voice is the client's choice, here** — they switch call-backs on in this app, so they pick the voice here too (`callBackVoiceId` in the settings file, sent with the request). This app holds no telephony keys, so the list comes from Signal: `listCallBackVoices` (`src/lib/qualify/voices.ts`) asks `SIGNAL_BASE_URL` + `/api/call-backs/voices` with the same signature, and the settings step shows the voices with a Play button, the client's own receptionist's voice marked and pushed to the bottom. "Choose for me" sends nothing and Signal picks. Signal refuses a voice that isn't on the account or that IS the receptionist's — the point is that the caller hears someone else. Unreachable Signal or no `SIGNAL_BASE_URL`: the picker is hidden and the automatic voice stands.
- **The note** gets one line: when they'll be rung back, or Signal's reason for not ringing, or that Signal couldn't be reached and the team should ring them.
- **The result** comes back as a `call.synced` that is outbound with `callBackOf` set. `acceptCall` sorts it like any call: the number check uses the line it rang from, and the contact is the number it rang. No answer, busy or voicemail (`call.endReason`) is decided by rule and leaves it where it is. A call-back never asks for another.

**Deliberate rules.**
- `settleVerdict` downgrades to Qualification Required when Lost lacks a reason or is low-confidence, or when Qualified doesn't match the services list.
- Hang-ups are decided by rule, not the model.
- `planOpportunity` only moves forward through the chosen stages. Any other stage belongs to the client's team, and a qualified opportunity is never marked Lost.
- Outbound calls are ignored, except Signal's call-backs (`callBackOf` set).

**Don't:**
- add a database, or store call or customer data;
- answer non-2xx for calls the app chooses to ignore (Signal retries for about 25h);
- save a suggested services list without the client pressing Save;
- let a settings action act on the location ID it's sent without `allowedClient`;
- decide in this app when, from which number or whether Signal rings a caller back: send the call ID, the reason and the chosen voice, nothing else;
- add a second place to choose the call-back voice (Signal's agent settings deliberately has none);
- ask for a call-back for an outbound call, including a call-back's own result;
- remove the `key` on the settings forms: a remount per client stops one client's typed settings being saved into another's;
- read env at import time;
- log tokens.

**Checks:** `npm run verify` (no network), `npm run try:qualifier`, `npm run typecheck`, `npm run lint`.

**Trying it by hand.** `npm run dev`, then `npm run send:test-call -- --location <sub-account>` posts a signed call to it and writes to that sub-account. For call-backs without a Signal to ring anyone: `npm run signal:fake` (stands in for Signal's endpoint, checks the signature, answers "scheduled"), then send `--scenario hang-up --call-back-url http://127.0.0.1:4599/api/call-backs`, and send the call-back's own result back with `--call-back-of <the call id it printed>` and `--end-reason voicemail_reached`.

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
**Help video.** The walkthrough lives in `public/walkthrough/` (`vantage-walkthrough.mp4` and `poster.jpg`).
- **Chapters:** start times and written steps are in `src/lib/walkthrough.ts`, measured from the video where each section label or caption changes.
- **Where it shows:**
  - `/help` is public and opens at a chapter with `?chapter=<id>`.
  - `HelpButton` (`src/components/help-button.tsx`) opens it in a dialog at the chapter for that part of the page. It's on the connect page, Add a client, each settings step, the call panel and the refused-token warning, plus a Help button in the band.
- **To replace the video:** re-encode the new export, then re-measure the chapter starts if the timeline changed:
  `ffmpeg -i "Vantage Lead Qualifier Walkthrough.mp4" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 96k public/walkthrough/vantage-walkthrough.mp4`
  `ffmpeg -ss 1 -i "Vantage Lead Qualifier Walkthrough.mp4" -frames:v 1 -q:v 3 public/walkthrough/poster.jpg`
- **Don't:** autoplay it anywhere. It plays only when someone asks.

**Pitch video.** A sales film for agencies, not help. It lives in `public/pitch/`: `vantage-agency-pitch.mp4` (47 s, narrated) and `poster.jpg`. It appears in two places, and its file path lives in `src/lib/pitch.ts`:
- **The front page** (`StoryFilm`, `src/components/pitch-film.tsx`): inline in the story panel on wide screens, and a button that opens it in a dialog on phones, so the connect form stays in reach. It uses `preload="none"`.
- **The public `/agencies` page,** which agency sign-in links to.
- **Sources:** built from `Agency Pitch Ad.mp4` plus `ad-narration- improved.mp3`, both git-ignored. The narration already lands on each scene change, so it only needs silence added to reach the picture's length:
  `ffmpeg -i "Agency Pitch Ad.mp4" -i "ad-narration- improved.mp3" -filter_complex "[1:a]apad[a]" -map 0:v:0 -map "[a]" -t 47 -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -c:a aac -b:a 96k -ac 1 -movflags +faststart public/pitch/vantage-agency-pitch.mp4`
- **Keep it out of help buttons and settings.** Someone who's stuck needs the walkthrough, not the pitch.
- **The page's points must stay true to what the app does today.** The film itself also promises follow-up texts, call-backs and booking.

- **The CRM is called Nexus Portal.** Clients use GoHighLevel under that white-label name.
  - Every word a person sees says Nexus Portal: page text, buttons, messages, contact notes, and errors that reach Signal.
  - Code, comments, API names and these docs keep saying GoHighLevel, the system underneath.
