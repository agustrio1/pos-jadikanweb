// Impor dari subpath browser: eksen "types"/"import" bersih untuk TS, dan
// toSVG murni (tanpa DOM) sehingga tetap aman saat SSR.
import { toSVG } from "bwip-js/browser";
import { useMemo } from "react";

// Menghasilkan barcode Code128 sebagai SVG (murni, tanpa skrip) memakai bwip-js.
// Dipakai untuk cetak label; aman dirender di server maupun klien.
type BarcodeProps = {
  // Nilai yang dikodekan (barcode atau SKU).
  value: string;
  // Tinggi batang dalam milimeter (konvensi bwip-js).
  height?: number;
  className?: string;
};

// Cek apakah nilai layak dirender sebagai EAN-13: 12 digit, atau 13 digit
// dengan digit periksa yang cocok. Selain itu pakai Code128 (alfanumerik).
function looksEan13(value: string): boolean {
  if (/^\d{12}$/.test(value)) return true;
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = value.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10 === value.charCodeAt(12) - 48;
}

export function Barcode({ value, height = 12, className }: BarcodeProps) {
  const svg = useMemo(() => {
    const text = (value ?? "").trim();
    if (!text) return null;
    try {
      const bcid = looksEan13(text) ? "ean13" : "code128";
      const opts = {
        bcid,
        text,
        height,
        scale: 2,
        includetext: false,
        paddingwidth: 1,
      };
      return toSVG(opts);
    } catch {
      // Nilai tak dapat dikodekan (mis. karakter di luar ASCII) -> lewati.
      return null;
    }
  }, [value, height]);

  if (!svg) {
    return (
      <span className="text-xs text-muted-foreground">tanpa kode</span>
    );
  }

  return (
    <div
      className={`[&_svg]:block [&_svg]:h-auto [&_svg]:w-full ${className ?? ""}`}
      // SVG dari bwip-js hanya berisi elemen gambar, tidak ada event/skrip.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
