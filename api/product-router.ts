import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { products, warehouseStock, stockMovements } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";

export const productRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      search:   z.string().optional(),
      category: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(products.tenantId, tenantId)];
      if (input?.search)   conditions.push(like(products.name, `%${input.search}%`));
      if (input?.category) conditions.push(eq(products.category, input.category));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({
          id:           products.id,
          code:         products.code,
          name:         products.name,
          category:     products.category,
          unitPrice:    products.unitPrice,
          description:  products.description,
          imageUrl:     products.imageUrl,
          reorderPoint: products.reorderPoint,
          status:       products.status,
          createdAt:    products.createdAt,
          currentStock: warehouseStock.currentStock,
          available:    warehouseStock.available,
        })
          .from(products)
          .leftJoin(warehouseStock, and(eq(products.id, warehouseStock.productId), eq(warehouseStock.tenantId, tenantId)))
          .where(where)
          .limit(pageSize)
          .offset(offset)
          .orderBy(products.name),
        db.select({ count: sql<number>`count(*)` }).from(products).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: operatorQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [product] = await db.select().from(products)
        .where(and(eq(products.id, input.id), eq(products.tenantId, tenantId)))
        .limit(1);
      if (!product) return null;

      const [stock]  = await db.select().from(warehouseStock)
        .where(and(eq(warehouseStock.productId, product.id), eq(warehouseStock.tenantId, tenantId)))
        .limit(1);
      const movements = await db.select().from(stockMovements)
        .where(and(eq(stockMovements.productId, product.id), eq(stockMovements.tenantId, tenantId)))
        .orderBy(desc(stockMovements.createdAt))
        .limit(20);

      return { ...product, stock: stock ?? null, movements };
    }),

  create: operatorQuery
    .input(z.object({
      code:         z.string().min(1),
      name:         z.string().min(1),
      category:     z.string().optional(),
      unitPrice:    z.string(),
      description:  z.string().optional(),
      reorderPoint: z.string().default("10.00"),
      imageUrl:     z.string().optional().nullable(), // ✅ ДОБАВЛЕНО
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const [result] = await db.insert(products).values({ tenantId, ...input, status: "active" });
      const productId = Number(result.insertId);

      await db.insert(warehouseStock).values({ tenantId, productId, currentStock: "0.00", reserved: "0.00", available: "0.00" });
      return { id: productId };
    }),

  update: operatorQuery
    .input(z.object({
      id:           z.number(),
      code:         z.string().min(1).optional(),
      name:         z.string().min(1).optional(),
      category:     z.string().optional(),
      unitPrice:    z.string().optional(),
      description:  z.string().optional(),
      reorderPoint: z.string().optional(),
      status:       z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await getDb().update(products).set(data)
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  delete: operatorQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().delete(products)
        .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  categories: operatorQuery.query(async ({ ctx }) => {
    const results = await getDb().select({ category: products.category })
      .from(products).where(eq(products.tenantId, ctx.tenant.id)).groupBy(products.category);
    return results.map(r => r.category).filter(Boolean);
  }),
});
