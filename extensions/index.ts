import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEpisode } from "../src/run.ts";
import { emptyUsage, addUsage } from "../src/metrics.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SYSTEM_PROMPT = [
  "You generate one podcast from one YouTube URL.",
  "Read skills/yt-podcast/SKILL.md and follow it.",
  "The procedure does not depend on a particular agent.",
].join(" ");

let running = false;

async function start(url: string, ctx: ExtensionContext): Promise<void> {
  if (running) {
    ctx.ui.notify("A podcast is already running.", "warning");
    return;
  }
  if (!ctx.model) {
    ctx.ui.notify("No model selected. Run /login, choose a model, then /podcast <youtube-url>.", "error");
    return;
  }
  running = true;
  ctx.ui.setStatus("podcast", "podcast");
  const log = (message: string) => {
    process.stderr.write(`podcast: ${message}\n`);
    ctx.ui.setStatus("podcast", message);
  };
  try {
    const model = ctx.model;
    const usage = emptyUsage();
    const result = await runEpisode({
      url,
      cwd: ctx.cwd,
      packageRoot,
      contextWindow: model.contextWindow,
      model: `${model.provider}/${model.id}`,
      usage,
      signal: ctx.signal,
      log,
      completeText: async (system, user) => {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error(auth.error);
        const message: UserMessage = {
          role: "user",
          content: [{ type: "text", text: user }],
          timestamp: Date.now(),
        };
        const response = await complete(
          model,
          { systemPrompt: system, messages: [message] },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            env: auth.env,
            maxTokens: Math.min(model.maxTokens || 8192, 8192),
            temperature: 0.4,
            signal: ctx.signal,
          },
        );
        addUsage(usage, response.usage);
        if (response.stopReason === "error") throw new Error(response.errorMessage || "Model request failed");
        if (response.stopReason === "aborted") throw new Error("Cancelled");
        const text = response.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();
        if (!text) throw new Error("The model returned an empty response.");
        return text;
      },
    });
    const lines = [`HTML summary: ${result.htmlPath}`];
    if (result.episodePath) lines.push(`Episode: ${result.episodePath}`);
    lines.push("Ledger: ledger.html");
    if (result.voiceError) lines.push(result.voiceError);
    const summary = lines.join("\n");
    process.stderr.write(`podcast: ${summary}\n`);
    ctx.ui.notify(summary, result.voiceError ? "warning" : "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`podcast: ${message}\n`);
    ctx.ui.notify(message, "error");
  } finally {
    running = false;
    ctx.ui.setStatus("podcast", undefined);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("podcast", {
    description: "YouTube URL. Writes an HTML summary and a single-host episode, then continues.",
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    pi.setActiveTools(["read", "bash"]);
    const url = pi.getFlag("podcast");
    if (typeof url === "string" && url.trim()) {
      await start(url, ctx);
      if (ctx.mode === "print" || ctx.mode === "json") ctx.shutdown();
    }
  });

  pi.on("before_agent_start", () => ({ systemPrompt: SYSTEM_PROMPT }));

  pi.registerCommand("podcast", {
    description: "Turn a YouTube URL into an HTML summary and a single-host episode",
    handler: async (args, ctx) => {
      await start(args, ctx);
    },
  });
}
