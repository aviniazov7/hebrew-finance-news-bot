import { parseConfig } from "./config.ts";
import { logError, logInfo } from "./log.ts";
import { runPipeline } from "./pipeline.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const config = parseConfig(env);
      return Response.json({
        ok: true,
        service: "hebrew-finance-news-bot",
        dryRun: config.dryRun,
        importanceThreshold: config.importanceThreshold,
        categories: config.categories.length,
        feeds: config.feeds.length,
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env): Promise<void> {
    logInfo({
      message: "cron_start",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    });
    try {
      const report = await runPipeline({
        config: parseConfig(env),
        kv: {
          get: (key) => env.NEWS_KV.get(key),
          put: (key, value) => env.NEWS_KV.put(key, value),
        },
      });
      logInfo({ message: "run_complete", ...report });
    } catch (error) {
      logError({
        message: "run_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
