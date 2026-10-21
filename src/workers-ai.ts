/** Llama 3.3 70B instruct, the current Workers AI Llama flagship. Smaller Llama 3.2 models are multilingual but too small for reliable Hebrew. Catalog checked 2026-10-21. */
export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Default Workers AI max_tokens is 256, which truncates this JSON. */
export const WORKERS_AI_MAX_TOKENS = 2048;

export interface WorkersAiBinding {
  run(model: string, inputs: WorkersAiInput): Promise<unknown>;
}

export interface WorkersAiInput {
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens: number;
}

export async function runWorkersAi(args: {
  ai: WorkersAiBinding;
  model: string;
  system: string;
  user: string;
}): Promise<string> {
  const output = await args.ai.run(args.model, {
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    max_tokens: WORKERS_AI_MAX_TOKENS,
  });
  return workersResponseText(output);
}

export function workersResponseText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (!output || typeof output !== "object") return "";
  const record = output as Record<string, unknown>;
  if (typeof record.response === "string") return record.response.trim();
  if (record.response && typeof record.response === "object") return JSON.stringify(record.response);
  if (typeof record.headline === "string") return JSON.stringify(output);
  return "";
}
