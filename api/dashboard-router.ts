import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, warehouseStock, users, shops } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { subDays } from "date-fns";

export const dashboardRouter = createRouter({
  kpis: operatorQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;
    const today    = new Date().toISOString().split("T")[0];

    const [todaysOrders, todaysRevenue, activeAgents, totalStock] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`)),
      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`, eq(orders.status, "completed"))),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ total: sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)` }).from(warehouseStock)
        .where(eq(warehouseStock.tenantId, tenantId)),
    ]);

    return {
      todayOrders:  Number(todaysOrders[0]?.count ?? 0),
      todayRevenue: Number(todaysRevenue[0]?.total ?? 0),
      activeAgents: Number(activeAgents[0]?.count ?? 0),
      totalStock:   Number(totalStock[0]?.total ?? 0),
    };
  }),

  trends: operatorQuery
    .input(z.object({ range: z.enum(["7d", "30d", "month"]) }))
    .query(async ({ input, ctx }) => {
      const db        = getDb();
      const tenantId  = ctx.tenant.id;
      const days      = input.range === "7d" ? 7 : 30;
      const startDate = subDays(new Date(), days).toISOString().split("T")[0];

      return db.select({
        date:       sql<string>`DATE(${orders.createdAt})`,
        orderCount: sql<number>`count(*)`,
        revenue:    sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
      })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) >= ${startDate}`))
        .groupBy(sql`DATE(${orders.createdAt})`).orderBy(sql`DATE(${orders.createdAt})`);
    }),

  statusBreakdown: operatorQuery.query(async ({ ctx }) => {
    return getDb().select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders).where(eq(orders.tenantId, ctx.tenant.id)).groupBy(orders.status);
  }),

  activity: operatorQuery.query(async ({ ctx }) => {
    return getDb().select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, createdAt: orders.createdAt, shopName: shops.name, agentName: users.name,
    })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .where(eq(orders.tenantId, ctx.tenant.id))
      .orderBy(desc(orders.createdAt)).limit(10);
  }),

  agentDashboard: operatorQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;
    const userId   = ctx.user.id;
    const today    = new Date().toISOString().split("T")[0];

    const [agentOrders, assignedShops] = await Promise.all([
      db.select({ count: sql<number>`count(*)`, total: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
        .from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.agentId, userId), sql`DATE(${orders.createdAt}) = ${today}`)),
      db.select({ count: sql<number>`count(*)` }).from(shops)
        .where(and(eq(shops.tenantId, tenantId), eq(shops.agentId, userId))),
    ]);

    return {
      todayOrders:   Number(agentOrders[0]?.count ?? 0),
      todayRevenue:  Number(agentOrders[0]?.total ?? 0),
      assignedShops: Number(assignedShops[0]?.count ?? 0),
    };
  }),
});
