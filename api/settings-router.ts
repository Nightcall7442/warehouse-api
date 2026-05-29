import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";

export const settingsRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb().select().from(settings)
      .where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    return row ?? null;
  }),

  update: adminQuery
    .input(z.object({
      companyName:         z.string().min(1).max(255).optional(),
      currency:            z.string().max(10).optional(),
      currencySymbol:      z.string().max(10).optional(),
      symbolPosition:      z.enum(["before", "after"]).optional(),
      defaultReorderPoint: z.string().optional(),
      lowStockThreshold:   z.string().optional(),
      companyAddress:      z.string().optional(),
      companyInn:          z.string().optional(),
      companyDirector:     z.string().optional(),
      companyBank:         z.string().optional(),
      companyBankAccount:  z.string().optional(),
      companyMfo:          z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [existing] = await db.select().from(settings).where(eq(settings.tenantId, tenantId)).limit(1);

      if (existing) {
        await db.update(settings).set({ ...input, updatedAt: new Date() }).where(eq(settings.tenantId, tenantId));
      } else {
        await db.insert(settings).values({ tenantId, ...input });
      }
      return { success: true };
    }),
});
