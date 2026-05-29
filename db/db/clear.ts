import { getDb } from "../api/queries/connection";
import * as schema from "./schema";

async function clear() {
  const db = getDb();
  console.log("Clearing all tables...");
  await db.delete(schema.notifications);
  await db.delete(schema.dailyPlans);
  await db.delete(schema.payments);
  await db.delete(schema.arrivalItems);
  await db.delete(schema.arrivals);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.warehouseStock);
  await db.delete(schema.shops);
  await db.delete(schema.products);
  await db.delete(schema.settings);
  await db.delete(schema.users);
  console.log("All tables cleared.");
  process.exit(0);
}

clear().catch((err) => {
  console.error("Clear failed:", err);
  process.exit(1);
});
