import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifications } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const notificationRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getDb().select().from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.tenantId, ctx.tenant.id)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }),

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const result = await getDb().select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.tenantId, ctx.tenant.id), eq(notifications.isRead, false)));
    return { count: Number(result[0]?.count ?? 0) };
  }),

  markRead: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(notifications).set({ isRead: true })
        .where(and(eq(notifications.id, input.id), eq(notifications.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  markAllRead: authedQuery.mutation(async ({ ctx }) => {
    await getDb().update(notifications).set({ isRead: true })
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.tenantId, ctx.tenant.id)));
    return { success: true };
  }),
});
