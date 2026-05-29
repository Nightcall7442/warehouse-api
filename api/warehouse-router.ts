import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { warehouseStock, products, stockMovements } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";

export const warehouseRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      search:   z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const stockCond = [eq(warehouseStock.tenantId, tenantId)];
      if (input?.search) stockCond.push(like(products.name, `%${input.search}%`));
      const where = and(...stockCond);

      const [data, countResult, summary] = await Promise.all([
        db.select({
          id: warehouseStock.id, productId: warehouseStock.productId,
          currentStock: warehouseStock.currentStock, reserved: warehouseStock.reserved,
          available: warehouseStock.available, productName: products.name,
          productCode: products.code, category: products.category,
          unitPrice: products.unitPrice, reorderPoint: products.reorderPoint,
        })
          .from(warehouseStock)
          .leftJoin(products, eq(warehouseStock.productId, products.id))
          .where(where).limit(pageSize).offset(offset).orderBy(products.name),
        db.select({ count: sql<number>`count(*)` })
          .from(warehouseStock).leftJoin(products, eq(warehouseStock.productId, products.id)).where(where),
        db.select({
          totalSKUs:     sql<number>`count(*)`,
          totalWeight:   sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)`,
          lowStockCount: sql<number>`count(CASE WHEN ${warehouseStock.available} < ${products.reorderPoint} THEN 1 END)`,
        }).from(warehouseStock).leftJoin(products, eq(warehouseStock.productId, products.id)).where(eq(warehouseStock.tenantId, tenantId)),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize, summary: summary[0] };
    }),

  movements: operatorQuery
    .input(z.object({ productId: z.number() }))
    .query(async ({ input, ctx }) => {
      return getDb().select({
        id: stockMovements.id, type: stockMovements.type, quantity: stockMovements.quantity,
        referenceType: stockMovements.referenceType, referenceId: stockMovements.referenceId,
        notes: stockMovements.notes, createdAt: stockMovements.createdAt, productName: products.name,
      })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
        .where(and(eq(stockMovements.productId, input.productId), eq(stockMovements.tenantId, ctx.tenant.id)))
        .orderBy(desc(stockMovements.createdAt)).limit(50);
    }),

  adjustStock: operatorQuery
    .input(z.object({
      productId: z.number(),
      quantity:  z.string(),
      type:      z.enum(["in", "out", "adjustment"]),
      notes:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const qty      = Number(input.quantity);

      await db.insert(stockMovements).values({ tenantId, productId: input.productId, type: input.type, quantity: input.quantity, notes: input.notes });

      const stockWhere = and(eq(warehouseStock.productId, input.productId), eq(warehouseStock.tenantId, tenantId));
      if (input.type === "in") {
        await db.update(warehouseStock).set({ currentStock: sql`${warehouseStock.currentStock} + ${qty}`, available: sql`${warehouseStock.available} + ${qty}` }).where(stockWhere);
      } else if (input.type === "out") {
        await db.update(warehouseStock).set({ currentStock: sql`${warehouseStock.currentStock} - ${qty}`, available: sql`${warehouseStock.available} - ${qty}` }).where(stockWhere);
      }

      return { success: true };
    }),
});
