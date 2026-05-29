import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { arrivals, arrivalItems, products } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const arrivalRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      status:   z.enum(["pending", "unloading", "completed"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(arrivals.tenantId, tenantId)];
      if (input?.status) conditions.push(eq(arrivals.status, input.status));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select().from(arrivals).where(where).limit(pageSize).offset(offset).orderBy(desc(arrivals.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(arrivals).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [arrival] = await db.select().from(arrivals)
        .where(and(eq(arrivals.id, input.id), eq(arrivals.tenantId, tenantId))).limit(1);
      if (!arrival) return null;

      const items = await db.select({
        id: arrivalItems.id, quantity: arrivalItems.quantity,
        condition: arrivalItems.condition, notes: arrivalItems.notes,
        productName: products.name, productCode: products.code,
      })
        .from(arrivalItems)
        .leftJoin(products, eq(arrivalItems.productId, products.id))
        .where(eq(arrivalItems.arrivalId, arrival.id));

      return { ...arrival, items };
    }),

  create: operatorQuery
    .input(z.object({
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      arrivalDate: z.string(),
      fuelCost:    z.string().default("0.00"),
      tollCost:    z.string().default("0.00"),
      otherCost:   z.string().default("0.00"),
      notes:       z.string().optional(),
      items:       z.array(z.object({ productId: z.number(), quantity: z.string(), condition: z.string().optional() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db           = getDb();
      const tenantId     = ctx.tenant.id;
      const arrivalNumber = `ARR-${Date.now()}`;
      const totalExpense  = (Number(input.fuelCost) + Number(input.tollCost) + Number(input.otherCost)).toFixed(2);

      const [result] = await db.insert(arrivals).values({
        tenantId, arrivalNumber,
        truckId:     input.truckId,
        driverName:  input.driverName,
        driverPhone: input.driverPhone,
        arrivalDate: new Date(input.arrivalDate),
        fuelCost:    input.fuelCost,
        tollCost:    input.tollCost,
        otherCost:   input.otherCost,
        totalExpense,
        notes:       input.notes,
        status:      "pending",
      });

      const arrivalId = Number(result.insertId);

      if (input.items) {
        for (const item of input.items) {
          await db.insert(arrivalItems).values({ arrivalId, productId: item.productId, quantity: item.quantity, condition: item.condition });
        }
      }

      return { id: arrivalId, arrivalNumber };
    }),

  update: operatorQuery
    .input(z.object({
      id:          z.number(),
      truckId:     z.string().optional(),
      driverName:  z.string().optional(),
      driverPhone: z.string().optional(),
      status:      z.enum(["pending", "unloading", "completed"]).optional(),
      fuelCost:    z.string().optional(),
      tollCost:    z.string().optional(),
      otherCost:   z.string().optional(),
      notes:       z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const { id, ...data } = input;

      if (data.fuelCost || data.tollCost || data.otherCost) {
        const [existing] = await db.select().from(arrivals)
          .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId))).limit(1);
        if (existing) {
          const fuel  = Number(data.fuelCost  ?? existing.fuelCost);
          const toll  = Number(data.tollCost  ?? existing.tollCost);
          const other = Number(data.otherCost ?? existing.otherCost);
          await db.update(arrivals).set({ ...data, totalExpense: (fuel + toll + other).toFixed(2) })
            .where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
          return { success: true };
        }
      }

      await db.update(arrivals).set(data).where(and(eq(arrivals.id, id), eq(arrivals.tenantId, tenantId)));
      return { success: true };
    }),
});
