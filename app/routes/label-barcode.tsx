import { HugeiconsIcon } from "@hugeicons/react";
import { BarCode01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import type { Route } from "./+types/label-barcode";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { listVariants } from "~/.server/services/catalog";
import { backfillMissingBarcodes } from "~/.server/services/barcodes";
import { Barcode } from "~/components/barcode";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { formatRupiah, variantLabel } from "~/lib/format";

export function meta() {
  return [{ title: "Label Barcode | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  const rows = await withDb((db) =>
    listVariants(db, {
      businessId: user.businessId,
      storeId,
      q: q || undefined,
    }),
  );

  return { rows, q };
}

// Isi otomatis barcode EAN-13 untuk semua varian milik bisnis yang belum punya.
export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const form = await request.formData();
  if (form.get("intent") === "backfill") {
    const backfilled = await withDb((db) =>
      backfillMissingBarcodes(db, user.businessId),
    );
    return { backfilled };
  }
  return { backfilled: 0 };
}

type Row = Route.ComponentProps["loaderData"]["rows"][number];

// Preset ukuran label: lebar kartu, tinggi batang (mm), kelas grid, dan ukuran teks.
const SIZES = {
  kecil: {
    label: "Kecil",
    barHeight: 10,
    grid: "grid-cols-3 sm:grid-cols-4",
    card: "w-[46mm] p-2",
    text: "text-[9px]",
    name: "text-[10px]",
  },
  sedang: {
    label: "Sedang",
    barHeight: 14,
    grid: "grid-cols-2 sm:grid-cols-3",
    card: "w-[60mm] p-3",
    text: "text-[11px]",
    name: "text-xs",
  },
  besar: {
    label: "Besar",
    barHeight: 18,
    grid: "grid-cols-1 sm:grid-cols-2",
    card: "w-[90mm] p-4",
    text: "text-xs",
    name: "text-sm",
  },
} as const;

type SizeKey = keyof typeof SIZES;
type Source = "barcode" | "sku";

// Batasi jumlah sticker agar halaman tetap responsif.
const MAX_LABELS = 600;

// Nilai yang dikodekan: sumber pilihan, jatuh ke sumber lain bila kosong.
function codeFor(row: Row, source: Source) {
  return source === "sku"
    ? row.sku || row.barcode || ""
    : row.barcode || row.sku || "";
}

export default function LabelBarcode({ loaderData }: Route.ComponentProps) {
  const { rows, q } = loaderData;
  const backfillFetcher = useFetcher<typeof action>();

  // Simpan snapshot baris agar pilihan tetap ada walau pencarian berubah.
  const [selected, setSelected] = useState<
    Record<string, { qty: number; row: Row }>
  >({});
  const [size, setSize] = useState<SizeKey>("sedang");
  const [source, setSource] = useState<Source>("barcode");
  const [showPrice, setShowPrice] = useState(true);

  const inc = (row: Row) =>
    setSelected((cur) => {
      const prev = cur[row.variantId];
      return {
        ...cur,
        [row.variantId]: { qty: (prev?.qty ?? 0) + 1, row },
      };
    });

  const dec = (id: string) =>
    setSelected((cur) => {
      const prev = cur[id];
      if (!prev) return cur;
      const qty = prev.qty - 1;
      const next = { ...cur };
      if (qty <= 0) delete next[id];
      else next[id] = { ...prev, qty };
      return next;
    });

  // Rentang sticker: tiap varian diulang sebanyak qty.
  const printList = useMemo(() => {
    const out: { key: string; row: Row; code: string }[] = [];
    for (const entry of Object.values(selected)) {
      const code = codeFor(entry.row, source);
      for (let i = 0; i < entry.qty; i++) {
        if (out.length >= MAX_LABELS) break;
        out.push({ key: `${entry.row.variantId}-${i}`, row: entry.row, code });
      }
    }
    return out;
  }, [selected, source]);

  const totalLabels = printList.length;
  const selectedCount = Object.keys(selected).length;
  const preset = SIZES[size];

  return (
    <div className="mx-auto max-w-6xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          @page { margin: 8mm; }
        }
      `}</style>

      <PageHeader
        title="Label Barcode"
        description="Pilih produk, tentukan jumlah, lalu cetak sticker barcode Code128."
      />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Pemilih produk */}
        <div className="space-y-3">
          <Form method="get" className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Cari nama, SKU, atau barcode"
              className="pl-9"
            />
          </Form>

          <Card className="max-h-[60vh] overflow-auto p-0">
            <ul className="divide-y">
              {rows.length === 0 ? (
                <li className="p-8 text-center text-sm text-muted-foreground">
                  Tidak ada produk aktif.
                </li>
              ) : (
                rows.map((row) => {
                  const qty = selected[row.variantId]?.qty ?? 0;
                  const label = variantLabel(row.size, row.color);
                  const code = codeFor(row, source);
                  return (
                    <li
                      key={row.variantId}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {row.productName}
                          {label ? (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {label}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.sku}
                          {row.barcode ? ` · ${row.barcode}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {qty > 0 ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => dec(row.variantId)}
                              aria-label="Kurangi"
                            >
                              −
                            </Button>
                            <Badge variant="secondary" className="min-w-8">
                              {qty}
                            </Badge>
                          </>
                        ) : null}
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => inc(row)}
                          aria-label="Tambah"
                          disabled={!code}
                          title={code ? undefined : "Tidak ada barcode/SKU"}
                        >
                          +
                        </Button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </Card>
        </div>

        {/* Pengaturan & pratinjau */}
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap gap-4">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Ukuran</span>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value as SizeKey)}
                  className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(SIZES).map(([key, v]) => (
                    <option key={key} value={key}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Kode dari</span>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as Source)}
                  className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="barcode">Barcode (fallback SKU)</option>
                  <option value="sku">SKU (fallback Barcode)</option>
                </select>
              </label>

              <label className="flex items-center gap-2 self-end text-sm pb-1">
                <input
                  type="checkbox"
                  checked={showPrice}
                  onChange={(e) => setShowPrice(e.target.checked)}
                  className="size-4"
                />
                Tampilkan harga
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {selectedCount} varian · {totalLabels} sticker
                {totalLabels >= MAX_LABELS ? " (dibatasi)" : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected({})}
                  disabled={selectedCount === 0}
                >
                  Bersihkan
                </Button>
                <Button onClick={() => window.print()} disabled={totalLabels === 0}>
                  <HugeiconsIcon icon={BarCode01Icon} size={16} className="mr-2" />
                  Cetak
                </Button>
              </div>
            </div>

            <Separator />

            {/* Isi otomatis barcode EAN-13 untuk varian yang belum punya. */}
            <backfillFetcher.Form method="post">
              <input type="hidden" name="intent" value="backfill" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Varian tanpa barcode dapat dibuatkan kode EAN-13 otomatis.
                </p>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={backfillFetcher.state !== "idle"}
                >
                  {backfillFetcher.state !== "idle"
                    ? "Membuatkan..."
                    : "Buatkan untuk yang kosong"}
                </Button>
              </div>
            </backfillFetcher.Form>

            {backfillFetcher.data && backfillFetcher.data.backfilled > 0 ? (
              <p className="text-sm text-emerald-600">
                {backfillFetcher.data.backfilled} varian dibuatkan barcode. Muat
                ulang untuk melihatnya.
              </p>
            ) : null}
          </Card>

          {totalLabels === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Belum ada yang dipilih. Tambahkan sticker dari daftar produk di{" "}
              <Link to="/produk" className="underline">
                Katalog
              </Link>
              .
            </Card>
          ) : (
            <div
              id="print-area"
              className={`grid gap-2 ${preset.grid}`}
            >
              {printList.map(({ key, row, code }) => {
                const label = variantLabel(row.size, row.color);
                return (
                  <div
                    key={key}
                    className={`inline-flex flex-col items-center gap-1 border ${preset.card}`}
                  >
                    <p className={`line-clamp-2 text-center font-medium ${preset.name}`}>
                      {row.productName}
                      {label ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {label}
                        </span>
                      ) : null}
                    </p>
                    {showPrice ? (
                      <p className={preset.text}>{formatRupiah(row.sellPrice)}</p>
                    ) : null}
                    <Barcode value={code} height={preset.barHeight} />
                    <p className={`font-mono ${preset.text}`}>{code}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
