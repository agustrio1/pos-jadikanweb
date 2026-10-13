import { formatDateTime, formatRupiah } from "~/lib/format";
import type { OutboxSale } from "~/lib/offline/types";

// Struk sementara. Saat dicetak (window.print), hanya struk ini yang tampil.
export function OfflineReceipt({ sale }: { sale: OutboxSale }) {
  return (
    <>
      <style>{`@media print {
  body * { visibility: hidden !important; }
  .offline-receipt, .offline-receipt * { visibility: visible !important; }
  .offline-receipt { position: absolute; left: 0; top: 0; width: 80mm; box-shadow: none; }
}`}</style>
      <article className="offline-receipt mx-auto max-w-[80mm] bg-white p-4 font-mono text-xs text-black shadow-sm">
        <header className="space-y-0.5 text-center">
          <p className="text-sm font-bold">STRUK SEMENTARA</p>
          <p>Dibuat saat offline</p>
        </header>

        <div className="my-3 space-y-0.5 border-y border-dashed border-black py-2">
          <div className="flex justify-between">
            <span>No</span>
            <span>{sale.tempNo}</span>
          </div>
          <div className="flex justify-between">
            <span>Waktu</span>
            <span>{formatDateTime(sale.soldAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kasir</span>
            <span>{sale.cashierName || "-"}</span>
          </div>
        </div>

        <ul className="space-y-2">
          {sale.items.map((item) => (
            <li key={item.variantId}>
              <p>
                {item.name}
                {item.label ? ` (${item.label})` : ""}
              </p>
              <div className="flex justify-between">
                <span>
                  {item.qty} x {formatRupiah(item.unitPrice)}
                </span>
                <span>{formatRupiah(item.qty * item.unitPrice)}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="my-3 space-y-0.5 border-t border-dashed border-black pt-2">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatRupiah(sale.subtotal)}</span>
          </div>
          {sale.discountAmount > 0 ? (
            <div className="flex justify-between">
              <span>Diskon</span>
              <span>- {formatRupiah(sale.discountAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-sm font-bold">
            <span>Total</span>
            <span>{formatRupiah(sale.total)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tunai</span>
            <span>{formatRupiah(sale.cashReceived)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kembali</span>
            <span>{formatRupiah(sale.change)}</span>
          </div>
        </div>

        <p className="text-center">Terima kasih</p>
        <p className="mt-1 text-center text-[10px]">
          Nomor struk resmi diberikan setelah transaksi tersinkron.
        </p>
      </article>
    </>
  );
}