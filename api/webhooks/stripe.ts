import type { Hono } from "hono";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions, billingEvents, tenants } from "@db/schema";
import { verifyWebhook } from "../lib/stripe";
import { sendEmail } from "../lib/mailer";
import { env } from "../lib/env";
import type { Context } from "hono";

export function registerStripeWebhook(app: Hono<any>) {
  app.post("/api/webhooks/stripe", async (c: Context) => {
    const signature = c.req.header("stripe-signature");
    if (!signature) return c.json({ error: "No signature" }, 400);

    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      return c.json({ error: "Cannot read body" }, 400);
    }

    let event: Awaited<ReturnType<typeof verifyWebhook>>;
    try {
      event = await verifyWebhook(rawBody, signature);
    } catch (err: any) {
      console.error("[stripe webhook] Signature verification failed:", err.message);
      return c.json({ error: "Invalid signature" }, 400);
    }

    const db = getDb();

    // Idempotency check
    const [existing] = await db.select()
      .from(billingEvents)
      .where(eq(billingEvents.stripeEventId, event.id))
      .limit(1);
    if (existing) return c.json({ received: true });

    // Log event
    await db.insert(billingEvents).values({
      id: randomUUID(), type: event.type,
      stripeEventId: event.id,
      payload: JSON.stringify(event.data.object),
    }).catch(() => {});

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session  = event.data.object as any;
          const tenantId = Number(session.metadata?.tenantId);
          if (!tenantId) break;
          await db.update(subscriptions).set({
            stripeSubscriptionId: session.subscription,
            stripeCustomerId:     session.customer,
            plan: "basic", status: "active", updatedAt: new Date(),
          }).where(eq(subscriptions.tenantId, tenantId));
          await db.update(billingEvents).set({ tenantId })
            .where(eq(billingEvents.stripeEventId, event.id));
          break;
        }
        case "customer.subscription.updated": {
          const sub      = event.data.object as any;
          const tenantId = Number(sub.metadata?.tenantId);
          if (!tenantId) break;
          const priceId = sub.items?.data?.[0]?.price?.id;
          const plan = priceId === env.stripeProPriceId ? "pro" : "basic";
          await db.update(subscriptions).set({
            plan, status: sub.status,
            currentPeriodEnds: sub.current_period_end
              ? new Date(sub.current_period_end * 1000) : null,
            updatedAt: new Date(),
          }).where(eq(subscriptions.tenantId, tenantId));
          break;
        }
        case "customer.subscription.deleted": {
          const sub      = event.data.object as any;
          const tenantId = Number(sub.metadata?.tenantId);
          if (!tenantId) break;
          await db.update(subscriptions).set({ status: "canceled", updatedAt: new Date() })
            .where(eq(subscriptions.tenantId, tenantId));
          break;
        }
        case "invoice.payment_failed": {
          const invoice  = event.data.object as any;
          const tenantId = Number(invoice.subscription_details?.metadata?.tenantId);
          if (!tenantId) break;
          await db.update(subscriptions).set({ status: "past_due", updatedAt: new Date() })
            .where(eq(subscriptions.tenantId, tenantId));
          const [tenant] = await db.select().from(tenants)
            .where(eq(tenants.id, tenantId)).limit(1);
          if (tenant?.ownerEmail) {
            sendEmail({
              to: tenant.ownerEmail,
              subject: `Ошибка оплаты — ${tenant.name}`,
              html: `<p>Не удалось списать оплату. <a href="${env.appUrl}/settings/billing">Обновить платёжные данные</a></p>`,
            }).catch(() => {});
          }
          break;
        }
      }
    } catch (err) {
      console.error("[stripe webhook] Handler error:", err);
    }

    return c.json({ received: true });
  });
}
