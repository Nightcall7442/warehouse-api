import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertTenant } from "@db/schema";
import { getDb } from "./connection";

export async function findTenantById(id: number) {
  const rows = await getDb()
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function findTenantBySlug(slug: string) {
  const rows = await getDb()
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function createTenant(data: InsertTenant) {
  const [result] = await getDb().insert(schema.tenants).values(data);
  return findTenantById(Number(result.insertId));
}

export async function listTenants() {
  return getDb().select().from(schema.tenants).orderBy(schema.tenants.createdAt);
}
