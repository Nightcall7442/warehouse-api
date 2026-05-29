import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { shops, users, orders, payments } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";

export const shopRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      search:   z.string().optional(),
      city:     z.string().optional(),
      agentId:  z.number().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(shops.tenantId, tenantId)];
      if (input?.search)  conditions.push(like(shops.name, `%${input.search}%`));
      if (input?.city)    conditions.push(eq(shops.city, input.city));
      if (input?.agentId) conditions.push(eq(shops.agentId, input.agentId));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({
          id:        shops.id,
          name:      shops.name,
          ownerName: shops.ownerName,
          phone:     shops.phone,
          city:      shops.city,
          district:  shops.district,
          gpsLat:    shops.gpsLat,
          gpsLng:    shops.gpsLng,
          debt:      shops.debt,
          status:    shops.status,
          createdAt: shops.createdAt,
          agentName: users.name,
        })
          .from(shops)
          .leftJoin(users, eq(shops.agentId, users.id))
          .where(where)
          .limit(pageSize)
          .offset(offset)
          .orderBy(desc(shops.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(shops).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [shop]   = await db.select().from(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, tenantId)))
        .limit(1);
      if (!shop) return null;

      const [agent]       = await db.select().from(users).where(eq(users.id, shop.agentId ?? 0)).limit(1);
      const recentOrders  = await db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, status: orders.status, createdAt: orders.createdAt })
        .from(orders).where(and(eq(orders.shopId, shop.id), eq(orders.tenantId, tenantId))).orderBy(desc(orders.createdAt)).limit(20);
      const paymentHistory = await db.select().from(payments)
        .where(and(eq(payments.shopId, shop.id), eq(payments.tenantId, tenantId))).orderBy(desc(payments.createdAt)).limit(20);

      return { ...shop, agent: agent ?? null, recentOrders, paymentHistory };
    }),

  create: operatorQuery
    .input(z.object({
      name:     z.string().min(1),
      ownerName: z.string().optional(),
      phone:    z.string().optional(),
      address:  z.string().optional(),
      city:     z.string().optional(),
      district: z.string().optional(),
      gpsLat:   z.string().optional(),
      gpsLng:   z.string().optional(),
      agentId:  z.number().optional(),
      notes:    z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(shops).values({ ...input, tenantId: ctx.tenant.id, debt: "0.00", status: "active" });
      return { id: Number(result.insertId) };
    }),

  update: operatorQuery
    .input(z.object({
      id:       z.number(),
      name:     z.string().min(1).optional(),
      ownerName: z.string().optional(),
      phone:    z.string().optional(),
      address:  z.string().optional(),
      city:     z.string().optional(),
      district: z.string().optional(),
      gpsLat:   z.string().optional(),
      gpsLng:   z.string().optional(),
      agentId:  z.number().optional(),
      notes:    z.string().optional(),
      status:   z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await getDb().update(shops).set(data)
        .where(and(eq(shops.id, id), eq(shops.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().delete(shops)
        .where(and(eq(shops.id, input.id), eq(shops.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  addPayment: operatorQuery
    .input(z.object({
      shopId: z.number(),
      amount: z.string(),
      type:   z.enum(["payment", "debt"]).default("payment"),
      notes:  z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const { shopId, amount, type, notes } = input;

      await db.insert(payments).values({ tenantId, shopId, amount, type, notes, createdBy: ctx.user.id });

      const amt = Number(amount);
      if (type === "payment") {
        await db.update(shops).set({ debt: sql`${shops.debt} - ${amt}` })
          .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
      } else {
        await db.update(shops).set({ debt: sql`${shops.debt} + ${amt}` })
          .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
      }
      return { success: true };
    }),

  cities: operatorQuery.query(async ({ ctx }) => {
    const results = await getDb().select({ city: shops.city })
      .from(shops).where(eq(shops.tenantId, ctx.tenant.id)).groupBy(shops.city);
    return results.map(r => r.city).filter(Boolean);
  }),
});
