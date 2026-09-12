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
  "not-offered": {
    expect: "qualification_required",
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
};
