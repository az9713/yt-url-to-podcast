import { addUsage, type ModelUsage } from "./metrics.ts";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export function podcastModel(): string {
  return process.env.PODCAST_MODEL || process.env.PI_MODEL?.split("/").pop() || "gpt-4.1-mini";
}

interface ChatMessage {
  role: "system" | "user";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export async function openaiChat(options: {
  model: string;
  system: string;
  user: ChatMessage["content"];
  usage?: ModelUsage;
  signal?: AbortSignal;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set. The web app needs it to read the screenshot and write the episode.");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: options.signal,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status})`);
  if (options.usage) {
    addUsage(options.usage, {
      input: payload.usage?.prompt_tokens,
      output: payload.usage?.completion_tokens,
      cacheRead: payload.usage?.prompt_tokens_details?.cached_tokens,
      reasoning: payload.usage?.completion_tokens_details?.reasoning_tokens,
    });
  }
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}
