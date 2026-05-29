import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  decimal,
  boolean,
  date,
  time,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ============================================
// TENANTS — организации (компании)
// ============================================
export const tenants = mysqlTable("tenants", {
  id:            serial("id").primaryKey(),
  slug:          varchar("slug", { length: 100 }).notNull().unique(),
  name:          varchar("name", { length: 255 }).notNull(),
  plan:          mysqlEnum("plan", ["trial", "basic", "pro"]).default("trial").notNull(),
  status:        mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
  // Billing
  trialEndsAt:   timestamp("trial_ends_at"),
  planExpiresAt: timestamp("plan_expires_at"),
  // Limits per plan (null = unlimited)
  maxUsers:      bigint("max_users", { mode: "number", unsigned: true }),
  maxProducts:   bigint("max_products", { mode: "number", unsigned: true }),
  maxOrdersMonth:bigint("max_orders_month", { mode: "number", unsigned: true }),
  // Contact
  ownerEmail:    varchar("owner_email", { length: 320 }),
  ownerPhone:    varchar("owner_phone", { length: 30 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Tenant    = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ============================================
// USERS — пользователи (принадлежат тенанту)
// ============================================
export const users = mysqlTable("users", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 320 }).notNull(),
  passwordHash: varchar("password_hash", { length: 512 }).notNull(),
  avatar:       text("avatar"),
  phone:        varchar("phone", { length: 20 }),
  role:         mysqlEnum("role", ["ceo", "operator", "agent", "supervisor", "merchandiser"]).default("agent").notNull(),
  status:       mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt:     timestamp("lastSignInAt").defaultNow().notNull(),
  telegramChatId:   varchar("telegram_chat_id", { length: 50 }),
}, (t) => ({
  // email уникален внутри тенанта, но может повторяться в разных тенантах
  emailPerTenant: uniqueIndex("uq_user_email_tenant").on(t.email, t.tenantId),
  tenantIdx:      index("idx_users_tenant").on(t.tenantId),
}));

export type User       = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================
// SHOPS — торговые точки
// ============================================
export const shops = mysqlTable("shops", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  name:      varchar("name", { length: 255 }).notNull(),
  ownerName: varchar("owner_name", { length: 255 }),
  phone:     varchar("phone", { length: 20 }),
  address:   varchar("address", { length: 500 }),
  city:      varchar("city", { length: 100 }),
  district:  varchar("district", { length: 100 }),
  gpsLat:    decimal("gps_lat", { precision: 10, scale: 8 }),
  gpsLng:    decimal("gps_lng", { precision: 11, scale: 8 }),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).references(() => users.id),
  debt:      decimal("debt", { precision: 12, scale: 2 }).default("0.00").notNull(),
  status:    mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_shops_tenant").on(t.tenantId),
}));

export type Shop       = typeof shops.$inferSelect;
export type InsertShop = typeof shops.$inferInsert;

// ============================================
// PRODUCTS — товары
// ============================================
export const products = mysqlTable("products", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  code:         varchar("code", { length: 50 }).notNull(),
  name:         varchar("name", { length: 255 }).notNull(),
  category:     varchar("category", { length: 100 }),
  unitPrice:    decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  description:  text("description"),
  imageUrl:     text("image_url"),
  reorderPoint: decimal("reorder_point", { precision: 10, scale: 2 }).default("10.00").notNull(),
  status:       mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  codePerTenant: uniqueIndex("uq_product_code_tenant").on(t.code, t.tenantId),
  tenantIdx:     index("idx_products_tenant").on(t.tenantId),
}));

