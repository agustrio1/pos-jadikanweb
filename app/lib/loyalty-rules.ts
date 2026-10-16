// ---------------------------------------------------------------------------
// Aturan loyalti (murni, tanpa DB) — dipakai bersama oleh server & perangkat.
//
// - Akumulasi: 1 poin untuk setiap Rp1.000 omzet (pembulatan ke bawah).
// - Penukaran: hanya dalam kelipatan REDEEM_MIN_POINTS; 1 poin = Rp10 diskon.
//
// Angka selalu dihitung ulang & divalidasi di server; nilai di perangkat hanya
// untuk tampilan. Menjadi satu sumber kebenaran agar kasir & backend sepakat.
// ---------------------------------------------------------------------------

export const EARN_RUPIAH_PER_POINT = 1000;
export const REDEEM_MIN_POINTS = 100;
export const REDEEM_RUPIAH_PER_POINT = 10;

// Poin yang diperoleh dari satu transaksi (berdasarkan total akhir).
export function pointsEarned(total: number): number {
  return Math.floor(total / EARN_RUPIAH_PER_POINT);
}

// Menormalisasi permintaan penukaran: bulatkan ke bawah ke kelipatan, batasi
// ke saldo poin. Mengembalikan jumlah poin yang benar-benar dipakai.
export function normalizeRedeemPoints(
  requested: number,
  available: number,
): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const capped = Math.min(Math.floor(requested), Math.max(available, 0));
  if (capped <= 0) return 0;
  return Math.floor(capped / REDEEM_MIN_POINTS) * REDEEM_MIN_POINTS;
}

// Nilai diskon Rupiah dari sejumlah poin (sudah dinormalisasi ke kelipatan).
export function redeemDiscount(points: number): number {
  return points * REDEEM_RUPIAH_PER_POINT;
}
