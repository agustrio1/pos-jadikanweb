// Seed data demo: akun kasir, kategori, produk (+varian & stok awal & barcode
// EAN-13), pemasok, purchase order, pelanggan (+piutang & cicilan), serta kas &
// shift. Idempoten — aman dijalankan berulang; baris yang sudah ada dilewati.
//
// Jalankan: bun run db:seed:demo
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { hashPassword } from "../app/.server/auth/password";
import { withDb } from "../app/.server/db/client";
import {
  businesses,
  categories,
  customers,
  debtPayments,
  debts,
  inventory,
  payments,
  productVariants,
  products,
  purchaseOrderItems,
  purchaseOrders,
  saleItems,
  sales,
  shifts,
  stockCountItems,
  stockCounts,
  stockMovements,
  stores,
  suppliers,
  users,
} from "../app/.server/db/schema";
import { generateBarcode } from "../app/.server/services/barcodes";

const DEMO = {
  business: "Toko Demo JadikanWeb",
  store: "Kasir Utama",
  admin: { username: "admin", name: "Admin Demo", password: "admin12345" },
  kasir: { username: "kasir", name: "Kasir Demo", password: "kasir12345" },
};

const CATEGORY_NAMES = [
  "Minuman",
  "Makanan",
  "Snack",
  "Susu & Olahan",
  "Frozen Food",
  "Kebutuhan Pokok",
  "Perawatan Diri",
  "Rumah Tangga",
  "Elektronik",
  "Alat Tulis",
];

type DemoVariant = {
  sku: string;
  size: string;
  cost: number;
  sell: number;
  stock: number;
  min: number;
};
type DemoProduct = {
  name: string;
  category: string;
  variants: DemoVariant[];
};

