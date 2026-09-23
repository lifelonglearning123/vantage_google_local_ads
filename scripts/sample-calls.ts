import type { Outcome } from "@/lib/qualify/outcomes";

/** A made-up plumbing firm and the calls it gets, for try:qualifier and send:test-call. */
export const SAMPLE_BUSINESS = {
  name: "Hartley Plumbing & Heating",
  services: [
    "Boiler repairs",
    "Boiler servicing",
    "New boiler installation",
    "Leaking pipes and taps",
    "Blocked drains",
    "Bathroom fitting",
    "Emergency call-outs",
  ],
};

export type SampleCall = { expect: Outcome; summary: string | null; transcript: string };

const lines = (...said: string[]) => said.join("\n");
const GREETING = "Agent: Thanks for calling Hartley Plumbing and Heating, how can I help?";

export const SAMPLE_CALLS: Record<string, SampleCall> = {
  boiler: {
    expect: "qualified",
    summary: "Caller's boiler is leaking and the heating is off; wants an engineer today.",
    transcript: lines(
      GREETING,
      "User: Hi, yeah, my boiler's started leaking water from underneath and the heating's gone off.",
      "Agent: Sorry to hear that. Can I take your name and postcode?",
      "User: It's Dave Marsh, CB4 2QT. Is there any chance someone could come today?",
      "Agent: I'll pass that straight to the team and someone will call you back shortly.",
      "User: Brilliant, thanks.",
    ),
  },
  // Clear about the work, and it's work a plumber doesn't do: lost, "Not a job we do".
  "not-offered": {
    expect: "lost",
    summary: "Caller wants a quote to rewire their house and replace the fuse box.",
    transcript: lines(
      GREETING,
      "User: Hello, I'm after a quote to have my house rewired and a new fuse box put in.",
      "Agent: Let me take your details and someone will get back to you.",
      "User: Lovely, it's Priya, on this number.",
    ),
  },
  "job-seeker": {
    expect: "lost",
    summary: "Caller is a gas engineer asking whether the company is hiring.",
    transcript: lines(
      GREETING,
      "User: Hiya, I'm a Gas Safe engineer, just moved to the area. Are you taking anyone on at the moment?",
      "Agent: I'll pass your details on.",
      "User: Cheers, I can email my CV over.",
    ),
  },
  "seo-pitch": {
    expect: "lost",
    summary: "Caller from a marketing agency offering to improve Google rankings.",
    transcript: lines(
      GREETING,
      "User: Hi there, I'm calling from Rank Local. We help plumbers get to the top of Google Maps. Have you got two minutes to talk about your online presence?",
      "Agent: I can take a message.",
      "User: Just let the owner know we guarantee page one within ninety days.",
    ),
  },
  invoice: {
    expect: "lost",
    summary: "Supplier chasing an overdue invoice, asking for the accounts department.",
    transcript: lines(
      GREETING,
      "User: Hello, it's Sarah from City Plumbing Supplies. I'm chasing invoice 44871, it's thirty days overdue. Can I speak to your accounts department?",
      "Agent: I'll pass that on to the right person.",
      "User: Thank you.",
    ),
  },
  "wrong-number": {
    expect: "lost",
    summary: "Caller was trying to order from a takeaway.",
    transcript: lines(
      GREETING,
      "User: Oh, sorry, is this not the Golden Dragon? I wanted to order a takeaway.",
      "Agent: No, this is a plumbing company.",
      "User: Sorry, wrong number.",
    ),
  },
  // Might be part of a listed service (bathroom fitting), so a person looks.
  "loosely-related": {
    expect: "qualification_required",
    summary: "Caller wants the tiles in their bathroom redone.",
    transcript: lines(
      GREETING,
      "User: Hi, I'm looking to get the tiles in my bathroom redone, the grout's gone mouldy. Is that something you'd do?",
      "Agent: I'll take your details and someone will call you back.",
      "User: Great, it's Tom.",
    ),
  },
  vague: {
    expect: "qualification_required",
    summary: "Caller asked about work at their mum's house but didn't say what, and will call back.",
    transcript: lines(
      GREETING,
      "User: Oh hi, I was just wondering about getting some work done at my mum's house.",
      "Agent: Of course, what kind of work is it?",
      "User: Actually I need to check with her first, I'll ring back later.",
    ),
  },
  "hang-up": {
    expect: "qualification_required",
    summary: null,
    transcript: GREETING,
  },
  // Google says "Call from Google" before it puts an ad caller through; the transcript credits it to the caller.
  "google-hang-up": {
    expect: "qualification_required",
    summary:
      "The user called and identified the call as from Google. The agent introduced herself as Louise, a virtual assistant at Hartley Plumbing and Heating, and asked how she could help. The call ended shortly after without further interaction.",
    transcript: lines(
      "User: Call from Google.",
      "Agent: Hi, I'm Louise, a virtual assistant at Hartley Plumbing and Heating. Are you calling about a repair or a new installation?",
    ),
  },
  "google-boiler": {
    expect: "qualified",
    summary: "The call came from Google. The caller's boiler has stopped working and they want someone out this week.",
    transcript: lines(
      "User: Call from Google.",
      GREETING,
      "User: Hi, my boiler's stopped working, no heating or hot water. Can someone come out this week?",
      "Agent: I'm sorry to hear that. Can I take your name and postcode?",
      "User: Sarah Jones, CB1 3AA.",
    ),
  },
  "google-then-pitch": {
    expect: "lost",
    summary: "The call came from Google. The caller offered to improve the business's website ranking.",
    transcript: lines(
      "User: Call from Google.",
      GREETING,
      "User: Hi, I help local trades get more jobs from Google. Could I speak to the owner about your website?",
      "Agent: I can pass a message on. What's your name?",
      "User: It's Mark, I'll try again later.",
    ),
  },
  // Through the ad, but clear the work isn't theirs (the 2026-09-23 ceiling call, rung back for nothing).
  "google-not-offered": {
    expect: "lost",
    summary:
      "The user called seeking a ceiling patch repair following water damage. The agent explained the company does plumbing, heating and bathrooms and can't help with ceiling repairs.",
    transcript: lines(
      "User: Call from Google.",
      GREETING,
      "User: Hi, we had a leak upstairs, it's been fixed now, but it's left a hole in the ceiling. I need someone to patch and plaster the ceiling.",
      "Agent: I'm sorry, we're plumbing and heating engineers, we don't do plastering or ceiling repairs.",
      "User: Oh, okay. No worries, thanks.",
    ),
  },
  // A real Google sales call: the caller's own words, so it's judged like any pitch.
  "google-sales-call": {
    expect: "lost",
    summary: "The caller said they were calling from Google Ads about the business's advertising account and wanted to set up a review.",
    transcript: lines(
      GREETING,
      "User: Hi, I'm calling from Google Ads about your advertising account. We'd like to book a free review of your campaigns with the owner.",
      "Agent: I can pass a message on. Can I take your name?",
      "User: It's Priya from the Google Ads team. I'll email over some times.",
    ),
  },
};
