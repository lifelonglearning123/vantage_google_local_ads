import { openaiModel, requireEnv } from "@/lib/env";

type ResponsesApiResult = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string; refusal?: string }>;
  }>;
};

/**
 * One OpenAI Responses call whose answer must be JSON matching `schema`
 * (strict structured output). Reasoning effort stays low: these are short
 * sorting jobs, not research.
 */
export async function askForJson<T>(request: {
  name: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
}): Promise<{ data: T; model: string }> {
  const model = openaiModel();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: request.instructions,
      input: request.input,
      // Reasoning models only; the others reject the parameter.
      ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: "low" } } : {}),
      text: {
        format: { type: "json_schema", name: request.name, strict: true, schema: request.schema },
      },
      store: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json().catch(() => null)) as ResponsesApiResult | null;
  if (!res.ok) {
    throw new Error(`OpenAI returned ${res.status}: ${data?.error?.message ?? "no details"}`);
  }
  if (data?.status === "incomplete") {
    throw new Error(
      `OpenAI stopped before answering (${data.incomplete_details?.reason ?? "incomplete"}).`,
    );
  }
  const content = (data?.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? []);
  const text = content.find((c) => c.type === "output_text")?.text;
  if (!text) {
    const refusal = content.find((c) => c.type === "refusal")?.refusal;
    throw new Error(refusal ? `OpenAI declined: ${refusal}` : "OpenAI returned no answer.");
  }
  return { data: JSON.parse(text) as T, model: data?.model ?? model };
}
