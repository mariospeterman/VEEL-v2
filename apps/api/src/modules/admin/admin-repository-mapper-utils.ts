import type {
  AdminComplianceLedgerEntry
} from "./types.js";

export const pageSize = 50;

export function page<Row, Item>(rows: Row[], mapper: (row: Row) => Item): { items: Item[]; nextCursor: string | null } {
  const visibleRows = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? rows[pageSize] : null;

  return {
    items: visibleRows.map(mapper),
    nextCursor: cursorFor(next)
  };
}

export function cursorFor(row: unknown): string | null {
  if (typeof row === "object" && row !== null) {
    if ("created_at" in row && row.created_at instanceof Date) {
      return row.created_at.toISOString();
    }

    if ("granted_at" in row && row.granted_at instanceof Date) {
      return row.granted_at.toISOString();
    }

    if ("received_at" in row && row.received_at instanceof Date) {
      return row.received_at.toISOString();
    }

    if ("issued_at" in row && row.issued_at instanceof Date) {
      return row.issued_at.toISOString();
    }

    if ("starts_at" in row && row.starts_at instanceof Date) {
      return row.starts_at.toISOString();
    }
  }

  return null;
}

export function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

export function normalizeAdminProductType(productType: string): AdminComplianceLedgerEntry["productType"] {
  switch (productType) {
    case "tip":
      return "support";
    case "event_ticket":
      return "event_access_pass";
    case "creator_subscription":
      return "membership";
    case "platform_subscription":
      return "platform_plus";
    default:
      return productType as AdminComplianceLedgerEntry["productType"];
  }
}
