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
  "return",
]);
export const saleStatus = pgEnum("sale_status", ["completed", "void"]);
export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "qris",
  "debit",
  "credit",
]);
// Status purchase order (Fase 7). `draft` boleh diterima/dibatalkan;
// `received` sudah menambah stok dan tidak bisa diulang (idempoten).
export const poStatus = pgEnum("po_status", ["draft", "received", "cancelled"]);
// Status opname stok (Fase 7). `open` masih bisa diisi; `finalized` sudah
// menerapkan selisih ke stok.
export const countStatus = pgEnum("count_status", [
  "open",
  "finalized",
  "cancelled",
]);

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
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("kasir"),
    maxDiscountPct: integer("max_discount_pct").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    // Username hanya unik di antara akun aktif: akun nonaktif boleh diganti
    // dengan akun baru berusername sama. Constraint lama (users_username_unique)
    // dijatuhkan pada migrasi 0004.
    uniqueIndex("users_username_active_uq")
      .on(t.username)
      .where(sql`is_active`),
    index("users_business_idx").on(t.businessId),
  ],
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
    // Harga produk ini termasuk PPN? Dipakai untuk menghitung tax_amount.
    taxable: boolean("taxable").notNull().default(true),
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
    // Pelanggan yang terkait transaksi (loyalti/piutang). Null = transaksi tun.
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    status: saleStatus("status").notNull().default("completed"),
    subtotal: integer("subtotal").notNull(),
    discountAmount: integer("discount_amount").notNull().default(0),
    total: integer("total").notNull(),
    // PPN 11% inklusif yang terangkum dalam total (untuk barang taxable).
    taxAmount: integer("tax_amount").notNull().default(0),
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
    // Nomor referensi untuk metode non-tunai (mis. No. transaksi QRIS/debit).
    reference: text("reference"),
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

// ---------------------------------------------------------------------------
// Retur / pembatalan sebagian
// ---------------------------------------------------------------------------