export type Product       = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ============================================
// ORDERS — заказы
// ============================================
export const orders = mysqlTable("orders", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  orderNumber: varchar("order_number", { length: 50 }).notNull(),
  shopId:      bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  agentId:     bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  status:      mysqlEnum("status", ["new", "processing", "completed", "cancelled"]).default("new").notNull(),
  subtotal:    decimal("subtotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
  discount:    decimal("discount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  total:       decimal("total", { precision: 12, scale: 2 }).default("0.00").notNull(),
  notes:       text("notes"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  orderNumPerTenant: uniqueIndex("uq_order_number_tenant").on(t.orderNumber, t.tenantId),
  tenantIdx:         index("idx_orders_tenant").on(t.tenantId),
}));

export type Order       = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============================================
// ORDER ITEMS
// ============================================
export const orderItems = mysqlTable("order_items", {
  id:        serial("id").primaryKey(),
  orderId:   bigint("order_id", { mode: "number", unsigned: true }).notNull().references(() => orders.id),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  quantity:  decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  subtotal:  decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OrderItem       = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// ============================================
// WAREHOUSE STOCK
// ============================================
export const warehouseStock = mysqlTable("warehouse_stock", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  productId:    bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  currentStock: decimal("current_stock", { precision: 12, scale: 2 }).default("0.00").notNull(),
  reserved:     decimal("reserved", { precision: 12, scale: 2 }).default("0.00").notNull(),
  available:    decimal("available", { precision: 12, scale: 2 }).default("0.00").notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  productPerTenant: uniqueIndex("uq_stock_product_tenant").on(t.productId, t.tenantId),
  tenantIdx:        index("idx_stock_tenant").on(t.tenantId),
}));

export type WarehouseStock       = typeof warehouseStock.$inferSelect;
export type InsertWarehouseStock = typeof warehouseStock.$inferInsert;

// ============================================
// STOCK MOVEMENTS
// ============================================
export const stockMovements = mysqlTable("stock_movements", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  productId:     bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  type:          mysqlEnum("type", ["in", "out", "adjustment"]).notNull(),
  quantity:      decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  referenceType: varchar("reference_type", { length: 50 }),
  referenceId:   bigint("reference_id", { mode: "number", unsigned: true }),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_movements_tenant").on(t.tenantId),
}));

export type StockMovement       = typeof stockMovements.$inferSelect;
export type InsertStockMovement = typeof stockMovements.$inferInsert;

// ============================================
// ARRIVALS — приход фур
// ============================================
export const arrivals = mysqlTable("arrivals", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  arrivalNumber: varchar("arrival_number", { length: 50 }).notNull(),
  truckId:       varchar("truck_id", { length: 100 }),
  driverName:    varchar("driver_name", { length: 255 }),
  driverPhone:   varchar("driver_phone", { length: 20 }),
  status:        mysqlEnum("status", ["pending", "unloading", "completed"]).default("pending").notNull(),
  fuelCost:      decimal("fuel_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  tollCost:      decimal("toll_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  otherCost:     decimal("other_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  totalExpense:  decimal("total_expense", { precision: 12, scale: 2 }).default("0.00").notNull(),
  arrivalDate:   date("arrival_date").notNull(),
  arrivalTime:   time("arrival_time"),
  unloadingTime: time("unloading_time"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  numPerTenant: uniqueIndex("uq_arrival_number_tenant").on(t.arrivalNumber, t.tenantId),
  tenantIdx:    index("idx_arrivals_tenant").on(t.tenantId),
}));

export type Arrival       = typeof arrivals.$inferSelect;
export type InsertArrival = typeof arrivals.$inferInsert;

// ============================================
// ARRIVAL ITEMS
// ============================================
export const arrivalItems = mysqlTable("arrival_items", {
  id:        serial("id").primaryKey(),
  arrivalId: bigint("arrival_id", { mode: "number", unsigned: true }).notNull().references(() => arrivals.id),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  quantity:  decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  condition: varchar("condition", { length: 255 }),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ArrivalItem       = typeof arrivalItems.$inferSelect;
export type InsertArrivalItem = typeof arrivalItems.$inferInsert;

// ============================================
// PAYMENTS
// ============================================
export const payments = mysqlTable("payments", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  amount:    decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type:      mysqlEnum("type", ["payment", "debt"]).default("payment").notNull(),
  notes:     text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_payments_tenant").on(t.tenantId),
}));

export type Payment       = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

// ============================================
// AGENT LOCATIONS — GPS трекинг
// ============================================
export const agentLocations = mysqlTable("agent_locations", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  lat:       decimal("lat", { precision: 10, scale: 8 }).notNull(),
  lng:       decimal("lng", { precision: 11, scale: 8 }).notNull(),
  accuracy:  decimal("accuracy", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_locations_tenant").on(t.tenantId),
}));

export type AgentLocation       = typeof agentLocations.$inferSelect;
export type InsertAgentLocation = typeof agentLocations.$inferInsert;

