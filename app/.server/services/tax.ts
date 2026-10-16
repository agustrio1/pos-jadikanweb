// ---------------------------------------------------------------------------
// PPN 11% (inklusif)
//
// Harga katalog dianggap sudah termasuk PPN. Karena itu "total" tidak berubah;
// PPN hanya dipecah keluar dari total untuk keperluan pelaporan:
//   tax = round(total_netto × 11 / 111)
// dengan total_netto = jumlah kotor (setelah potongan diskon) barang taxable.
// ---------------------------------------------------------------------------

export const TAX_RATE_PCT = 11;

// Bagian pajak dari sejumlah harga kotor yang sudah inklusif PPN.
export function inclusiveTax(grossNet: number): number {
  return Math.round((grossNet * TAX_RATE_PCT) / (100 + TAX_RATE_PCT));
}

type TaxableLine = {
  variantId: string;
  lineTotal: number;
  taxable: boolean;
};

// Mengalokasikan diskon secara proporsional ke tiap baris, lalu menjumlahkan
// baris taxable (sesudah potongan diskon) sebagai dasar PPN inklusif. Sisa
// pembulatan diberikan ke baris terakhir supaya total alokasi = discountAmount.
// Urutan ditentukan (berdasarkan variantId) agar hasil stabil & dapat direplikasi.
export function computeTaxAmount(
  lines: TaxableLine[],
  subtotal: number,
  discountAmount: number,
): number {
  if (subtotal <= 0 || lines.length === 0) return 0;
  const sorted = [...lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );
  let allocated = 0;
  let taxBase = 0;
  for (let i = 0; i < sorted.length; i++) {
    const line = sorted[i] as TaxableLine;
    const share =
      i === sorted.length - 1
        ? discountAmount - allocated
        : Math.floor((discountAmount * line.lineTotal) / subtotal);
    allocated += share;
    if (line.taxable) taxBase += line.lineTotal - share;
  }
  return inclusiveTax(Math.max(taxBase, 0));
}
