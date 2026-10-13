import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "kasir"]);
export const movementType = pgEnum("movement_type", [
  "initial",
  "in",
  "adjust",
  "sale",
  "void",
]);
export const saleStatus = pgEnum("sale_status", ["completed", "void"]);
export const paymentMethod = pgEnum("payment_method", ["cash"]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    lastReceiptNo: integer("last_receipt_no").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("stores_business_idx").on(t.businessId)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "set null",
    }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("kasir"),
    maxDiscountPct: integer("max_discount_pct").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("users_business_idx").on(t.businessId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_key_idx").on(t.key, t.createdAt)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("categories_business_name_uq").on(t.businessId, t.name),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("products_business_idx").on(t.businessId)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    size: text("size"),
    color: text("color"),
    costPrice: integer("cost_price").notNull().default(0),
    sellPrice: integer("sell_price").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("variants_business_sku_uq").on(t.businessId, t.sku),
    uniqueIndex("variants_business_barcode_uq").on(t.businessId, t.barcode),
    index("variants_product_idx").on(t.productId),
  ],
);

export const inventory = pgTable(
  "inventory",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(0),
    minQty: integer("min_qty").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.variantId] })],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    delta: integer("delta").notNull(),
    type: movementType("type").notNull(),
    reason: text("reason"),
    refSaleId: uuid("ref_sale_id"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_movements_variant_idx").on(t.storeId, t.variantId, t.createdAt),
    index("stock_movements_store_time_idx").on(t.storeId, t.createdAt),
  ],
);

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    // ID unik dari perangkat; kunci idempotensi untuk kiriman berulang.
    clientId: uuid("client_id").notNull(),
    receiptNo: integer("receipt_no").notNull(),
    cashierId: uuid("cashier_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: saleStatus("status").notNull().default("completed"),
    subtotal: integer("subtotal").notNull(),
    discountAmount: integer("discount_amount").notNull().default(0),
    total: integer("total").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("sales_store_client_uq").on(t.storeId, t.clientId),
    uniqueIndex("sales_store_receipt_uq").on(t.storeId, t.receiptNo),
    index("sales_store_time_idx").on(t.storeId, t.soldAt),
    check("sales_amounts_chk", sql`${t.total} >= 0 AND ${t.discountAmount} >= 0`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    productName: text("product_name").notNull(),
    sku: text("sku").notNull(),
    variantLabel: text("variant_label"),
    qty: integer("qty").notNull(),
    unitPrice: integer("unit_price").notNull(),
    costPrice: integer("cost_price").notNull(),
    lineTotal: integer("line_total").notNull(),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_variant_idx").on(t.variantId),
    check("sale_items_qty_chk", sql`${t.qty} > 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull().default("cash"),
    // amount = nilai yang dibayarkan untuk tagihan (sama dengan total).
    amount: integer("amount").notNull(),
    tendered: integer("tendered").notNull(),
    changeAmount: integer("change_amount").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("payments_sale_idx").on(t.saleId)],
);

// ---------------------------------------------------------------------------
// Fase 6: sinkronisasi transaksi offline
// ---------------------------------------------------------------------------

// Nilai harus sama dengan CONFLICT_KINDS di app/lib/offline/sync-schema.ts
export const conflictKind = pgEnum("conflict_kind", [
  "stock_short",
  "price_changed",
  "inactive_product",
  "discount_over_limit",
  "clock_skew",
]);
export const conflictStatus = pgEnum("conflict_status", ["open", "resolved"]);

// Penanda penjualan yang berasal dari perangkat offline, beserta nomor
// sementara di struk kertas dan waktu/nama kasir menurut perangkat.
export const offlineSales = pgTable(
  "offline_sales",
  {
    saleId: uuid("sale_id")
      .primaryKey()
      .references(() => sales.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    tempNo: text("temp_no").notNull(),
    deviceSoldAt: timestamp("device_sold_at", { withTimezone: true }).notNull(),
    deviceCashierName: text("device_cashier_name"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("offline_sales_store_idx").on(t.storeId, t.syncedAt)],
);

// Catatan hal yang perlu ditinjau pada penjualan hasil sinkronisasi.
export const saleConflicts = pgTable(
  "sale_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    kind: conflictKind("kind").notNull(),
    variantId: uuid("variant_id").references(() => productVariants.id),
    detail: text("detail").notNull(),
    status: conflictStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolveNote: text("resolve_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sale_conflicts_store_status_idx").on(
      t.storeId,
      t.status,
      t.createdAt,
    ),
    index("sale_conflicts_sale_idx").on(t.saleId),
  ],
);