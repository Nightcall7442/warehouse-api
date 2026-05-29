import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { findTenantBySlug, listTenants } from "./queries/tenants";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";
import { createTrialSubscription } from "./lib/subscription";

const REGISTER_RATE_LIMIT = { windowMs: 60 * 60 * 1000, limit: 5, namespace: "register" };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const tenantRouter = createRouter({
  register: publicQuery
    .input(
      z.object({
        orgName:  z.string().min(2).max(100),
        name:     z.string().min(2).max(100),
        email:    z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Rate limit: 5 registrations per hour per IP
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(ip, REGISTER_RATE_LIMIT)) {
        throw new TRPCError({
          code:    "TOO_MANY_REQUESTS",
          message: "Too many registration attempts. Please try again later.",
        });
      }

      const db = getDb();

      // Generate unique slug (outside transaction — cheap reads)
      let slug    = slugify(input.orgName);
      const base  = slug;
      let attempt = 1;
      while (await findTenantBySlug(slug)) {
        slug = `${base}-${attempt++}`;
      }

      // Reject duplicate emails (outside transaction — cheap read)
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });
      }

      // Hash BEFORE transaction — slow step (~300ms), no reason to hold a lock
      const passwordHash = await hashPassword(input.password);

      // Atomic: all three inserts or none
      await db.transaction(async (tx) => {
        const [tenantResult] = await tx.insert(tenants).values({
          slug,
          name:   input.orgName,
          plan:   "trial",
          status: "active",
        });
        const tenantId = Number(tenantResult.insertId);

        await tx.insert(users).values({
          tenantId,
          name:         input.name,
          email:        input.email,
          passwordHash,
          role:         "ceo",
          status:       "active",
          lastSignInAt: new Date(),
        });

        await tx.insert(settings).values({
          tenantId,
          companyName: input.orgName,
        });
      });

      // Create trial subscription for new tenant
      const [newTenant] = await db.select({ id: tenants.id })
        .from(tenants).where(eq(tenants.slug, slug)).limit(1);
      if (newTenant?.id) await createTrialSubscription(newTenant.id).catch(() => {});

      return { slug, message: "Organisation created. You can now sign in." };
    }),

  inviteUser: adminQuery
    .input(
      z.object({
        name:     z.string().min(2).max(100),
        email:    z.string().email(),
        password: z.string().min(8),
        role:     z.enum(["operator", "agent", "supervisor", "merchandiser"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });
      }

      const passwordHash = await hashPassword(input.password);
      await db.insert(users).values({
        tenantId,
        name:         input.name,
        email:        input.email,
        passwordHash,
        role:         input.role,
        status:       "active",
        lastSignInAt: new Date(),
      });

      return { success: true };
    }),

  current: adminQuery.query(({ ctx }) => ({
    id:     ctx.tenant.id,
    slug:   ctx.tenant.slug,
    name:   ctx.tenant.name,
    plan:   ctx.tenant.plan,
    status: ctx.tenant.status,
  })),

  list: adminQuery.query(async () => listTenants()),

  /** Super-admin: update any tenant's plan */
  updatePlan: adminQuery
    .input(z.object({
      tenantId: z.number(),
      plan:     z.enum(["trial", "basic", "pro"]),
    }))
    .mutation(async ({ input }) => {
      const db          = getDb();
      const now         = new Date();
      const days        = input.plan === "pro" ? 365 : 30;
      const planExpires = new Date(now.getTime() + days * 86_400_000);

      await db.update(tenants)
        .set({ plan: input.plan, planExpiresAt: planExpires, updatedAt: now })
        .where(eq(tenants.id, input.tenantId));

      return { success: true };
    }),

  /** Super-admin: suspend or reactivate a tenant */
  setStatus: adminQuery
    .input(z.object({
      tenantId: z.number(),
      status:   z.enum(["active", "suspended"]),
    }))
    .mutation(async ({ input }) => {
      await getDb().update(tenants)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));
      return { success: true };
    }),
});
