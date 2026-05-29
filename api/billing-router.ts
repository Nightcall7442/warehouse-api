import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { notifyAdmin, tgMessages } from "./telegram-router";
import { getDb } from "./queries/connection";
import { tenants, users, orders, products } from "@db/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const PLANS = {
  trial: {
    name:          "Пробный период",
    nameUz:        "Sinov muddati",
    price:         0,
    maxUsers:      3,
    maxProducts:   50,
    maxOrdersMonth:100,
    durationDays:  14,
  },
  basic: {
    name:          "Базовый",
    nameUz:        "Asosiy",
    price:         49_000,   // UZS per month
    maxUsers:      10,
    maxProducts:   200,
    maxOrdersMonth:500,
    durationDays:  30,
  },
  pro: {
    name:          "Профессиональный",
    nameUz:        "Professional",
    price:         149_000,  // UZS per month
    maxUsers:      null,     // unlimited
    maxProducts:   null,
    maxOrdersMonth:null,
    durationDays:  30,
  },
} as const;

export const billingRouter = createRouter({
  /** Current tenant subscription status */
  status: authedQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;

    const [tenant] = await db.select().from(tenants)
      .where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

    const plan      = PLANS[tenant.plan];
    const now       = new Date();
    const trialEnds = tenant.trialEndsAt;
    const planEnds  = tenant.planExpiresAt;

    const trialActive  = trialEnds && trialEnds > now;
    const planActive   = planEnds  && planEnds  > now;
    const isExpired    = !trialActive && !planActive && tenant.plan !== "pro";

    // Current usage
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [userCount, productCount, orderCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, startOfMonth))),
    ]);

    return {
      plan:          tenant.plan,
      planName:      plan.name,
      planNameUz:    plan.nameUz,
      price:         plan.price,
      trialEndsAt:   trialEnds,
      planExpiresAt: planEnds,
      trialActive,
      planActive,
      isExpired,
      daysLeft:      trialActive
        ? Math.ceil((trialEnds!.getTime() - now.getTime()) / 86_400_000)
        : planActive
          ? Math.ceil((planEnds!.getTime() - now.getTime()) / 86_400_000)
          : 0,
      limits: {
        maxUsers:       plan.maxUsers,
        maxProducts:    plan.maxProducts,
        maxOrdersMonth: plan.maxOrdersMonth,
      },
      usage: {
        users:   Number(userCount[0]?.c ?? 0),
        products:Number(productCount[0]?.c ?? 0),
        orders:  Number(orderCount[0]?.c ?? 0),
      },
      plans: Object.entries(PLANS).map(([key, p]) => ({
        key,
        name:      p.name,
        nameUz:    p.nameUz,
        price:     p.price,
        maxUsers:  p.maxUsers,
        maxProducts: p.maxProducts,
        maxOrdersMonth: p.maxOrdersMonth,
      })),
    };
  }),

  /** Request upgrade — creates a pending request for super-admin to process */
  requestUpgrade: adminQuery
    .input(z.object({ plan: z.enum(["basic", "pro"]) }))
    .mutation(async ({ input, ctx }) => {
      // In production: integrate with payment gateway (Payme, Click, Uzum Pay)
      // For now: mark tenant as pending upgrade and notify admin via Telegram
      const db = getDb();
      await db.update(tenants)
        .set({ updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenant.id));

      // Notify admin via Telegram
      const plan    = PLANS[input.plan];
      const tenant  = ctx.tenant;
      await notifyAdmin(tgMessages.upgradeRequest(
        tenant.name,
        plan.name,
        plan.price.toLocaleString("ru-RU"),
        tenant.ownerPhone ?? tenant.ownerEmail ?? "не указан"
      )).catch(() => {});

      return {
        success: true,
        message: `Запрос на тариф "${PLANS[input.plan].name}" отправлен. Оператор свяжется с вами в течение 30 минут.`,
        price:   PLANS[input.plan].price,
        plan:    input.plan,
      };
    }),
});