// ============================================
// DAILY PLANS
// ============================================
export const dailyPlans = mysqlTable("daily_plans", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  planDate:  date("plan_date").notNull(),
  status:    mysqlEnum("status", ["planned", "visited", "skipped"]).default("planned").notNull(),
  notes:     text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_plans_tenant").on(t.tenantId),
}));

export type DailyPlan       = typeof dailyPlans.$inferSelect;
export type InsertDailyPlan = typeof dailyPlans.$inferInsert;

// ============================================
// NOTIFICATIONS
// ============================================
export const notifications = mysqlTable("notifications", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  type:      mysqlEnum("type", ["order", "payment", "stock", "system"]).notNull(),
  title:     varchar("title", { length: 255 }).notNull(),
  message:   text("message"),
  isRead:    boolean("is_read").default(false).notNull(),
  link:      varchar("link", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_notif_tenant").on(t.tenantId),
}));

export type Notification       = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ============================================
// SETTINGS — настройки компании (1 строка на тенант)
// ============================================
export const settings = mysqlTable("settings", {
  id:                  serial("id").primaryKey(),
  tenantId:            bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id).unique(),
  companyName:         varchar("company_name", { length: 255 }).default("Warehouse Pro").notNull(),
  currency:            varchar("currency", { length: 10 }).default("CNY").notNull(),
  currencySymbol:      varchar("currency_symbol", { length: 10 }).default("¥").notNull(),
  defaultReorderPoint: decimal("default_reorder_point", { precision: 10, scale: 2 }).default("10.00").notNull(),
  lowStockThreshold:   decimal("low_stock_threshold", { precision: 10, scale: 2 }).default("50.00").notNull(),
  symbolPosition:      mysqlEnum("symbol_position", ["before", "after"]).default("after").notNull(),
  // UZ: address for official documents (printed on invoices)
  companyAddress:      text("company_address"),
  companyInn:          varchar("company_inn", { length: 50 }),     // ИНН / СТИР
  companyDirector:     varchar("company_director", { length: 255 }),
  companyBank:         varchar("company_bank", { length: 255 }),
  companyBankAccount:  varchar("company_bank_account", { length: 50 }),
  companyMfo:          varchar("company_mfo", { length: 20 }),      // МФО банка
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Setting       = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;

// ============================================
// SUBSCRIPTIONS — Stripe billing
// ============================================
export const subscriptions = mysqlTable("subscriptions", {
  id:                   varchar("id", { length: 36 }).primaryKey(),
  tenantId:             bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id).unique(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripeCustomerId:     varchar("stripe_customer_id", { length: 255 }),
  plan:                 mysqlEnum("plan", ["trial", "basic", "pro"]).default("trial").notNull(),
  status:               mysqlEnum("status", ["trialing", "active", "past_due", "canceled", "incomplete"]).default("trialing").notNull(),
  trialEndsAt:          timestamp("trial_ends_at"),
  currentPeriodEnds:    timestamp("current_period_ends"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx:    index("idx_sub_tenant").on(t.tenantId),
  stripeSubIdx: index("idx_sub_stripe").on(t.stripeSubscriptionId),
}));

export type Subscription       = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ============================================
// BILLING EVENTS — Stripe webhook log
// ============================================
export const billingEvents = mysqlTable("billing_events", {
  id:            varchar("id", { length: 36 }).primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).references(() => tenants.id),
  type:          varchar("type", { length: 100 }).notNull(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).unique(),
  payload:       text("payload"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_billing_events_tenant").on(t.tenantId),
}));

export type BillingEvent       = typeof billingEvents.$inferSelect;
export type InsertBillingEvent = typeof billingEvents.$inferInsert;

// ============================================
// INVITES — email invitations
// ============================================
export const invites = mysqlTable("invites", {
  id:         varchar("id", { length: 36 }).primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  email:      varchar("email", { length: 320 }).notNull(),
  role:       mysqlEnum("role", ["operator", "agent", "supervisor", "merchandiser"]).notNull(),
  token:      varchar("token", { length: 64 }).notNull().unique(),
  expiresAt:  timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdBy:  bigint("created_by", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenIdx:  index("idx_invites_token").on(t.token),
  tenantIdx: index("idx_invites_tenant").on(t.tenantId),
}));

export type Invite       = typeof invites.$inferSelect;
export type InsertInvite = typeof invites.$inferInsert;