const DEMO_PRODUCTS: DemoProduct[] = [
  // --- Minuman ---
  {
    name: "Aqua Botol",
    category: "Minuman",
    variants: [
      { sku: "AQUA-600", size: "600ml", cost: 3000, sell: 5000, stock: 100, min: 20 },
      { sku: "AQUA-1500", size: "1500ml", cost: 4000, sell: 7000, stock: 80, min: 15 },
    ],
  },
  { name: "Teh Botol Sosok", category: "Minuman", variants: [{ sku: "TEH-500", size: "500ml", cost: 3000, sell: 4500, stock: 120, min: 24 }] },
  { name: "Coca-Cola", category: "Minuman", variants: [{ sku: "COCA-390", size: "390ml", cost: 4000, sell: 6000, stock: 90, min: 20 }] },
  { name: "Pocari Sweat", category: "Minuman", variants: [{ sku: "POCARI-500", size: "500ml", cost: 5000, sell: 7000, stock: 70, min: 15 }] },
  { name: "Fanta", category: "Minuman", variants: [{ sku: "FANTA-390", size: "390ml", cost: 4000, sell: 6000, stock: 80, min: 20 }] },
  { name: "Kopi Sachet", category: "Minuman", variants: [{ sku: "KOPI-SACHET", size: "Sachet", cost: 1000, sell: 2000, stock: 500, min: 50 }] },

  // --- Makanan ---
  {
    name: "Indomie Goreng",
    category: "Makanan",
    variants: [
      { sku: "INDOMIE-PCS", size: "Pcs", cost: 2500, sell: 3500, stock: 200, min: 30 },
      { sku: "INDOMIE-DUS", size: "Dus 40", cost: 95000, sell: 120000, stock: 20, min: 5 },
    ],
  },
  { name: "Roti Tawar Sari Roti", category: "Makanan", variants: [{ sku: "ROTI-TAWAR", size: "Pouch", cost: 12000, sell: 16000, stock: 25, min: 8 }] },
  { name: "Biskuit Oreo", category: "Makanan", variants: [{ sku: "OREO-CAKE", size: "Cake", cost: 8000, sell: 11000, stock: 60, min: 15 }] },

  // --- Snack ---
  { name: "Chitato", category: "Snack", variants: [{ sku: "CHITATO-68", size: "68g", cost: 9000, sell: 12000, stock: 50, min: 12 }] },
  { name: "Taro", category: "Snack", variants: [{ sku: "TARO-80", size: "80g", cost: 4000, sell: 6000, stock: 70, min: 20 }] },
  { name: "Beng-Beng", category: "Snack", variants: [{ sku: "BENGBENG-STIK", size: "Stik", cost: 3000, sell: 4500, stock: 100, min: 25 }] },

  // --- Susu & Olahan ---
  { name: "Susu Ultra Milk", category: "Susu & Olahan", variants: [{ sku: "ULTRA-250", size: "250ml", cost: 5500, sell: 7000, stock: 80, min: 20 }] },
  { name: "Susu Dancow Bubuk", category: "Susu & Olahan", variants: [{ sku: "DANCOW-170", size: "170g", cost: 22000, sell: 27000, stock: 30, min: 8 }] },
  { name: "Yoghurt Cimory", category: "Susu & Olahan", variants: [{ sku: "CIMORY-YOG", size: "Pouch", cost: 12000, sell: 16000, stock: 40, min: 10 }] },

  // --- Frozen Food ---
  { name: "Nugget Fiesta", category: "Frozen Food", variants: [{ sku: "NUGGET-250", size: "250g", cost: 12000, sell: 16000, stock: 40, min: 10 }] },
  { name: "Sosis Boois", category: "Frozen Food", variants: [{ sku: "SOSIS-250", size: "250g", cost: 15000, sell: 20000, stock: 35, min: 10 }] },
  { name: "Es Krim Walls", category: "Frozen Food", variants: [{ sku: "ESKRIM-CONE", size: "Cone", cost: 6000, sell: 9000, stock: 50, min: 15 }] },

  // --- Kebutuhan Pokok ---
  { name: "Beras Pandan Wangi", category: "Kebutuhan Pokok", variants: [{ sku: "BERAS-5KG", size: "5kg", cost: 60000, sell: 72000, stock: 30, min: 5 }] },
  { name: "Gula Pasir", category: "Kebutuhan Pokok", variants: [{ sku: "GULA-1KG", size: "1kg", cost: 13000, sell: 16000, stock: 40, min: 10 }] },
  { name: "Minyak Goreng Sania", category: "Kebutuhan Pokok", variants: [{ sku: "MINYAK-2L", size: "2L", cost: 32000, sell: 38000, stock: 45, min: 12 }] },
  { name: "Tepung Terigu Segitiga", category: "Kebutuhan Pokok", variants: [{ sku: "TERIGU-1KG", size: "1kg", cost: 11000, sell: 14000, stock: 40, min: 10 }] },
  { name: "Telur Ayam", category: "Kebutuhan Pokok", variants: [{ sku: "TELUR-KG", size: "kg", cost: 26000, sell: 30000, stock: 50, min: 10 }] },

  // --- Perawatan Diri ---
  { name: "Sabun Lifebuoy", category: "Perawatan Diri", variants: [{ sku: "SABUN-LB", size: "Batang", cost: 3500, sell: 5000, stock: 90, min: 20 }] },
  { name: "Shampoo Sunsilk", category: "Perawatan Diri", variants: [{ sku: "SHAMPOO-170", size: "170ml", cost: 15000, sell: 20000, stock: 40, min: 10 }] },
  { name: "Pasta Gigi Odol", category: "Perawatan Diri", variants: [{ sku: "ODOL-190", size: "190g", cost: 12000, sell: 16000, stock: 45, min: 12 }] },
  { name: "Deodoran Nivea", category: "Perawatan Diri", variants: [{ sku: "NIVEA-ROLL", size: "Roll-on", cost: 20000, sell: 26000, stock: 30, min: 8 }] },

  // --- Rumah Tangga ---
  { name: "Deterjen Rinso", category: "Rumah Tangga", variants: [{ sku: "RINSO-700", size: "700g", cost: 18000, sell: 23000, stock: 35, min: 10 }] },
  { name: "Tisu Klenex", category: "Rumah Tangga", variants: [{ sku: "TISU-BOX", size: "Box", cost: 12000, sell: 16000, stock: 40, min: 12 }] },
  { name: "Sunlight", category: "Rumah Tangga", variants: [{ sku: "SUNLIGHT-755", size: "755ml", cost: 15000, sell: 20000, stock: 30, min: 8 }] },

  // --- Elektronik ---
  { name: "Baterai ABC", category: "Elektronik", variants: [{ sku: "BATERAI-AAA", size: "AAA", cost: 3000, sell: 5000, stock: 100, min: 24 }] },
  { name: "Lampu LED Hannochs", category: "Elektronik", variants: [{ sku: "LAMPU-LED12", size: "12W", cost: 15000, sell: 22000, stock: 40, min: 10 }] },
  { name: "Kabel Data USB", category: "Elektronik", variants: [{ sku: "KABEL-USB", size: "1m", cost: 15000, sell: 25000, stock: 30, min: 8 }] },

  // --- Alat Tulis ---
  { name: "Pulpen Standard", category: "Alat Tulis", variants: [{ sku: "PULPEN-STD", size: "Pcs", cost: 2000, sell: 3500, stock: 120, min: 30 }] },
  { name: "Buku Tulis 38 Lembar", category: "Alat Tulis", variants: [{ sku: "BUKU-38", size: "38 lbr", cost: 4000, sell: 6000, stock: 80, min: 20 }] },
  { name: "Penghapus Pencil", category: "Alat Tulis", variants: [{ sku: "PENGHAPUS", size: "Pcs", cost: 1500, sell: 3000, stock: 60, min: 15 }] },
];

