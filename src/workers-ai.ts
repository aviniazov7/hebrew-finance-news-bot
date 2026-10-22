/** Llama 3.3 70B instruct, the current Workers AI Llama flagship. Smaller Llama 3.2 models are multilingual but too small for reliable Hebrew. Catalog checked 2026-10-21. */
export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Default Workers AI max_tokens is 256, which truncates this JSON. */
export const WORKERS_AI_MAX_TOKENS = 2048;

/** Bound every model call so one hung request cannot outlive the cron. */
export const MODEL_CALL_TIMEOUT_MS = 18_000;

export interface WorkersAiRunOptions {
  signal?: AbortSignal;
}

export interface WorkersAiBinding {
  run(model: string, inputs: WorkersAiInput, options?: WorkersAiRunOptions): Promise<unknown>;
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
  timeoutMs?: number;
}): Promise<string> {
  const signal = AbortSignal.timeout(args.timeoutMs ?? MODEL_CALL_TIMEOUT_MS);
  const output = await withAbortSignal(
    args.ai.run(
      args.model,
      {
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        max_tokens: WORKERS_AI_MAX_TOKENS,
      },
      { signal },
    ),
    signal,
  );
  return workersResponseText(output);
}

async function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
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
