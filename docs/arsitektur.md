# Arsitektur POS JadikanWeb

Catatan teknis untuk pengembang. Lihat [README](../README.md) untuk ringkasan
dan [Panduan fitur](./fitur.md) untuk perilaku dari sisi pengguna.

## Tumpukan teknologi

| Lapisan | Pilihan |
|---|---|
| Framework | React Router v8 (Framework Mode: loader/action, SSR, typegen) |
| Bahasa | TypeScript strict, alias `~/*` → `./app/*` |
| UI | Tailwind CSS v4 + shadcn/ui (Radix), ikon Hugeicons |
| Runtime/build | Bun (dev, build, task runner), Vite |
| Database | PostgreSQL (Neon serverless) via Drizzle ORM |
| Offline | PWA (service worker) + Dexie (IndexedDB) |
| Barcode | `bwip-js` (render SVG), `@zxing/browser` (scan kamera) |
| Deploy | Docker / Vercel (`@vercel/react-router`) |

## Struktur folder

```
app/
  root.tsx, routes.ts, app.css
  routes/            # satu file per rute (loader/action + komponen)
  components/        # komponen berbagi + ui/ (shadcn)
  lib/               # util klien (format, schemas, offline/)
  hooks/
  .server/           # KODE SERVER-SAJA (tidak pernah dikirim ke klien)
    auth/            # sesi, password, guard (requireUser/AdminStore)
    db/              # client.ts (withDb) + schema.ts (Drizzle)
    services/        # logika bisnis: catalog, sales, sync-sales, reports,
                     # purchases, suppliers, customers, debts, shifts, barcodes
    errors.ts
drizzle/             # file SQL migrasi + meta/snapshot
scripts/             # migrate.ts, seed.ts, seed-demo.ts
public/              # aset statis, manifest PWA, sw.js
```

## Model data (inti)

Multi-tenant: semua baris punya `business_id`; banyak juga ber-`store_id`.

- **Identitas:** `businesses` → `stores` → `users` (role `admin`/`kasir`,
  `max_discount_pct`). Sesi di `sessions` (token di-hash SHA-256), proteksi
  brute-force di `login_attempts`.
- **Katalog:** `categories`, `products` (bendera `taxable`), `product_variants`
  (SKU unik, `barcode` unik per bisnis, `cost_price`/`sell_price` integer).
- **Stok:** `inventory` (PK gabungan `store_id`+`variant_id`, `qty`, `min_qty`),
  `stock_movements` (delta + tipe `initial/in/adjust/sale/void/return`).
- **Penjualan:** `sales` (nomor struk urut per toko, idempoten `client_id`),
  `sale_items` (snapshot nama/SKU/harga), `payments` (metode
  `cash/qris/debit/credit`), `sale_returns`, `offline_sales`, `sale_conflicts`.
- **Pelanggan & piutang:** `customers` (poin loyalti), `debts`, `debt_payments`.
- **Kas & shift:** `shifts` (guard unik: satu `open` per toko+pelaksana).
- **Pembelian:** `suppliers`, `purchase_orders` (`draft/received/cancelled`),
  `purchase_order_items`, `stock_counts` + `stock_count_items` (opname).
- **Lainnya:** `audit_logs` (tindakan sensitif), `barcode_sequences`
  (penomoran EAN-13 atomik per bisnis).

## Konvensi penting

- **Rupiah integer.** Semua uang disimpan sebagai **bilangan bulat** (rupiah
  penuh), bukan float. PPN 11% bersifat inklusif (`tax_amount`).
- **Idempotensi di batas sistem.** Transaksi offline memakai `client_id`
  unik; pengiriman ulang tidak membuat duplikat (constraint
  `sales_store_client_uq`).
- **Otorisasi di server.** Guard `requireUser` / `requireAdminStore` /
  `requireStoreUser` memvalidasi sesi & peran di loader/action, bukan hanya UI.
- **Transaksi & anti-balapan.** Penulisan multi-tabel dibungkus
  `db.transaction`; baris toko dikunci untuk penomoran struk agar bebas
  balapan/deadlock.
- **Bahasa Indonesia** untuk komentar, teks UI, dan pesan error.
- **Kompatibel mundur** untuk migrasi (lihat [Runbook](./runbook-pemulihan.md)).

## Alur request

```
Browser ──(loader/action)──▶ React Router server
                                 │  guard sesi (cookie pos_session)
                                 ▼
                              withDb(fn)  ──▶ Neon (Drizzle)
                                 │
                                 ▼
                          services/*  (logika bisnis murni, bisa diuji)
```

Rute API khusus: `/api/catalog` (sinkron katalog ke IndexedDB), `/api/sync`
(kirim transaksi offline), `/api/barcode` (buat kode EAN-13 baru),
`/api/search` (pencarian global command palette lintas data),
`/laporan/csv` (unduh CSV).

## Barcode

- **Pembangkitan:** `services/barcodes.ts` — prefix `200` + 9 digit nomor urut
  (dari `barcode_sequences`, upsert atomik) + digit periksa mod-10 → EAN-13.
  Tabrakan dilewati otomatis. Tersedia `generateBarcodeOnce` (dipakai
  `/api/barcode`) dan `backfillMissingBarcodes`.
- **Render:** `components/barcode.tsx` memakai `toSVG` dari `bwip-js/browser`
  (impor sub-path agar beresolusi di `moduleResolution: bundler` & SSR-safe).
  EAN-13 untuk 13 digit valid, sisanya Code128.
- **Scan:** `components/camera-scanner.tsx` memuat `@zxing/browser` secara
  dinamis (hindari crash SSR + code-splitting).

## Menjalankan & memeriksa

```bash
bun run dev         # http://localhost:5173
bun run typecheck   # react-router typegen + tsc
bun run db:generate # migrasi baru dari perubahan schema
bun run db:migrate --yes
bun run db:seed     # akun admin pertama
bun run db:seed:demo# data demo (idempoten)
```

Detail setup: [Panduan Setup](./panduan-setup.md).
