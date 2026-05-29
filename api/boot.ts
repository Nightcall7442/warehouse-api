import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { registerStripeWebhook } from "./webhooks/stripe";

const app = new Hono<{ Bindings: HttpBindings }>();

if (!env.isProduction) app.use(logger());

app.use(secureHeaders());

const allowedOrigins = env.isProduction
  ? env.allowedOrigins.length > 0 ? env.allowedOrigins : []
  : ["http://localhost:3000", "http://127.0.0.1:3000"];

app.use("/api/*", cors({
  origin:       (origin) => {
    if (!origin) return null;
    if (allowedOrigins.includes(origin)) return origin;
    return null;
  },
  allowMethods:  ["GET", "POST", "OPTIONS"],
  allowHeaders:  ["Content-Type", "Authorization"],
  credentials:   true,
  maxAge:        86400,
}));

// ── Stripe webhook (must be BEFORE bodyLimit — needs raw body) ───────────────
registerStripeWebhook(app);

// ── Cron: trial ending reminders ─────────────────────────────────────────────
app.get("/api/cron/trial-reminders", async (c) => {
  // Verify cron secret (set CRON_SECRET in env)
  const secret = c.req.query("secret") ?? c.req.header("x-cron-secret");
  if (env.cronSecret && secret !== env.cronSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // Lazy import to keep boot.ts lean
  const { runTrialReminders } = await import("./cron/trial-reminders");
  const result = await runTrialReminders();
  return c.json(result);
});

app.use(bodyLimit({ maxSize: 10 * 1024 * 1024 }));

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint:      "/api/trpc",
    req:           c.req.raw,
    router:        appRouter,
    createContext,
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[tRPC] Internal error on ${path}:`, error.cause ?? error.message);
      }
    },
    responseMeta: env.isProduction
      ? ({ errors }) => {
          const hasInternalError = errors.some(e => e.code === "INTERNAL_SERVER_ERROR");
          return hasInternalError ? { headers: { "cache-control": "no-store" } } : {};
        }
      : undefined,
  });
});

app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve }            = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
  const port = parseInt(process.env.PORT ?? "3000", 10);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[boot] Server running on http://localhost:${port}/`);
  });
}