const DEMO_SUPPLIERS = [
  { name: "PT Sumber Rejeki", phone: "021-555-0101", address: "Jakarta" },
  { name: "CV Makmur Jaya", phone: "0812-3456-7890", address: "Bandung" },
  { name: "PT Unggul Sejahtera", phone: "021-777-8899", address: "Jakarta" },
  { name: "Mitra Tani Indonesia", phone: "031-555-1212", address: "Surabaya" },
  { name: "CV Berkah Abadi", phone: "022-444-3322", address: "Bandung" },
  { name: "PT Nusantara Food", phone: "024-333-2211", address: "Semarang" },
  { name: "PT Unilever Distribusi", phone: "021-500-1122", address: "Jakarta" },
  { name: "PT Indofood CBP", phone: "021-500-3344", address: "Jakarta" },
  { name: "CV Sinar Terang Elektronik", phone: "031-500-5566", address: "Surabaya" },
  { name: "PT Mayora Indah", phone: "021-500-7788", address: "Tangerang" },
];

const DEMO_CUSTOMERS = [
  { name: "Budi Santoso", phone: "0811-0001-0001", points: 1500 },
  { name: "Siti Aminah", phone: "0811-0002-0002", points: 3200 },
  { name: "Andi Wijaya", phone: "0811-0003-0003", points: 0 },
];

