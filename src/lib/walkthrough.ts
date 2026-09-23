/**
 * The walkthrough video and its chapters, for the help page and the help
 * buttons that open it at whatever someone is stuck on.
 *
 * Chapter starts were measured from the video itself: the second its section
 * label or caption changes. A new export with a different timeline needs these
 * starts measured again; nothing else changes.
 */

export const WALKTHROUGH_VIDEO = {
  src: "/walkthrough/vantage-walkthrough.mp4",
  poster: "/walkthrough/poster.jpg",
  seconds: 114,
} as const;

export const CHAPTERS = [
  {
    id: "clients",
    start: 8,
    title: "Your client list",
    summary:
      "Every connected sub-account in one list. Live means calls are being sorted. Not live says what's still missing. Token refused means add the client again with a new token.",
  },
  {
    id: "add-client",
    start: 30,
    title: "Connecting a sub-account",
    summary:
      "It takes two things: the location ID and a Private Integration token made in that sub-account. Vantage checks the token with Nexus Portal, then opens the settings.",
  },
  {
    id: "signal-number",
    start: 50,
    title: "Step 1: the Signal number",
    summary: "The number customers ring. Only calls to it are sorted. Calls your team makes are left alone.",
  },
  {
    id: "pipeline",
    start: 58,
    title: "Step 2: pipeline and stages",
    summary:
      "Pick the pipeline, then the stage each kind of call goes to. Stages with matching names are chosen for you, so check them.",
  },
  {
    id: "services",
    start: 65,
    title: "Step 3: services",
    summary:
      "The work on offer. A caller asking for one of these is qualified. Suggest from website drafts the list for you to check.",
  },
  {
    id: "live",
    start: 72,
    title: "Saving and going live",
    summary: "Save, and the status turns Live. From then on every inbound call is sorted into the pipeline.",
  },
  {
    id: "calls",
    start: 77,
    title: "What happens on a call",
    summary:
      "The call lands in New Leads, then Vantage AI reads it. Wanting a listed service goes to Qualified. Job seekers, sales calls, spam, wrong numbers and clear requests for work you don't do go to Lost. Anything unclear, hang-ups included, goes to your call-back stage. Opportunities only ever move forward.",
  },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

export const isChapterId = (value: unknown): value is ChapterId => CHAPTERS.some((c) => c.id === value);

export const chapterById = (id: ChapterId) => CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];

export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
