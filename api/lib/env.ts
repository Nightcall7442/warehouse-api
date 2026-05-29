import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[FATAL] Missing required environment variable: ${name}`);
      process.exit(1);
    }
    console.warn(`[WARN] Missing env var ${name} — using insecure default (dev only)`);
    return `dev-insecure-${name.toLowerCase().replace(/_/g, "-")}`;
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Core
  appSecret:            required("APP_SECRET"),
  databaseUrl:          required("DATABASE_URL"),
  appUrl:               optional("APP_URL", "http://localhost:3000"),
  isProduction:         process.env.NODE_ENV === "production",
  allowedOrigins:       optional("ALLOWED_ORIGINS").split(",").filter(Boolean),

  // Stripe
  stripeSecretKey:        optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret:    optional("STRIPE_WEBHOOK_SECRET"),
  stripeBasicPriceId:     optional("STRIPE_BASIC_PRICE_ID"),
  stripeProPriceId:       optional("STRIPE_PRO_PRICE_ID"),

  // SMTP
  smtpHost:    optional("SMTP_HOST"),
  smtpPort:    parseInt(optional("SMTP_PORT", "587"), 10),
  smtpUser:    optional("SMTP_USER"),
  smtpPass:    optional("SMTP_PASS"),
  smtpFrom:    optional("SMTP_FROM", "noreply@warehousepro.app"),

  // Cron secret (protects cron endpoints)
  cronSecret:  optional("CRON_SECRET"),

  // Telegram
  telegramBotToken:    optional("TELEGRAM_BOT_TOKEN"),
  telegramAdminChatId: optional("TELEGRAM_ADMIN_CHAT_ID"),
} as const;