await withDb(async (db) => {
  const adminHash = await hashPassword(DEMO.admin.password);
  const kasirHash = await hashPassword(DEMO.kasir.password);

  await db.transaction(async (tx) => {
    // --- Bisnis & toko (buat bila belum ada) -------------------------------
    let [business] = await tx
      .select()
      .from(businesses)
      .orderBy(businesses.createdAt)
      .limit(1);
    if (!business) {
      [business] = await tx
        .insert(businesses)
        .values({ name: DEMO.business })
        .returning();
    }
    const businessId = business.id;

    let [store] = await tx
      .select()
      .from(stores)
      .where(eq(stores.businessId, businessId))
      .limit(1);
    if (!store) {
      [store] = await tx
        .insert(stores)
        .values({ businessId, name: DEMO.store })
        .returning();
    }
    const storeId = store.id;

    // --- Akun admin & kasir -------------------------------------------------
    let [admin] = await tx
      .select()
      .from(users)
      .where(and(eq(users.businessId, businessId), eq(users.role, "admin")))
      .limit(1);
    if (!admin) {
      [admin] = await tx
        .insert(users)
        .values({
          businessId,
          storeId,
          username: DEMO.admin.username,
          passwordHash: adminHash,
          name: DEMO.admin.name,
          role: "admin",
          maxDiscountPct: 100,
        })
        .returning();
    }

    let [kasir] = await tx
      .select()
      .from(users)
      .where(and(eq(users.businessId, businessId), eq(users.username, DEMO.kasir.username)))
      .limit(1);
    if (!kasir) {
      [kasir] = await tx
        .insert(users)
        .values({
          businessId,
          storeId,
          username: DEMO.kasir.username,
          passwordHash: kasirHash,
          name: DEMO.kasir.name,
          role: "kasir",
          maxDiscountPct: 10,
        })
        .returning();
      console.log(`  + akun kasir: ${DEMO.kasir.username} / ${DEMO.kasir.password}`);
    }

    // --- Kategori -----------------------------------------------------------
    const existingCats = new Set(
      (await tx.select().from(categories).where(eq(categories.businessId, businessId))).map(
        (c) => c.name,
      ),
    );
    const catId = new Map<string, string>();
    for (const c of await tx.select().from(categories).where(eq(categories.businessId, businessId))) {
      catId.set(c.name, c.id);
    }
    for (const name of CATEGORY_NAMES) {
      if (existingCats.has(name)) continue;
      const [row] = await tx
        .insert(categories)
        .values({ businessId, name })
        .returning();
      catId.set(name, row.id);
      console.log(`  + kategori: ${name}`);
    }

    // --- Produk + varian + stok awal + barcode ------------------------------
    const existingProducts = new Set(
      (await tx.select().from(products).where(eq(products.businessId, businessId))).map(
        (p) => p.name,
      ),
    );
    for (const p of DEMO_PRODUCTS) {
      if (existingProducts.has(p.name)) continue;
      const [prod] = await tx
        .insert(products)
        .values({ businessId, categoryId: catId.get(p.category) ?? null, name: p.name })
        .returning();
      for (const [i, v] of p.variants.entries()) {
        const barcode = await generateBarcode(tx, businessId);
        const [variant] = await tx
          .insert(productVariants)
          .values({
            businessId,
            productId: prod.id,
            sku: v.sku,
            barcode,
            size: v.size,
            costPrice: v.cost,
            sellPrice: v.sell,
            isDefault: i === 0,
          })
          .returning({ id: productVariants.id });
        await tx.insert(inventory).values({
          storeId,
          variantId: variant.id,
          qty: v.stock,
          minQty: v.min,
        });
        await tx.insert(stockMovements).values({
          storeId,
          variantId: variant.id,
          delta: v.stock,
          type: "initial",
          reason: "Stok awal demo",
          createdBy: admin.id,
        });
      }
      console.log(`  + produk: ${p.name} (${p.variants.length} varian)`);
    }

    // Peta SKU -> variantId (termasuk varian yang sudah ada sebelumnya).
    const skuToVariant = new Map<string, string>();
    for (const v of await tx
      .select({ id: productVariants.id, sku: productVariants.sku })
      .from(productVariants)
      .where(eq(productVariants.businessId, businessId))) {
      skuToVariant.set(v.sku, v.id);
    }

    // --- Pemasok ------------------------------------------------------------
    const existingSuppliers = new Set(
      (await tx.select().from(suppliers).where(eq(suppliers.businessId, businessId))).map(
        (s) => s.name,
      ),
    );
    const supplierId = new Map<string, string>();
    for (const s of DEMO_SUPPLIERS) {
      if (existingSuppliers.has(s.name)) {
        const [row] = await tx
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.businessId, businessId), eq(suppliers.name, s.name)))
          .limit(1);
        supplierId.set(s.name, row.id);
        continue;
      }
      const [row] = await tx
        .insert(suppliers)
        .values({ businessId, name: s.name, phone: s.phone, address: s.address })
        .returning();
      supplierId.set(s.name, row.id);
      console.log(`  + pemasok: ${s.name}`);
    }

    // --- Purchase order -----------------------------------------------------
    const existingPo = new Set(
      (await tx.select().from(purchaseOrders).where(eq(purchaseOrders.storeId, storeId))).map(
        (p) => p.poNumber,
      ),
    );
    const poPlans = [
      { poNumber: "PO-DEMO-0001", supplier: "PT Sumber Rejeki", status: "received" as const, items: [
        { sku: "BERAS-5KG", qty: 20, unitCost: 60000 }, { sku: "GULA-1KG", qty: 30, unitCost: 13000 } ] },
      { poNumber: "PO-DEMO-0002", supplier: "CV Makmur Jaya", status: "draft" as const, items: [
        { sku: "AQUA-600", qty: 200, unitCost: 3000 } ] },
      { poNumber: "PO-DEMO-0003", supplier: "PT Unggul Sejahtera", status: "received" as const, items: [
        { sku: "INDOMIE-DUS", qty: 15, unitCost: 95000 }, { sku: "KOPI-SACHET", qty: 500, unitCost: 1000 } ] },
      { poNumber: "PO-DEMO-0004", supplier: "Mitra Tani Indonesia", status: "received" as const, items: [
        { sku: "AQUA-1500", qty: 100, unitCost: 4000 }, { sku: "AQUA-600", qty: 300, unitCost: 3000 } ] },
      { poNumber: "PO-DEMO-0005", supplier: "CV Berkah Abadi", status: "cancelled" as const, items: [
        { sku: "INDOMIE-PCS", qty: 100, unitCost: 2500 } ] },
      { poNumber: "PO-DEMO-0006", supplier: "PT Nusantara Food", status: "draft" as const, items: [
        { sku: "GULA-1KG", qty: 50, unitCost: 13000 }, { sku: "BERAS-5KG", qty: 25, unitCost: 60000 } ] },
      { poNumber: "PO-DEMO-0007", supplier: "PT Unggul Sejahtera", status: "received" as const, items: [
        { sku: "KOPI-SACHET", qty: 1000, unitCost: 1000 } ] },
      { poNumber: "PO-DEMO-0008", supplier: "CV Makmur Jaya", status: "draft" as const, items: [
        { sku: "INDOMIE-DUS", qty: 10, unitCost: 95000 } ] },
      { poNumber: "PO-DEMO-0009", supplier: "PT Indofood CBP", status: "received" as const, items: [
        { sku: "INDOMIE-PCS", qty: 300, unitCost: 2500 }, { sku: "OREO-CAKE", qty: 60, unitCost: 8000 } ] },
      { poNumber: "PO-DEMO-0010", supplier: "PT Mayora Indah", status: "received" as const, items: [
        { sku: "BENGBENG-STIK", qty: 120, unitCost: 3000 }, { sku: "CHITATO-68", qty: 50, unitCost: 9000 }, { sku: "TARO-80", qty: 70, unitCost: 4000 } ] },
      { poNumber: "PO-DEMO-0011", supplier: "PT Unilever Distribusi", status: "received" as const, items: [
        { sku: "SABUN-LB", qty: 90, unitCost: 3500 }, { sku: "SHAMPOO-170", qty: 40, unitCost: 15000 }, { sku: "RINSO-700", qty: 35, unitCost: 18000 } ] },
      { poNumber: "PO-DEMO-0012", supplier: "CV Sinar Terang Elektronik", status: "draft" as const, items: [
        { sku: "BATERAI-AAA", qty: 120, unitCost: 3000 }, { sku: "LAMPU-LED12", qty: 40, unitCost: 15000 } ] },
      { poNumber: "PO-DEMO-0013", supplier: "Mitra Tani Indonesia", status: "received" as const, items: [
        { sku: "MINYAK-2L", qty: 45, unitCost: 32000 }, { sku: "TERIGU-1KG", qty: 40, unitCost: 11000 }, { sku: "TELUR-KG", qty: 50, unitCost: 26000 } ] },
      { poNumber: "PO-DEMO-0014", supplier: "PT Nusantara Food", status: "cancelled" as const, items: [
        { sku: "NUGGET-250", qty: 40, unitCost: 12000 }, { sku: "SOSIS-250", qty: 35, unitCost: 15000 } ] },
    ];
    for (const plan of poPlans) {
      if (existingPo.has(plan.poNumber)) continue;
      const items = plan.items
        .map((it) => ({ ...it, variantId: skuToVariant.get(it.sku) }))
        .filter((it): it is typeof it & { variantId: string } => !!it.variantId);
      if (items.length === 0) continue;
      const totalCost = items.reduce((s, it) => s + it.qty * it.unitCost, 0);
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          businessId,
          storeId,
          poNumber: plan.poNumber,
          supplierId: supplierId.get(plan.supplier)!,
          status: plan.status,
          totalCost,
          createdBy: admin.id,
          receivedAt: plan.status === "received" ? new Date() : null,
          note: "Data demo",
        })
        .returning();
      for (const it of items) {
        await tx.insert(purchaseOrderItems).values({
          poId: po.id,
          variantId: it.variantId,
          qty: it.qty,
          unitCost: it.unitCost,
          lineTotal: it.qty * it.unitCost,
        });
      }
      console.log(`  + pembelian: ${plan.poNumber} (${plan.status})`);
    }

    // --- Pelanggan ----------------------------------------------------------
    const existingCustomers = new Set(
      (await tx.select().from(customers).where(eq(customers.businessId, businessId))).map(
        (c) => c.phone,
      ),
    );
    let customerId: string | null = null;
    for (const c of DEMO_CUSTOMERS) {
      if (existingCustomers.has(c.phone)) continue;
      const [row] = await tx
        .insert(customers)
        .values({ businessId, name: c.name, phone: c.phone, points: c.points })
        .returning();
      if (c.name === "Andi Wijaya") customerId = row.id;
      console.log(`  + pelanggan: ${c.name}`);
    }

    // --- Piutang + cicilan (untuk Andi Wijaya) ------------------------------
    if (customerId) {
      const hasDebt = (
        await tx
          .select()
          .from(debts)
          .where(eq(debts.customerId, customerId))
          .limit(1)
      ).length;
      if (!hasDebt) {
        const [debt] = await tx
          .insert(debts)
          .values({
            businessId,
            storeId,
            customerId,
            amount: 100000,
            balance: 40000,
            status: "open",
            createdBy: admin.id,
          })
          .returning();
        await tx.insert(debtPayments).values({
          debtId: debt.id,
          businessId,
          amount: 60000,
          method: "cash",
          receivedBy: admin.id,
        });
        console.log("  + piutang & cicilan untuk Andi Wijaya");
      }
    }

    // --- Kas & shift --------------------------------------------------------
    const openShift = (
      await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.storeId, storeId), eq(shifts.openedBy, kasir.id)))
        .limit(1)
    ).length;
    if (!openShift) {
      await tx.insert(shifts).values({
        businessId,
        storeId,
        openedBy: kasir.id,
        openingFloat: 200000,
        status: "open",
        notes: "Shift demo (sedang berjalan)",
      });
      console.log("  + shift buka (kasir)");
    }

    const closedShift = (
      await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.storeId, storeId), eq(shifts.status, "closed")))
        .limit(1)
    ).length;
    if (!closedShift) {
      const opened = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const closed = new Date(Date.now() - 16 * 60 * 60 * 1000);
      await tx.insert(shifts).values({
        businessId,
        storeId,
        openedBy: admin.id,
        closedBy: admin.id,
        openedAt: opened,
        closedAt: closed,
        openingFloat: 100000,
        countedCash: 350000,
        expectedCash: 340000,
        variance: 10000,
        status: "closed",
        notes: "Shift demo (sudah ditutup)",
      });
      console.log("  + shift tutup (admin)");
    }

    // --- Penjualan (top-up hingga TARGET_SALES transaksi) -------------------
    const TARGET_SALES = 60;
    const currentSales = (
      await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.storeId, storeId))
    ).length;
    const toCreate = Math.max(0, TARGET_SALES - currentSales);
    if (toCreate > 0) {
      const poolRows = await tx
        .select({
          variantId: productVariants.id,
          productName: products.name,
          sku: productVariants.sku,
          size: productVariants.size,
          color: productVariants.color,
          sellPrice: productVariants.sellPrice,
          costPrice: productVariants.costPrice,
          qty: inventory.qty,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(
          inventory,
          and(
            eq(inventory.variantId, productVariants.id),
            eq(inventory.storeId, storeId),
          ),
        )
        .where(eq(productVariants.businessId, businessId));
      const remaining = new Map(poolRows.map((r) => [r.variantId, r.qty]));
      const customerIds = (
        await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.businessId, businessId))
      ).map((c) => c.id);
      const methods = ["cash", "cash", "cash", "qris", "debit"] as const;
      let receipt = store.lastReceiptNo;
      let created = 0;

      for (let s = 0; s < toCreate; s++) {
        const available = poolRows.filter(
          (r) => (remaining.get(r.variantId) ?? 0) > 0,
        );
        if (available.length === 0) break;
        const lineCount =
          1 + Math.floor(Math.random() * Math.min(3, available.length));
        const chosen = new Set<string>();
        const lines: {
          v: (typeof poolRows)[number];
          qty: number;
          lineTotal: number;
        }[] = [];
        for (let i = 0; i < lineCount; i++) {
          const v = available[Math.floor(Math.random() * available.length)];
          if (chosen.has(v.variantId)) continue;
          chosen.add(v.variantId);
          const rem = remaining.get(v.variantId) ?? 0;
          const qty = 1 + Math.floor(Math.random() * Math.min(3, rem));
          lines.push({ v, qty, lineTotal: qty * v.sellPrice });
          remaining.set(v.variantId, rem - qty);
        }
        if (lines.length === 0) continue;
        const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
        const total = subtotal;
        receipt += 1;
        created += 1;
        const soldAt = new Date(
          Date.now() -
            Math.floor(Math.random() * 30) * 86_400_000 -
            Math.floor(Math.random() * 8) * 3_600_000,
        );
        const customerId =
          customerIds.length > 0 && Math.random() < 0.25
            ? customerIds[Math.floor(Math.random() * customerIds.length)]
            : null;

        const [sale] = await tx
          .insert(sales)
          .values({
            businessId,
            storeId,
            clientId: randomUUID(),
            receiptNo: receipt,
            cashierId: kasir.id,
            customerId,
            subtotal,
            discountAmount: 0,
            total,
            taxAmount: 0,
            soldAt,
          })
          .returning({ id: sales.id });

        await tx.insert(saleItems).values(
          lines.map((l) => ({
            saleId: sale.id,
            variantId: l.v.variantId,
            productName: l.v.productName,
            sku: l.v.sku,
            variantLabel:
              [l.v.size, l.v.color].filter(Boolean).join(" / ") || null,
            qty: l.qty,
            unitPrice: l.v.sellPrice,
            costPrice: l.v.costPrice,
            lineTotal: l.lineTotal,
          })),
        );

        const method = methods[Math.floor(Math.random() * methods.length)];
        const tendered =
          method === "cash" ? Math.ceil(total / 1000) * 1000 : total;
        await tx.insert(payments).values({
          saleId: sale.id,
          method,
          amount: total,
          tendered,
          changeAmount: tendered - total,
        });

        for (const l of lines) {
          await tx
            .update(inventory)
            .set({ qty: sql`${inventory.qty} - ${l.qty}`, updatedAt: new Date() })
            .where(
              and(
                eq(inventory.storeId, storeId),
                eq(inventory.variantId, l.v.variantId),
              ),
            );
          await tx.insert(stockMovements).values({
            storeId,
            variantId: l.v.variantId,
            delta: -l.qty,
            type: "sale",
            reason: `Penjualan #${receipt}`,
            refSaleId: sale.id,
            createdBy: kasir.id,
          });
        }

        if (customerId) {
          const earned = Math.floor(total / 1000);
          if (earned > 0) {
            await tx
              .update(customers)
              .set({ points: sql`${customers.points} + ${earned}` })
              .where(eq(customers.id, customerId));
          }
        }
      }

      await tx
        .update(stores)
        .set({ lastReceiptNo: receipt })
        .where(eq(stores.id, storeId));
      console.log(
        `  + penjualan: ${created} transaksi (target ${TARGET_SALES})`,
      );
    }

    // --- Opname (stock count): 1 finalized + 1 open -------------------------
    const existingCounts = (
      await tx
        .select({ id: stockCounts.id })
        .from(stockCounts)
        .where(eq(stockCounts.storeId, storeId))
    ).length;
    if (existingCounts === 0) {
      // Snapshot stok berjalan (setelah penjualan & pembelian di atas).
      const invRows = await tx
        .select({ variantId: inventory.variantId, qty: inventory.qty })
        .from(inventory)
        .where(eq(inventory.storeId, storeId));

      if (invRows.length > 0) {
        const now = Date.now();

        // (a) Opname sudah difinalisasi — beberapa varian punya selisih.
        const [finalized] = await tx
          .insert(stockCounts)
          .values({
            businessId,
            storeId,
            status: "finalized",
            note: "Opname demo (sudah finalisasi)",
            createdBy: admin.id,
            createdAt: new Date(now - 5 * 86_400_000),
            finalizedAt: new Date(now - 5 * 86_400_000 + 3_600_000),
          })
          .returning({ id: stockCounts.id });
        const sample = invRows.slice(0, Math.min(8, invRows.length));
        let adjusted = 0;
        for (const r of sample) {
          const diff = r.qty >= 5 && Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) : 0;
          const counted = Math.max(0, r.qty + diff);
          const delta = counted - r.qty;
          await tx.insert(stockCountItems).values({
            countId: finalized.id,
            variantId: r.variantId,
            expectedQty: r.qty,
            countedQty: counted,
            delta,
          });
          if (delta !== 0) {
            adjusted += 1;
            await tx
              .update(inventory)
              .set({ qty: counted, updatedAt: new Date() })
              .where(
                and(
                  eq(inventory.storeId, storeId),
                  eq(inventory.variantId, r.variantId),
                ),
              );
            await tx.insert(stockMovements).values({
              storeId,
              variantId: r.variantId,
              delta,
              type: "adjust",
              reason: "Selisih opname",
              createdBy: admin.id,
            });
          }
        }

        // (b) Opname masih open — baru sebagian dihitung, belum diterapkan.
        const [openCount] = await tx
          .insert(stockCounts)
          .values({
            businessId,
            storeId,
            status: "open",
            note: "Opname demo (sedang berjalan)",
            createdBy: admin.id,
          })
          .returning({ id: stockCounts.id });
        const sample2 = invRows.slice(8, Math.min(14, invRows.length));
        for (const r of sample2) {
          await tx.insert(stockCountItems).values({
            countId: openCount.id,
            variantId: r.variantId,
            expectedQty: r.qty,
            countedQty: r.qty,
            delta: 0,
          });
        }

        console.log(
          `  + opname: 1 finalized (${adjusted} selisih) + 1 open (${sample2.length} baris)`,
        );
      }
    }
  });

  console.log("\nSeed demo selesai.");
  console.log("Login admin :", DEMO.admin.username, "/", DEMO.admin.password);
  console.log("Login kasir :", DEMO.kasir.username, "/", DEMO.kasir.password);
});
