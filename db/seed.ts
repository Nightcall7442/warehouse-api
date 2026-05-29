import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../api/auth/password";

async function seed() {
  const db = getDb();
  console.log("Seeding multi-tenant Warehouse Pro database...\n");

  // ── Tenant 1: Acme Warehouse ──────────────────────────────────────────────
  const trialEnd = new Date(Date.now() + 14 * 86_400_000); // 14 days from now
  const proEnd   = new Date(Date.now() + 365 * 86_400_000);

  const [t1Result] = await db.insert(schema.tenants).values({
    slug: "acme-warehouse", name: "Acme Warehouse Co.",
    plan: "pro", status: "active",
    planExpiresAt: proEnd,
  });
  const tenant1Id = Number(t1Result.insertId);
  await db.insert(schema.settings).values({ tenantId: tenant1Id, companyName: "Acme Warehouse Co.", currency: "CNY", currencySymbol: "¥" });

  // ── Tenant 2: Beta Logistics ──────────────────────────────────────────────
  const [t2Result] = await db.insert(schema.tenants).values({
    slug: "beta-logistics", name: "Beta Logistics Ltd.",
    plan: "trial", status: "active",
    trialEndsAt: trialEnd,
  });
  const tenant2Id = Number(t2Result.insertId);
  await db.insert(schema.settings).values({ tenantId: tenant2Id, companyName: "Beta Logistics Ltd.", currency: "USD", currencySymbol: "$" });

  console.log("✓ Tenants created");

  const defaultPassword = await hashPassword("password123");

  // ── Users: Tenant 1 ───────────────────────────────────────────────────────
  const t1Users = [
    { name: "Wang Wei",   email: "ceo@acme.warehouse",        role: "ceo"          as const },
    { name: "Li Na",      email: "operator@acme.warehouse",   role: "operator"     as const },
    { name: "Zhang Ming", email: "agent1@acme.warehouse",     role: "agent"        as const },
    { name: "Chen Hao",   email: "agent2@acme.warehouse",     role: "agent"        as const },
    { name: "Zhao Li",    email: "supervisor@acme.warehouse", role: "supervisor"   as const },
    { name: "Sun Mei",    email: "merch@acme.warehouse",      role: "merchandiser" as const },
  ];
  for (const u of t1Users) {
    await db.insert(schema.users).values({ tenantId: tenant1Id, ...u, passwordHash: defaultPassword, status: "active", lastSignInAt: new Date() });
  }

  // ── Users: Tenant 2 ───────────────────────────────────────────────────────
  const t2Users = [
    { name: "Alice Chen",  email: "ceo@beta.logistics",      role: "ceo"      as const },
    { name: "Bob Turner",  email: "agent@beta.logistics",    role: "agent"    as const },
  ];
  for (const u of t2Users) {
    await db.insert(schema.users).values({ tenantId: tenant2Id, ...u, passwordHash: defaultPassword, status: "active", lastSignInAt: new Date() });
  }
  console.log("✓ Users created");

  // ── Products: Tenant 1 ────────────────────────────────────────────────────
  const t1Products = [
    { code: "TOM-001", name: "Fresh Tomatoes",  category: "Vegetables", unitPrice: "4.50", reorderPoint: "50.00" },
    { code: "CUC-001", name: "Cucumbers",        category: "Vegetables", unitPrice: "3.20", reorderPoint: "40.00" },
    { code: "POT-001", name: "Potatoes",          category: "Vegetables", unitPrice: "2.80", reorderPoint: "100.00" },
    { code: "ONI-001", name: "Yellow Onions",    category: "Vegetables", unitPrice: "3.50", reorderPoint: "60.00" },
    { code: "APL-001", name: "Red Apples",        category: "Fruits",     unitPrice: "6.80", reorderPoint: "30.00" },
    { code: "BAN-001", name: "Bananas",           category: "Fruits",     unitPrice: "5.00", reorderPoint: "40.00" },
  ];
  for (const p of t1Products) {
    const [r] = await db.insert(schema.products).values({ tenantId: tenant1Id, ...p, status: "active" });
    await db.insert(schema.warehouseStock).values({
      tenantId:     tenant1Id,
      productId:    Number(r.insertId),
      currentStock: String(Math.floor(Math.random() * 200) + 50),
      reserved:     "10.00",
      available:    String(Math.floor(Math.random() * 180) + 40),
    });
  }

  // ── Products: Tenant 2 (completely different catalogue) ───────────────────
  const t2Products = [
    { code: "BOX-S", name: "Small Cardboard Box", category: "Packaging", unitPrice: "1.20", reorderPoint: "100.00" },
    { code: "BOX-L", name: "Large Cardboard Box", category: "Packaging", unitPrice: "2.80", reorderPoint: "80.00" },
    { code: "PAL-W", name: "Wooden Pallet",        category: "Equipment", unitPrice: "15.00", reorderPoint: "20.00" },
  ];
  for (const p of t2Products) {
    const [r] = await db.insert(schema.products).values({ tenantId: tenant2Id, ...p, status: "active" });
    await db.insert(schema.warehouseStock).values({
      tenantId:  tenant2Id,
      productId: Number(r.insertId),
      currentStock: String(Math.floor(Math.random() * 500) + 100),
      reserved: "5.00",
      available: String(Math.floor(Math.random() * 490) + 95),
    });
  }
  console.log("✓ Products & stock created");

  // ── Shops: Tenant 1 ───────────────────────────────────────────────────────
  const allT1Users = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenant1Id));
  const t1Agents   = allT1Users.filter(u => u.role === "agent");

  const t1Shops = [
    { name: "Green Market",      ownerName: "Huang Da",  phone: "138001", city: "Beijing",  agentId: t1Agents[0]?.id, debt: "0.00" },
    { name: "Fresh Veggie",      ownerName: "Wu Er",     phone: "138002", city: "Beijing",  agentId: t1Agents[0]?.id, debt: "1250.00" },
    { name: "Daily Produce",     ownerName: "Zheng San", phone: "138003", city: "Shanghai", agentId: t1Agents[1]?.id, debt: "0.00" },
    { name: "Organic Select",    ownerName: "Qian Si",   phone: "138004", city: "Shanghai", agentId: t1Agents[1]?.id, debt: "3400.50" },
  ];
  for (const s of t1Shops) {
    await db.insert(schema.shops).values({ tenantId: tenant1Id, ...s, status: "active" });
  }

  // ── Shops: Tenant 2 ───────────────────────────────────────────────────────
  const allT2Users = await db.select().from(schema.users).where(eq(schema.users.tenantId, tenant2Id));
  const t2Agent    = allT2Users.find(u => u.role === "agent");

  await db.insert(schema.shops).values({
    tenantId: tenant2Id, name: "City Depot", ownerName: "Carl Black",
    phone: "555-0100", city: "New York", agentId: t2Agent?.id, debt: "0.00", status: "active",
  });
  console.log("✓ Shops created");

  // ── Sample orders: Tenant 1 ───────────────────────────────────────────────
  const t1ShopsDb   = await db.select().from(schema.shops).where(eq(schema.shops.tenantId, tenant1Id));
  const t1ProductsDb = await db.select().from(schema.products).where(eq(schema.products.tenantId, tenant1Id));
  const statuses    = ["new", "processing", "completed", "cancelled"] as const;

  for (let i = 0; i < 20; i++) {
    const shop    = t1ShopsDb[i % t1ShopsDb.length];
    const agent   = t1Agents[i % t1Agents.length];
    const product = t1ProductsDb[i % t1ProductsDb.length];
    const qty     = Math.floor(Math.random() * 50) + 5;
    const total   = (Number(product.unitPrice) * qty).toFixed(2);

    const [orderResult] = await db.insert(schema.orders).values({
      tenantId:    tenant1Id,
      orderNumber: `ORD-${String(1000 + i).padStart(5, "0")}`,
      shopId:      shop.id,
      agentId:     agent.id!,
      status:      statuses[i % 4],
      subtotal:    total,
      discount:    "0.00",
      total,
    });
    await db.insert(schema.orderItems).values({
      orderId:   Number(orderResult.insertId),
      productId: product.id,
      quantity:  String(qty),
      unitPrice: product.unitPrice,
      subtotal:  total,
    });
  }
  console.log("✓ Orders created");

  console.log(`
╔══════════════════════════════════════════════════════════╗
║          DATABASE SEEDED SUCCESSFULLY                    ║
╠══════════════════════════════════════════════════════════╣
║  All passwords: password123                              ║
║                                                          ║
║  TENANT 1: Acme Warehouse Co.                            ║
║    ceo@acme.warehouse         → CEO                      ║
║    operator@acme.warehouse    → Operator                 ║
║    agent1@acme.warehouse      → Agent                    ║
║    agent2@acme.warehouse      → Agent                    ║
║    supervisor@acme.warehouse  → Supervisor               ║
║    merch@acme.warehouse       → Merchandiser             ║
║                                                          ║
║  TENANT 2: Beta Logistics Ltd.                           ║
║    ceo@beta.logistics         → CEO                      ║
║    agent@beta.logistics       → Agent                    ║
╚══════════════════════════════════════════════════════════╝
`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
