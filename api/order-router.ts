import { z } from "zod";
import { notifyAdmin, tgMessages } from "./telegram-router";
import { createRouter, operatorQuery, agentQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, orderItems, products, shops, users, warehouseStock } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const orderRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      search:   z.string().optional(),
      status:   z.enum(["new", "processing", "completed", "cancelled"]).optional(),
      agentId:  z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo:   z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(orders.tenantId, tenantId)];
      if (input?.status)  conditions.push(eq(orders.status, input.status));
      if (input?.agentId) conditions.push(eq(orders.agentId, input.agentId));
      if (input?.search)  conditions.push(sql`${orders.orderNumber} LIKE ${`%${input.search}%`}`);
      if (input?.dateFrom) conditions.push(sql`${orders.createdAt} >= ${input.dateFrom}`);
      if (input?.dateTo)   conditions.push(sql`${orders.createdAt} <= ${input.dateTo}`);
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, subtotal: orders.subtotal, discount: orders.discount, total: orders.total, notes: orders.notes, createdAt: orders.createdAt, shopName: shops.name, agentName: users.name })
          .from(orders)
          .leftJoin(shops, eq(orders.shopId, shops.id))
          .leftJoin(users, eq(orders.agentId, users.id))
          .where(where).limit(pageSize).offset(offset).orderBy(desc(orders.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [order]  = await db.select().from(orders)
        .where(and(eq(orders.id, input.id), eq(orders.tenantId, tenantId))).limit(1);
      if (!order) return null;

      const [shop]  = await db.select().from(shops).where(eq(shops.id, order.shopId)).limit(1);
      const [agent] = await db.select().from(users).where(eq(users.id, order.agentId)).limit(1);
      const items   = await db.select({ id: orderItems.id, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal, productName: products.name, productCode: products.code })
        .from(orderItems).leftJoin(products, eq(orderItems.productId, products.id)).where(eq(orderItems.orderId, order.id));

      return { ...order, shop, agent, items };
    }),

  create: agentQuery
    .input(z.object({
      shopId:   z.number(),
      agentId:  z.number(),
      items:    z.array(z.object({ productId: z.number(), quantity: z.string(), unitPrice: z.string() })).min(1),
      notes:    z.string().optional(),
      discount: z.string().default("0.00"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;

      let subtotal = 0;
      for (const item of input.items) subtotal += Number(item.unitPrice) * Number(item.quantity);

      const orderNumber  = `ORD-${Date.now()}`;
      const [orderResult] = await db.insert(orders).values({
        tenantId, orderNumber,
        shopId:  input.shopId,
        agentId: input.agentId,
        status:  "new",
        subtotal: String(subtotal.toFixed(2)),
        discount: input.discount ?? "0.00",
        total:    String((subtotal - Number(input.discount ?? 0)).toFixed(2)),
        notes:    input.notes,
      });

      const orderId = Number(orderResult.insertId);

      for (const item of input.items) {
        const itemSubtotal = Number(item.unitPrice) * Number(item.quantity);
        await db.insert(orderItems).values({ orderId, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, subtotal: String(itemSubtotal.toFixed(2)) });
        await db.update(warehouseStock)
          .set({ reserved: sql`${warehouseStock.reserved} + ${Number(item.quantity)}`, available: sql`${warehouseStock.available} - ${Number(item.quantity)}` })
          .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId)));
      }

      // Notify admin via Telegram
      const shop = await db.select().from(shops).where(eq(shops.id, input.shopId)).limit(1);
      await notifyAdmin(tgMessages.newOrder(
        orderNumber,
        shop[0]?.name ?? "Unknown",
        total.toFixed(0),
        "сум"
      )).catch(() => {}); // non-blocking

      return { id: orderId, orderNumber };
    }),

  updateStatus: operatorQuery
    .input(z.object({ id: z.number(), status: z.enum(["new", "processing", "completed", "cancelled"]) }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;

      await db.update(orders).set({ status: input.status })
        .where(and(eq(orders.id, input.id), eq(orders.tenantId, tenantId)));

      if (input.status === "completed" || input.status === "cancelled") {
        const items = await db.select().from(orderItems).where(eq(orderItems.orderId, input.id));
        for (const item of items) {
          if (input.status === "completed") {
            await db.update(warehouseStock)
              .set({ currentStock: sql`${warehouseStock.currentStock} - ${Number(item.quantity)}`, reserved: sql`${warehouseStock.reserved} - ${Number(item.quantity)}` })
              .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId)));
          } else {
            await db.update(warehouseStock)
              .set({ reserved: sql`${warehouseStock.reserved} - ${Number(item.quantity)}`, available: sql`${warehouseStock.available} + ${Number(item.quantity)}` })
              .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId)));
          }
        }
      }

      return { success: true };
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().delete(orderItems).where(eq(orderItems.orderId, input.id));
      await getDb().delete(orders).where(and(eq(orders.id, input.id), eq(orders.tenantId, ctx.tenant.id)));
      return { success: true };
    }),
});
