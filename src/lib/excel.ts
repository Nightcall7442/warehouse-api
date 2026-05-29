/**
 * Excel export utility — pure browser, no server needed.
 * Uses SheetJS (xlsx) loaded from the package.
 * Falls back to CSV if xlsx not available.
 */

type Row = Record<string, string | number | null | undefined>;

export function exportToExcel(rows: Row[], filename: string, sheetName = "Sheet1") {
  try {
    // Dynamic import for tree-shaking
    const XLSX = require("xlsx");
    const ws   = XLSX.utils.json_to_sheet(rows);
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${filename}.xlsx`);
  } catch {
    // Fallback: CSV
    exportToCSV(rows, filename);
  }
}

export function exportToCSV(rows: Row[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h] ?? "";
        return String(v).includes(",") ? `"${v}"` : v;
      }).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Formatters per entity ────────────────────────────────────────────────────

export function formatOrdersForExport(orders: any[]) {
  return orders.map(o => ({
    "Order #":    o.orderNumber,
    "Date":       o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "",
    "Shop":       o.shopName ?? "",
    "Agent":      o.agentName ?? "",
    "Status":     o.status ?? "",
    "Subtotal":   Number(o.subtotal ?? 0).toFixed(2),
    "Discount":   Number(o.discount ?? 0).toFixed(2),
    "Total":      Number(o.total ?? 0).toFixed(2),
    "Notes":      o.notes ?? "",
  }));
}

export function formatArrivalsForExport(arrivals: any[]) {
  return arrivals.map(a => ({
    "Arrival #":    a.arrivalNumber,
    "Date":         a.arrivalDate ? new Date(a.arrivalDate).toLocaleDateString() : "",
    "Truck":        a.truckId ?? "",
    "Driver":       a.driverName ?? "",
    "Driver Phone": a.driverPhone ?? "",
    "Status":       a.status ?? "",
    "Fuel Cost":    Number(a.fuelCost ?? 0).toFixed(2),
    "Toll Cost":    Number(a.tollCost ?? 0).toFixed(2),
    "Other Cost":   Number(a.otherCost ?? 0).toFixed(2),
    "Total Expense":Number(a.totalExpense ?? 0).toFixed(2),
    "Notes":        a.notes ?? "",
  }));
}

export function formatWarehouseForExport(stock: any[]) {
  return stock.map(s => ({
    "Product":       s.productName ?? "",
    "Code":          s.productCode ?? "",
    "Category":      s.category ?? "",
    "Unit Price":    Number(s.unitPrice ?? 0).toFixed(2),
    "Total Stock":   Number(s.currentStock ?? 0).toFixed(2),
    "Reserved":      Number(s.reserved ?? 0).toFixed(2),
    "Available":     Number(s.available ?? 0).toFixed(2),
    "Reorder Point": Number(s.reorderPoint ?? 0).toFixed(2),
    "Low Stock":     Number(s.available ?? 0) < Number(s.reorderPoint ?? 0) ? "YES" : "no",
  }));
}

export function formatMovementsForExport(movements: any[]) {
  return movements.map(m => ({
    "Date":      m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "",
    "Product":   m.productName ?? "",
    "Type":      m.type ?? "",
    "Quantity":  Number(m.quantity ?? 0).toFixed(2),
    "Reference": m.referenceType ? `${m.referenceType} #${m.referenceId}` : "",
    "Notes":     m.notes ?? "",
  }));
}
