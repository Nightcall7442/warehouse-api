import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, orderItems, products, shops, users } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const analyticsRouter = createRouter({
  salesByShop: operatorQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id), eq(orders.status, "completed")];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        shopName:   shops.name,
        revenue:    sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        orderCount: sql<number>`count(*)`,
      })
        .from(orders).leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions)).groupBy(shops.id).orderBy(desc(sql`SUM(${orders.total})`)).limit(20);
    }),

  topProducts: operatorQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id), eq(orders.status, "completed")];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        productName:  products.name,
        productCode:  products.code,
        totalQty:     sql<string>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        totalRevenue: sql<string>`COALESCE(SUM(${orderItems.subtotal}), 0)`,
      })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...conditions)).groupBy(products.id).orderBy(desc(sql`SUM(${orderItems.quantity})`)).limit(10);
    }),

  agentPerformance: operatorQuery
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const conditions = [eq(orders.tenantId, ctx.tenant.id)];
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);

      return getDb().select({
        agentName:     users.name,
        agentId:       users.id,
        orderCount:    sql<number>`count(*)`,
        totalRevenue:  sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        avgOrderValue: sql<string>`COALESCE(AVG(${orders.total}), 0)`,
      })
        .from(orders).leftJoin(users, eq(orders.agentId, users.id))
        .where(and(...conditions)).groupBy(users.id).orderBy(desc(sql`SUM(${orders.total})`));
    }),
});