// Satu baris per (penjualan, varian) yang diretur. Pengembalian uang dihitung
// proporsional terhadap diskon saat transaksi asal dan disimpan per baris.
export const saleReturns = pgTable(
  "sale_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
    refundAmount: integer("refund_amount").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Idempotensi retur offline: satu pengiriman ulang dengan clientId yang
    // sama tidak boleh membuat baris retur ganda. Retur online bernilai null.
    clientId: uuid("client_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sale_returns_sale_idx").on(t.saleId),
    index("sale_returns_store_time_idx").on(t.storeId, t.createdAt),
    check("sale_returns_qty_chk", sql`${t.qty} > 0 AND ${t.refundAmount} >= 0`),
    uniqueIndex("sale_returns_client_variant_uq")
      .on(t.clientId, t.variantId)
      .where(sql`client_id is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Jejak audit tindakan sensitif
// ---------------------------------------------------------------------------

export const auditAction = pgEnum("audit_action", [
  "void_sale",
  "return_sale",
  "price_change",
  "discount_override",
  "user_create",
  "user_update",
  "user_disable",
  "password_reset",
  "store_create",
  "store_update",
  "stock_adjust",
  "shift_close",
  "payment_received",
]);

// Jejak tindakan penting (pembatalan/retur/ubah harga/kelola user & toko).
// Ditulis dalam transaksi yang sama dengan aksi aslinya agar konsisten.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "set null",
    }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: auditAction("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    detail: text("detail").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_business_time_idx").on(t.businessId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// Fase 5: Manajemen kas & shift
// ---------------------------------------------------------------------------

export const shiftStatus = pgEnum("shift_status", ["open", "closed"]);

// Satu shift kas per (toko, pelaksana). Guard unique parsial memastikan hanya
// satu shift berstatus open untuk pasangan yang sama pada satu waktu.
export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    openedBy: uuid("opened_by").references(() => users.id, {
      onDelete: "set null",
    }),
    closedBy: uuid("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Modal awal laci kas saat shift dibuka.
    openingFloat: integer("opening_float").notNull().default(0),
    // Uang fisik hasil perhitungan saat shift ditutup (null bila masih open).
    countedCash: integer("counted_cash"),
    // Perkiraan kas: opening_float + tunai masuk - tunai keluar (retur).
    expectedCash: integer("expected_cash"),
    // Selisih counted - expected (positif = lebih, negatif = kurang).
    variance: integer("variance"),
    status: shiftStatus("status").notNull().default("open"),
    notes: text("notes"),
  },
  (t) => [
    index("shifts_store_time_idx").on(t.storeId, t.openedAt),
    index("shifts_business_idx").on(t.businessId),
    uniqueIndex("shifts_open_guard_uq")
      .on(t.storeId, t.openedBy)
      .where(sql`${t.status} = 'open'`),
  ],
);

// ---------------------------------------------------------------------------
// Fase 6: Pelanggan, loyalti & piutang
// ---------------------------------------------------------------------------

// Pelanggan sederhana per bisnis. Poin loyalti tersimpan di kolom `points`.
// Nomor HP unik per bisnis bila diisi (nullable; tidak unik bila kosong).
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    // Saldo poin loyalti. Akumulasi = floor(total / 1000) per transaksi.
    points: integer("points").notNull().default(0),
    tier: text("tier"),
    createdAt: createdAt(),
  },
  (t) => [
    index("customers_business_idx").on(t.businessId),
    uniqueIndex("customers_business_phone_uq")
      .on(t.businessId, t.phone)
      .where(sql`${t.phone} is not null`),
  ],
);

export const debtStatus = pgEnum("debt_status", ["open", "paid"]);

// Piutang yang muncul saat transaksi memakai metode `credit`. `balance`
// berkurang tiap pembayaran; status menjadi `paid` saat balance mencapai 0.
export const debts = pgTable(
  "debts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").references(() => sales.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull(),
    balance: integer("balance").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: debtStatus("status").notNull().default("open"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("debts_customer_idx").on(t.customerId),
    index("debts_business_status_idx").on(t.businessId, t.status),
    check("debts_amount_chk", sql`${t.amount} > 0 AND ${t.balance} >= 0`),
  ],
);

// Cicilan pembayaran piutang. Setiap pembayaran juga menambah baris `payments`
// pada transaksi asal (agar kas/rekap ikut) — diurus di service.
export const debtPayments = pgTable(
  "debt_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    debtId: uuid("debt_id")
      .notNull()
      .references(() => debts.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    method: paymentMethod("method").notNull().default("cash"),
    reference: text("reference"),
    receivedBy: uuid("received_by").references(() => users.id, {
      onDelete: "set null",
    }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("debt_payments_debt_idx").on(t.debtId),
    check("debt_payments_amount_chk", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Fase 7: Pembelian, pemasok & opname
// ---------------------------------------------------------------------------

// Pemasok per bisnis. Nama tidak dipaksakan unik agar tetap fleksibel.
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    createdAt: createdAt(),
  },
  (t) => [index("suppliers_business_idx").on(t.businessId)],
);

// Purchase order per toko. Nomor PO unik dalam satu toko.
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    poNumber: text("po_number").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: poStatus("status").notNull().default("draft"),
    // Total harga beli (penjumlahan line_total item); dihitung ulang di server.
    totalCost: integer("total_cost").notNull().default(0),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (
    t,
  ) => [
    uniqueIndex("po_store_number_uq").on(t.storeId, t.poNumber),
    index("po_business_idx").on(t.businessId),
    index("po_store_status_idx").on(t.storeId, t.status, t.createdAt),
  ],
);

// Satu baris item PO. unit_cost adalah harga beli per satuan saat pemesanan;
// dipakai untuk menghitung harga pokok rata-rata tertimbang saat diterima.
export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
    unitCost: integer("unit_cost").notNull(),
    lineTotal: integer("line_total").notNull(),
  },
  (t) => [
    index("po_items_po_idx").on(t.poId),
    index("po_items_variant_idx").on(t.variantId),
    check("po_items_qty_chk", sql`${t.qty} > 0 AND ${t.unitCost} >= 0`),
  ],
);

// Header opname (hitung fisik) per toko.
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    status: countStatus("status").notNull().default("open"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => [
    index("stock_counts_store_idx").on(t.storeId, t.createdAt),
    index("stock_counts_business_idx").on(t.businessId),
  ],
);

// Baris hasil hitung per varian. expectedQty adalah snapshot stok saat baris
// dibuat; delta = countedQty - expectedQty diterapkan saat finalisasi.
export const stockCountItems = pgTable(
  "stock_count_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    expectedQty: integer("expected_qty").notNull(),
    countedQty: integer("counted_qty").notNull(),
    delta: integer("delta").notNull(),
  },
  (t) => [
    uniqueIndex("stock_count_items_uq").on(t.countId, t.variantId),
    index("stock_count_items_count_idx").on(t.countId),
    check("stock_count_items_qty_chk", sql`${t.countedQty} >= 0`),
  ],
);