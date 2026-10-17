# Panduan Setup & Menjalankan POS JadikanWeb

Dokumen ini menjelaskan cara menyiapkan lingkungan pengembangan maupun
produksi: prasyarat, variabel lingkungan, migrasi database, pengisian data
awal/demo, hingga build dan deploy.

Daftar isi dokumentasi ada di [README](../README.md).

## 1. Prasyarat

- [Bun](https://bun.sh) ≥ 1.1 (runtime + package manager + task runner).
- Database PostgreSQL — proyek ini memakai **Neon** (serverless Postgres),
  tetapi connection string PostgreSQL biasa juga berfungsi.
- Node.js tidak wajib (Bun menjalankan semuanya), hanya untuk sebagian tool
  pihak ketiga bila diperlukan.

## 2. Variabel lingkungan

Salin ke file `.env` di root proyek. Aplikasi membacanya lewat `process.env`.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | Ya | Connection string Neon/Postgres. Dipakai aplikasi, `drizzle-kit`, dan skrip migrasi. |
| `NODE_ENV` | Otomatis | `production` mengaktifkan cookie sesi `Secure`. Di dev tidak perlu diisi. |

Untuk menjalankan `bun run db:seed` (akun admin pertama), tambahkan:

| Variabel | Keterangan |
|---|---|
| `SEED_BUSINESS_NAME` | Nama bisnis (tenant). |
| `SEED_STORE_NAME` | Nama toko awal. |
| `SEED_ADMIN_NAME` | Nama tampilan admin. |
| `SEED_ADMIN_USERNAME` | Username login admin (kecil). |
| `SEED_ADMIN_PASSWORD` | Password admin, minimal 8 karakter. |

Contoh `.env`:

```bash
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require"
SEED_BUSINESS_NAME="Toko Contoh"
SEED_STORE_NAME="Kasir Utama"
SEED_ADMIN_NAME="Admin"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="rahasia123"
```

> `DATABASE_URL` adalah rahasia. Jangan pernah commit `.env`.

## 3. Instalasi

```bash
bun install
```

## 4. Migrasi database

Skema dikelola [Drizzle ORM](https://orm.drizzle.team). File migrasi ada di
`drizzle/`.

```bash
# Setelah mengubah app/.server/db/schema.ts:
bun run db:generate        # buat file SQL migrasi baru — LALU BACA ISINYA

# Terapkan migrasi ke database:
bun run db:migrate --yes   # atau set CONFIRM_MIGRATE=yes
```

Aturan penting (lihat juga [Runbook pemulihan](./runbook-pemulihan.md)):

- **Selalu baca SQL** hasil `db:generate`. Jangan terapkan `DROP`/`ALTER` tak
  terduga.
- Migrasi harus **kompatibel mundur** (tambah kolom/tabel dulu, hapus
  belakangan) karena perangkat kasir offline bisa masih memakai kode lama.

## 5. Isi data awal

```bash
# Akun admin pertama (butuh variabel SEED_* di atas). Idempoten.
bun run db:seed

# Data demo lengkap: kasir, 10 kategori, ~34 produk + barcode EAN-13, 10 pemasok,
# 14 purchase order, pelanggan + piutang, kas & shift, opname, dan ~60 transaksi.
# Idempoten — aman dijalankan berulang.
bun run db:seed:demo
```

`db:seed:demo` mencetak kredensial login demo saat selesai
(admin `admin/admin12345`, kasir `kasir/kasir12345` bila belum ada).

## 6. Menjalankan (development)

```bash
bun run dev
```

Buka `http://localhost:5173`. Kamera pemindai barcode hanya berfungsi di
`localhost` atau situs **HTTPS**.

## 7. Build & jalankan produksi

```bash
bun run build            # hasil di build/
bun run start            # serve hasil build
bun run typecheck        # react-router typegen + tsc (sanitasi tipe)
```

## 8. Deploy

### Docker

```bash
docker build -t pos-jadikanweb .
docker run -p 3000:3000 -e DATABASE_URL="..." pos-jadikanweb
```

### Vercel

Proyek sudah berisi `vercel.json` (adapter `@vercel/react-router`). Pastikan
`DATABASE_URL` terpasang di Environment Variables proyek Vercel.

### Catatan deploy

Karena ada dependensi native-free (Bun) dan migrasi database, saat rilis:

1. Jalankan `bun install`.
2. Terapkan migrasi (`bun run db:migrate --yes`) sebelum/bersamaan deploy.
3. Baru deploy kode aplikasi.

Lanjut ke [Panduan fitur](./fitur.md) untuk penjelasan tiap halaman.
