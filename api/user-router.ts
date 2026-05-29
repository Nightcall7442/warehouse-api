import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./auth/password";
import { TRPCError } from "@trpc/server";

export const userRouter = createRouter({
  list: adminQuery
    .input(z.object({
      page:     z.number().default(1),
      pageSize: z.number().default(25),
      search:   z.string().optional(),
      role:     z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const conditions = [eq(users.tenantId, tenantId)];
      if (input?.search) conditions.push(like(users.name, `%${input.search}%`));
      if (input?.role)   conditions.push(eq(users.role, input.role as any));
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone,
                    avatar: users.avatar, role: users.role, status: users.status,
                    createdAt: users.createdAt, lastSignInAt: users.lastSignInAt })
          .from(users).where(where).limit(pageSize).offset(offset).orderBy(desc(users.createdAt)),
        db.select({ count: sql<number>`count(*)` }).from(users).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    }),

  getById: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const [user] = await getDb().select({ id: users.id, name: users.name, email: users.email,
        phone: users.phone, role: users.role, status: users.status, createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt, avatar: users.avatar, tenantId: users.tenantId })
        .from(users).where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id))).limit(1);
      return user ?? null;
    }),

  me: authedQuery.query(({ ctx }) => ctx.user),

  // Update own profile (name, phone)
  updateMe: authedQuery
    .input(z.object({
      name:  z.string().min(2).max(100).optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(users).set(input).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),

  // Change own password
  changePassword: authedQuery
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8, "New password must be at least 8 characters"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [user] = await getDb().select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });

      const valid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });

      const newHash = await hashPassword(input.newPassword);
      await getDb().update(users).set({ passwordHash: newHash }).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),

  // Admin: update any user in same tenant
  update: adminQuery
    .input(z.object({
      id:     z.number(),
      name:   z.string().optional(),
      phone:  z.string().optional(),
      role:   z.enum(["ceo","operator","agent","supervisor","merchandiser"]).optional(),
      status: z.enum(["active","inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await getDb().update(users).set(data)
        .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // Admin: reset another user's password
  resetPassword: adminQuery
    .input(z.object({
      id:          z.number(),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      const newHash = await hashPassword(input.newPassword);
      await getDb().update(users).set({ passwordHash: newHash })
        .where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // Admin: deactivate user
  deactivate: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb().update(users).set({ status: "inactive" })
        .where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenant.id)));
      return { success: true };
    }),
});
