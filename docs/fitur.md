# Panduan Fitur POS JadikanWeb

Panduan pemakaian per halaman. Peran: **Admin** (kelola penuh) dan **Kasir**
(transaksi harian). Semua data terisolasi per bisnis (multi-tenant) dan per
toko.

Lihat [README](../README.md) untuk ringkasan, [Arsitektur](./arsitektur.md)
untuk detail teknis.

## Alur cepat kasir

1. **Kas & Shift** → buka shift (isi modal awal laci).
2. **Kasir** → scan/ketik produk, atur qty, diskon (dalam batas wewenang),
   pilih pelanggan (opsional, untuk poin/piutang), bayar → struk.
3. **Riwayat penjualan** → cek/retur/batalkan transaksi.
4. **Kas & Shift** → tutup shift, cocokkan uang fisik vs perkiraan.

## Umum

| Halaman | Rute | Peran | Fungsi |
|---|---|---|---|
| Beranda | `/` | Admin | Ringkasan varian aktif, stok menipis, nilai persediaan (harga beli), omzet 7 hari, grafik penjualan, kesehatan stok, daftar perlu restok. |
| Pencarian global | `Ctrl/Cmd + K` | Semua | Cari & lompat ke **menu** dan **data** (produk, struk/penjualan, pelanggan, pemasok, pembelian) dari mana saja. |

## Penjualan

| Halaman | Rute | Peran | Fungsi |
|---|---|---|---|
| Kasir | `/kasir` | Kasir/Admin | Buat transaksi. Tambah item lewat pencarian, **scan barcode**, atau kamera. Kelola keranjang, diskon, metode bayar (tunai/QRIS/debit/kredit), cetak struk. |
| Riwayat penjualan | `/penjualan` | Kasir/Admin | Daftar transaksi; buka detail/struk; retur & batalkan. |
| Struk | `/struk/:id` | Kasir/Admin | Tampilan struk per transaksi (untuk cetak). |
| Retur | `/retur` | Kasir/Admin | Penanganan pengembalian barang/uang. |
| Pelanggan | `/pelanggan` | Kasir/Admin | Kelola pelanggan, lihat poin loyalti & piutang, terima cicilan. |
| Kas & Shift | `/kas-shift` | Kasir/Admin | Buka/tutup shift, modal awal, hitung kas, selisih, catatan. |

### Scan barcode di Kasir (2 opsi)

Tombol **Scan** di samping kotak pencarian menyediakan dua cara:

- **Scan dengan kamera** — memakai webcam/HP (butuh `localhost` atau HTTPS).
- **Scanner USB / ketik manual** — memfokuskan kotak; scanner USB mengetik kode
  lalu Enter otomatis menambah item.

Selain itu ada **listener global**: scanner barcode bisa langsung memindai ke
keranjang tanpa harus mengklik kotak pencarian. Kode dicocokkan persis dengan
`barcode` atau `sku` varian; bila tidak ditemukan atau stok habis, muncul
notifikasi.

## Katalog

| Halaman | Rute | Peran | Fungsi |
|---|---|---|---|
| Produk | `/produk` | Admin | Daftar produk, cari, arsipkan. |
| Produk baru | `/produk/baru` | Admin | Buat produk + varian (SKU, harga beli/jual, ukuran, warna, stok awal). Barcode bisa **dibuat otomatis (EAN-13)** lewat tombol "Buat". |
| Detail produk | `/produk/:id` | Admin | Ubah produk/varian, harga, stok. |
| Kategori | `/kategori` | Admin | Kelola kategori produk. |
| Label Barcode | `/label-barcode` | Admin | Cetak label barcode massal: pilih varian + jumlah, ukuran label, sumber kode (barcode/SKU), tampil harga, lalu cetak. Bisa **backfill** barcode untuk varian yang belum punya. |

## Stok

| Halaman | Rute | Peran | Fungsi |
|---|---|---|---|
| Stok | `/stok` | Admin | Lihat/ubah stok per varian, ambang menipis (`?low=1` untuk filter). |
| Riwayat stok | `/stok/riwayat` | Admin | Jejak pergerakan stok (initial/in/adjust/sale/void/return). |
| Opname | `/opname` | Admin | Hitung fisik stok, finalisasi selisih ke stok. |

## Pembelian & Pemasok

| Halaman | Rute | Peran | Fungsi |
|---|---|---|---|
| Pemasok | `/pemasok` | Admin | Kelola data pemasok. |
| Pembelian | `/pembelian` | Admin | Purchase order (draft/received/cancelled). Menerima PO menambah stok & menghitung ulang harga pokok rata-rata tertimbang. |

## Laporan

| Halaman | Rute | Peran | Fungsi |
|---|---|---|---|
| Laporan | `/laporan` | Admin | Rekap penjualan/omzet per rentang tanggal, produk terlaris, laba kotor. |
| Ekspor CSV | `/laporan/csv` | Admin | Unduh laporan sebagai CSV. |

## Pengaturan (Admin)

| Halaman | Rute | Fungsi |
|---|---|---|
| Pengguna | `/pengguna`, `/pengguna/baru` | Kelola user (admin/kasir), wewenang diskon maksimum, aktif/nonaktif. |
| Toko | `/toko` | Kelola toko. |
| Sinkronisasi | `/sinkronisasi` | Pemantauan transaksi offline & konflik. |
| Riwayat aksi | `/riwayat-aksi` | Jejak audit tindakan sensitif. |

## Offline-first (PWA)

Aplikasi dapat dipakai saat internet putus:

- Katalog tersimpan lokal (Dexie/IndexedDB) lewat endpoint `/api/catalog`.
- Transaksi offline masuk **antrean lokal**, dikirim otomatis saat online lewat
  `/api/sync` dengan **idempotensi** (`clientId`) agar tidak dobel.
- Konflik (stok kurang, harga berubah, produk nonaktif, diskon di atas batas,
  jam melenceng) dicatat untuk ditinjau di halaman **Sinkronisasi**.

> Jangan hapus data browser atau logout sebelum antrean sinkron kosong. Detail
> pemulihan ada di [Runbook](./runbook-pemulihan.md).

## Barcode EAN-13

- Varian baru otomatis dapat barcode **EAN-13 in-store** (prefix `200` +
  nomor urut per bisnis + digit periksa). Penomoran atomik via tabel
  `barcode_sequences`.
- Render label memakai `bwip-js` (EAN-13 untuk kode 13 digit, selain itu
  Code128).
