import { z } from "zod";
import { createRouter, agentQuery, supervisorQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentLocations, dailyPlans, shops, users } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const agentRouter = createRouter({
  saveLocation: agentQuery
    .input(z.object({ lat: z.string(), lng: z.string(), accuracy: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().insert(agentLocations).values({
        tenantId: ctx.tenant.id,
        agentId:  ctx.user.id,
        lat:      input.lat,
        lng:      input.lng,
        accuracy: input.accuracy,
      });
      return { success: true };
    }),

  getLocations: supervisorQuery.query(async ({ ctx }) => {
    const results = await getDb().select({
      id: agentLocations.id, agentId: agentLocations.agentId,
      lat: agentLocations.lat, lng: agentLocations.lng,
      accuracy: agentLocations.accuracy, createdAt: agentLocations.createdAt,
      agentName: users.name,
    })
      .from(agentLocations)
      .leftJoin(users, eq(agentLocations.agentId, users.id))
      .where(eq(agentLocations.tenantId, ctx.tenant.id))
      .orderBy(desc(agentLocations.createdAt)).limit(100);

    const latestByAgent = new Map();
    for (const r of results) {
      if (!latestByAgent.has(r.agentId)) latestByAgent.set(r.agentId, r);
    }
    return Array.from(latestByAgent.values());
  }),

  getPlans: authedQuery
    .input(z.object({ agentId: z.number().optional(), date: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const agentId = input?.agentId ?? ctx.user.id;
      const dateStr = input?.date ?? new Date().toISOString().split("T")[0];

      return getDb().select({
        id: dailyPlans.id, planDate: dailyPlans.planDate, status: dailyPlans.status,
        notes: dailyPlans.notes, createdAt: dailyPlans.createdAt,
        shopName: shops.name, shopAddress: shops.address, shopDebt: shops.debt,
        shopCity: shops.city, agentName: users.name,
      })
        .from(dailyPlans)
        .leftJoin(shops, eq(dailyPlans.shopId, shops.id))
        .leftJoin(users, eq(dailyPlans.agentId, users.id))
        .where(and(eq(dailyPlans.tenantId, ctx.tenant.id), eq(dailyPlans.agentId, agentId), sql`DATE(${dailyPlans.planDate}) = ${dateStr}`));
    }),

  updatePlanStatus: agentQuery
    .input(z.object({ planId: z.number(), status: z.enum(["planned", "visited", "skipped"]) }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(dailyPlans).set({ status: input.status })
        .where(and(eq(dailyPlans.id, input.planId), eq(dailyPlans.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  createPlan: supervisorQuery
    .input(z.object({ agentId: z.number(), shopId: z.number(), planDate: z.string(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await getDb().insert(dailyPlans).values({
        tenantId:  ctx.tenant.id,
        agentId:   input.agentId,
        shopId:    input.shopId,
        planDate:  new Date(input.planDate),
        notes:     input.notes,
        createdBy: ctx.user.id,
      });
      return { id: Number(result.insertId) };
    }),

  myShops: agentQuery.query(async ({ ctx }) => {
    return getDb().select({
      id: shops.id, name: shops.name, ownerName: shops.ownerName,
      phone: shops.phone, address: shops.address, city: shops.city,
      debt: shops.debt, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng,
    })
      .from(shops)
      .where(and(eq(shops.agentId, ctx.user.id), eq(shops.tenantId, ctx.tenant.id)));
  }),

  nearbyShops: agentQuery
    .input(z.object({ lat: z.number(), lng: z.number(), radius: z.number().default(5) }))
    .query(async ({ input, ctx }) => {
      const agentShops = await getDb().select().from(shops)
        .where(and(eq(shops.agentId, ctx.user.id), eq(shops.tenantId, ctx.tenant.id)));
      return agentShops.filter((shop) => {
        if (!shop.gpsLat || !shop.gpsLng) return false;
        return Math.abs(Number(shop.gpsLat) - input.lat) < 0.1 && Math.abs(Number(shop.gpsLng) - input.lng) < 0.1;
      });
    }),
});

// Supervisor: list all agent plans (not just own)
