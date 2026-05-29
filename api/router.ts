import { authRouter }         from "./auth-router";
import { tenantRouter }       from "./tenant-router";
import { dashboardRouter }    from "./dashboard-router";
import { shopRouter }         from "./shop-router";
import { productRouter }      from "./product-router";
import { orderRouter }        from "./order-router";
import { warehouseRouter }    from "./warehouse-router";
import { arrivalRouter }      from "./arrival-router";
import { analyticsRouter }    from "./analytics-router";
import { agentRouter }        from "./agent-router";
import { userRouter }         from "./user-router";
import { notificationRouter } from "./notification-router";
import { settingsRouter }     from "./settings-router";
import { billingRouter }      from "./billing-router";
import { telegramRouter }     from "./telegram-router";
import { stripeRouter }       from "./stripe-router";
import { inviteRouter }       from "./invite-router";
import { importRouter }       from "./import-router";
import { reportsRouter }      from "./reports-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping:         publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth:         authRouter,
  tenant:       tenantRouter,
  dashboard:    dashboardRouter,
  shop:         shopRouter,
  product:      productRouter,
  order:        orderRouter,
  warehouse:    warehouseRouter,
  arrival:      arrivalRouter,
  analytics:    analyticsRouter,
  agent:        agentRouter,
  user:         userRouter,
  notification: notificationRouter,
  settings:     settingsRouter,
  billing:      billingRouter,
  stripe:       stripeRouter,
  telegram:     telegramRouter,
  invite:       inviteRouter,
  import:       importRouter,
  reports:      reportsRouter,
});

export type AppRouter = typeof appRouter;
