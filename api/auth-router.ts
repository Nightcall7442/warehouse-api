import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken } from "./auth/session";
import { verifyPassword } from "./auth/password";
import { findUserByEmailAnyTenant, updateUserLastSignIn } from "./queries/users";
import { findTenantById } from "./queries/tenants";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 20, namespace: "login" };

export const authRouter = createRouter({
  me: authedQuery.query(({ ctx }) => ({
    ...ctx.user,
    tenant: {
      id:   ctx.tenant.id,
      slug: ctx.tenant.slug,
      name: ctx.tenant.name,
      plan: ctx.tenant.plan,
    },
  })),

  login: publicQuery
    .input(z.object({
      email:    z.string().email(),
      password: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      // Rate limit: 20 attempts per 15 minutes per IP
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(ip, LOGIN_RATE_LIMIT)) {
        throw new TRPCError({
          code:    "TOO_MANY_REQUESTS",
          message: "Too many login attempts. Please try again in 15 minutes.",
        });
      }

      const user = await findUserByEmailAnyTenant(input.email);

      // Always run verifyPassword even when user not found — prevents user enumeration
      // via timing difference between "user not found" (fast) and "wrong password" (slow).
      const dummyHash = "pbkdf2$100000$00000000000000000000000000000000$" + "0".repeat(128);
      const valid = user?.passwordHash
        ? await verifyPassword(input.password, user.passwordHash)
        : await verifyPassword(input.password, dummyHash).then(() => false);

      if (!user || !valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      }

      if (user.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Account is inactive." });
      }

      const tenant = await findTenantById(user.tenantId);
      if (!tenant || tenant.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Organisation is suspended." });
      }

      await updateUserLastSignIn(user.id);

      const token      = await signSessionToken({ userId: user.id });
      const cookieOpts = getSessionCookieOptions(ctx.req.headers);

      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: cookieOpts.httpOnly,
          path:     cookieOpts.path,
          sameSite: (cookieOpts.sameSite as string)?.toLowerCase() as "lax" | "none",
          secure:   cookieOpts.secure,
          maxAge:   Session.maxAgeMs / 1000,
        }),
      );

      return { success: true };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path:     opts.path,
        sameSite: (opts.sameSite as string)?.toLowerCase() as "lax" | "none",
        secure:   opts.secure,
        maxAge:   0,
      }),
    );
    return { success: true };
  }),
});
