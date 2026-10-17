# POS JadikanWeb

Aplikasi **Point of Sale (kasir) berbasis web** yang bisa dipakai online maupun
**offline** (PWA). Didukung multi-toko & multi-bisnis, manajemen stok, pembelian
& pemasok, pelanggan & piutang, kas & shift, laporan, serta **barcode EAN-13**
(buat otomatis, cetak label, dan scan).

Dibangun dengan **React Router v8 (Framework Mode)**, **TypeScript**,
**Tailwind CSS + shadcn/ui**, **Drizzle ORM + Neon (Postgres)**, dijalankan
dengan **Bun**.

## Dokumentasi

| Dokumen | Untuk apa |
|---|---|
| 📖 [Panduan Setup](./docs/panduan-setup.md) | Prasyarat, `.env`, migrasi, seed, build, deploy. |
| 🧭 [Panduan Fitur](./docs/fitur.md) | Penjelasan tiap halaman & alur pemakaian (kasir/admin). |
| 🏗️ [Arsitektur](./docs/arsitektur.md) | Tumpukan teknologi, struktur folder, model data, konvensi. |
| 🛟 [Runbook Pemulihan](./docs/runbook-pemulihan.md) | Backup & pemulihan database, skenario darurat. |
| 🔎 [Cek Integritas](./docs/cek-integritas.sql) | Kueri SQL pemeriksaan konsistensi data. |

## Mulai cepat

```bash
# 1. Pasang dependensi
bun install

# 2. Siapkan .env dengan DATABASE_URL (lihat Panduan Setup)

# 3. Migrasi + isi data
bun run db:migrate --yes
bun run db:seed         # akun admin pertama (butuh variabel SEED_*)
bun run db:seed:demo    # (opsional) data demo lengkap, idempoten

# 4. Jalankan
bun run dev             # http://localhost:5173
```

## Skrip yang tersedia

| Perintah | Fungsi |
|---|---|
| `bun run dev` | Server pengembangan (HMR). |
| `bun run build` | Build produksi ke `build/`. |
| `bun run start` | Jalankan hasil build. |
| `bun run typecheck` | `react-router typegen` + `tsc`. |
| `bun run db:generate` | Buat migrasi dari perubahan skema Drizzle. |
| `bun run db:migrate` | Terapkan migrasi (butuh `--yes` / `CONFIRM_MIGRATE=yes`). |
| `bun run db:seed` | Buat bisnis/toko/admin pertama. |
| `bun run db:seed:demo` | Muat data demo (produk, penjualan, pembelian, dll). |

## Fitur unggulan

- 🧾 **Kasir cepat** dengan scan barcode (kamera & scanner USB) dan struk.
- 📴 **Offline-first**: transaksi antre lokal lalu sinkron otomatis (idempoten).
- 📦 **Stok & opname**, riwayat pergerakan, peringatan stok menipis.
- 🛒 **Pembelian & pemasok**: purchase order, harga pokok rata-rata tertimbang.
- 👥 **Pelanggan**: poin loyalti & piutang dengan cicilan.
- 💵 **Kas & shift**: modal awal, perhitungan, dan selisih.
- 🏷️ **Barcode EAN-13**: pembuatan otomatis, cetak label massal, backfill.
- 📊 **Laporan** penjualan/laba + ekspor CSV.
- 🔐 **Multi-tenant & peran** (admin/kasir) dengan otorisasi di server.

## Teknologi

React Router 8 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) ·
Drizzle ORM · Neon Postgres · Bun · Dexie (PWA) · bwip-js · @zxing/browser.

## Deploy

Tersedia `Dockerfile` dan `vercel.json`. Detail pada
[Panduan Setup](./docs/panduan-setup.md#8-deploy).

---

Dibangun dengan ❤️ menggunakan React Router.
