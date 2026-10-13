const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export const formatRupiah = (amount: number) => rupiah.format(amount);

export const formatDateTime = (value: Date | string) =>
  dateTime.format(new Date(value));

export const formatReceiptNo = (no: number) =>
  `#${String(no).padStart(6, "0")}`;

export function variantLabel(size: string | null, color: string | null) {
  const parts = [size, color].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
}