import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { env } from "./lib/env";
import { checkSubscriptionAccess } from "./lib/feature-gating";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => {
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    return {
      ...shape,
      message: isInternal && env.isProduction
        ? "An internal error occurred. Please try again."
        : shape.message,
      data: {
        ...shape.data,
        stack: env.isProduction ? undefined : shape.data.stack,
      },
    };
  },
});

export const createRouter = t.router;
export const publicQuery  = t.procedure;

// ── Require auth ──────────────────────────────────────────────────────────────
const requireAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.tenant) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
  }
  return next({ ctx: { ...ctx, user: ctx.user, tenant: ctx.tenant } });
});

// ── Role guard ────────────────────────────────────────────────────────────────
function requireRole(roles: string[]) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: ErrorMessages.insufficientRole });
    }
    return next({ ctx: { ...ctx, user: ctx.user, tenant: ctx.tenant! } });
  });
}

// ── Require active subscription ───────────────────────────────────────────────
export const requireActiveSubscription = t.middleware(async ({ ctx, next }) => {
  if (!ctx.tenant) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
  }
  const allowed = await checkSubscriptionAccess(ctx.tenant.id);
  if (!allowed) {
    throw new TRPCError({
      code:    "FORBIDDEN",
      message: "Subscription required. Please update your billing.",
    });
  }
  return next({ ctx });
});

export const authedQuery     = t.procedure.use(requireAuth);
export const adminQuery      = authedQuery.use(requireRole(["ceo"]));
export const operatorQuery   = authedQuery.use(requireRole(["ceo", "operator"]));
export const agentQuery      = authedQuery.use(requireRole(["ceo", "operator", "agent"]));
export const supervisorQuery = authedQuery.use(requireRole(["ceo", "supervisor"]));
export const merchQuery      = authedQuery.use(requireRole(["ceo", "supervisor", "merchandiser"]));

// Subscription-gated variants
export const billedQuery     = authedQuery.use(requireActiveSubscription);
export const billedAdmin     = adminQuery.use(requireActiveSubscription);
export const billedOperator  = operatorQuery.use(requireActiveSubscription);
export const billedAgent     = agentQuery.use(requireActiveSubscription);
