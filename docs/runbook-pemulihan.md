# Runbook POS JadikanWeb: backup dan pemulihan

Isi bagian "Data proyek" sekali, lalu simpan file ini di tempat yang bisa
dibuka saat darurat (jangan hanya di laptop yang sama dengan proyek).

## Data proyek (isi sendiri, tanpa secret)

- Proyek Neon / branch produksi: ...
- Region Neon dan region fungsi Vercel: ...
- Paket Neon (menentukan jendela riwayat): ...
- Proyek Vercel / domain: ...
- Siapa yang berwenang menjalankan pemulihan: ...

## 1. Lapisan backup

1. **Restore titik waktu Neon.** Neon menyimpan riwayat perubahan selama
   jendela riwayat (berbeda per paket, sekitar 1 sampai 30 hari). Cek nilainya
   di pengaturan proyek dan sesuaikan dengan kebutuhan.
2. **Dump logis berkala (`pg_dump`).** Salinan di luar Neon, untuk kasus
   akun/proyek bermasalah atau data lebih tua dari jendela riwayat.
3. **Snapshot manual sebelum perubahan berisiko** (migrasi, impor data), jika
   paket Anda menyediakannya.

### Dump logis

Gunakan connection string direct (bukan pooled) dan jalankan dari mesin yang
punya `pg_dump`. Simpan hasilnya terenkripsi di lokasi terpisah.

    pg_dump "<DATABASE_URL_DIRECT>" --format=custom --no-owner --file=pos-backup-YYYYMMDD-HHMM.dump

Jadwal minimal: harian (atau setiap tutup toko). Simpan beberapa generasi.

## 2. Sebelum migrasi database

1. `bunx drizzle-kit generate`, lalu BACA file SQL baru. Jangan terapkan jika
   ada `DROP`/`ALTER` yang tidak Anda harapkan.
2. Buat branch Neon dari produksi, terapkan migrasi di sana, jalankan alur
   utama (login, jual online, jual offline lalu sinkron, batal, laporan).
3. Ambil dump atau snapshot produksi.
4. Terapkan ke produksi di jam sepi: `bunx drizzle-kit migrate`.
5. Deploy kode. Migrasi harus KOMPATIBEL MUNDUR (tambah kolom/tabel dulu,
   hapus belakangan) karena perangkat offline bisa masih membawa kode lama.

## 3. Skenario pemulihan

### A. Data salah terhapus atau terubah
1. Hentikan perubahan lebih lanjut jika perlu (jelaskan ke tim).
2. Di Neon, pakai Time Travel Assist (kueri baca-saja pada titik waktu lalu)
   untuk memastikan titik sebelum kejadian.
3. Buat branch BARU dari titik itu dan ambil data yang hilang dari sana,
   atau restore branch produksi ke titik itu.
4. PERHATIAN: restore menimpa seluruh branch dan memengaruhi semua database di
   branch itu. Semua transaksi setelah titik restore hilang (lihat bagian F).
   Neon membuat branch cadangan otomatis sebelum menimpa; catat namanya.

### B. Migrasi gagal atau merusak data
Sama dengan A, titik restore tepat sebelum migrasi. Deploy kode versi lama
lebih dulu jika kode baru membutuhkan skema baru.

### C. Deploy aplikasi bermasalah
Rollback instan di dashboard Vercel (atau `vercel rollback`) ke deployment
sebelumnya. Database tidak ikut ter-rollback.

### D. Perangkat kasir hilang, rusak, atau data browser terhapus
- Transaksi yang BELUM tersinkron di perangkat itu tidak bisa dipulihkan.
- Rekonsiliasi: bandingkan jumlah/total struk yang dicetak atau catatan kas
  dengan riwayat penjualan di server untuk hari itu.
- Cegah: sinkron berkala, jangan pakai mode incognito, jangan hapus data
  situs, dan pastikan tidak ada antrean tersisa sebelum logout atau tutup toko.

### E. Neon atau internet bermasalah lama
Kasir tetap bisa menjual offline (antrean lokal). Jangan hapus data browser
dan jangan logout. Setelah layanan pulih, buka aplikasi dan tunggu sinkron.
Periksa transaksi berstatus gagal atau konflik, lalu tinjau satu per satu.

### F. Setelah restore database
Transaksi yang sudah tersinkron lalu hilang karena restore TIDAK ada lagi di
perangkat (antrean lokal sudah dibersihkan setelah sinkron). Bandingkan dengan
struk/catatan kas pada rentang waktu antara titik restore dan kejadian, lalu
input ulang secara manual jika perlu.

## 4. Rutinitas

- Harian: pastikan tidak ada antrean sinkron tertunda di tiap perangkat sebelum
  tutup toko; cek transaksi konflik/gagal; cocokkan kas fisik dengan laporan.
- Mingguan: pastikan dump terbaru tersimpan dan bisa dibuka.
- Bulanan: uji pemulihan (di bawah).
- Setiap rilis: ikuti bagian 2 jika ada migrasi.

## 5. Uji pemulihan (wajib dilakukan berkala)

1. Buat branch Neon baru dari titik beberapa jam lalu, atau restore dump ke
   database kosong:

       pg_restore --no-owner --dbname="<DATABASE_URL_DB_KOSONG>" pos-backup-YYYYMMDD-HHMM.dump

2. Arahkan aplikasi lokal ke database itu dan cek: login, katalog, stok,
   riwayat penjualan, dan laporan harian sama dengan yang diharapkan.
3. Catat berapa lama pemulihan memakan waktu dan apa yang tersendat.