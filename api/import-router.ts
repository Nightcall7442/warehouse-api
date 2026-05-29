import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { products, shops, warehouseStock } from "@db/schema";
import { eq, and } from "drizzle-orm";

type ParsedRow = Record<string, string | number | null>;

// ── Column mappings ───────────────────────────────────────────────────────────
const PRODUCT_COLUMNS: Record<string, string> = {
  "код": "code", "code": "code", "артикул": "code",
  "название": "name", "name": "name", "наименование": "name",
  "категория": "category", "category": "category",
  "цена": "unitPrice", "price": "unitPrice", "unitprice": "unitPrice",
  "мин. остаток": "reorderPoint", "reorder": "reorderPoint", "reorderpoint": "reorderPoint",
  "описание": "description", "description": "description",
};

const SHOP_COLUMNS: Record<string, string> = {
  "название": "name", "name": "name",
  "владелец": "ownerName", "owner": "ownerName", "ownername": "ownerName",
  "телефон": "phone", "phone": "phone",
  "город": "city", "city": "city",
  "район": "district", "district": "district",
  "адрес": "address", "address": "address",
};

function mapColumns(headers: string[], mapping: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    const field = mapping[key];
    if (field) result[field] = i;
  });
  return result;
}

function parseRow(cells: (string | number | null)[], colMap: Record<string, number>): ParsedRow {
  const row: ParsedRow = {};
  for (const [field, idx] of Object.entries(colMap)) {
    row[field] = cells[idx] ?? null;
  }
  return row;
}

export const importRouter = createRouter({
  /** Download template as base64 CSV */
  downloadTemplate: operatorQuery
    .input(z.object({ type: z.enum(["products", "shops"]) }))
    .query(({ input }) => {
      const headers = input.type === "products"
        ? ["Код", "Название", "Категория", "Цена", "Мин. остаток", "Описание"]
        : ["Название", "Владелец", "Телефон", "Город", "Район", "Адрес"];

      const examples = input.type === "products"
        ? [["TOM-001", "Помидоры свежие", "Овощи", "4500", "50", "Первый сорт"]]
        : [["Зелёный рынок", "Иванов И.И.", "+998901234567", "Ташкент", "Чиланзар", "ул. Чиланзарская 1"]];

      const csv = "\uFEFF" + [headers, ...examples].map(r => r.join(",")).join("\n");
      return { csv, filename: `template-${input.type}.csv` };
    }),

  /** Preview first 5 rows without importing */
  previewImport: operatorQuery
    .input(z.object({
      type:    z.enum(["products", "shops"]),
      base64:  z.string(),
      filename:z.string(),
    }))
    .mutation(({ input }) => {
      let rows: ParsedRow[] = [];
      let headers: string[] = [];

      try {
        const decoded = Buffer.from(input.base64, "base64").toString("utf-8");
        const lines   = decoded.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
        // Strip BOM
        const firstLine = lines[0].replace(/^\uFEFF/, "");
        headers = firstLine.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        const mapping = input.type === "products"
          ? mapColumns(headers, PRODUCT_COLUMNS)
          : mapColumns(headers, SHOP_COLUMNS);

        rows = lines.slice(1, 6).map(line => {
          const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
          return parseRow(cells, mapping);
        });
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Не удалось прочитать файл. Убедитесь формат CSV." });
      }

      return { headers, preview: rows };
    }),

  /** Execute import in transaction */
  executeImport: operatorQuery
    .input(z.object({
      type:    z.enum(["products", "shops"]),
      base64:  z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const db       = getDb();

      const decoded = Buffer.from(input.base64, "base64").toString("utf-8");
      const lines   = decoded.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
      const headers = lines[0].replace(/^\uFEFF/, "").split(",").map(h => h.trim().replace(/^"|"$/g, ""));

      const mapping = input.type === "products"
        ? mapColumns(headers, PRODUCT_COLUMNS)
        : mapColumns(headers, SHOP_COLUMNS);

      const dataLines = lines.slice(1);
      let success = 0;
      const errors: string[] = [];
      const skipped: string[] = [];

      for (let i = 0; i < dataLines.length; i++) {
        const rowNum = i + 2;
        const cells = dataLines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        const row   = parseRow(cells, mapping);

        try {
          if (input.type === "products") {
            const name = String(row.name ?? "").trim();
            const code = String(row.code ?? `IMPORT-${rowNum}`).trim();
            if (!name) { errors.push(`Строка ${rowNum}: нет названия`); continue; }

            // Skip if code already exists for this tenant
            const [existing] = await db.select({ id: products.id })
              .from(products)
              .where(and(eq(products.tenantId, tenantId), eq(products.code, code)))
              .limit(1);

            if (existing) { skipped.push(`${code} — уже существует`); continue; }

            await db.transaction(async (tx) => {
              const [r] = await tx.insert(products).values({
                tenantId,
                code,
                name,
                category:     String(row.category ?? "").trim() || undefined,
                unitPrice:    String(Number(String(row.unitPrice ?? "0").replace(/\s/g, "")) || 0),
                reorderPoint: String(Number(row.reorderPoint ?? 10) || 10),
                description:  String(row.description ?? "").trim() || undefined,
                status:       "active",
              });
              await tx.insert(warehouseStock).values({
                tenantId,
                productId:    Number(r.insertId),
                currentStock: "0.00",
                reserved:     "0.00",
                available:    "0.00",
              });
            });
          } else {
            const name = String(row.name ?? "").trim();
            if (!name) { errors.push(`Строка ${rowNum}: нет названия`); continue; }

            await db.insert(shops).values({
              tenantId,
              name,
              ownerName: String(row.ownerName ?? "").trim() || undefined,
              phone:     String(row.phone ?? "").trim() || undefined,
              city:      String(row.city ?? "").trim() || undefined,
              district:  String(row.district ?? "").trim() || undefined,
              debt:      "0.00",
              status:    "active",
            });
          }
          success++;
        } catch (err: any) {
          errors.push(`Строка ${rowNum}: ${err.message}`);
        }
      }

      return { success, errors, skipped, total: dataLines.length };
    }),
});
