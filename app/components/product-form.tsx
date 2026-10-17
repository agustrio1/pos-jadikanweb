import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AlertCircleIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { formatRupiah } from "~/lib/format";

export type VariantRow = {
  key: string;
  id?: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  costPrice: string;
  sellPrice: string;
  initialStock: string;
  minQty: string;
  isActive: boolean;
  qty?: number;
};

export type ProductFormValues = {
  name: string;
  categoryId: string;
  isActive: boolean;
  hasVariants: boolean;
  variants: Omit<VariantRow, "key">[];
};

let counter = 0;
const newKey = () => `v${++counter}`;

const blankRow = (): VariantRow => ({
  key: newKey(),
  sku: "",
  barcode: "",
  size: "",
  color: "",
  costPrice: "0",
  sellPrice: "",
  initialStock: "0",
  minQty: "0",
  isActive: true,
});

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  required,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        Rp
      </span>
      <Input
        id={id}
        type="number"
        min={0}
        inputMode="numeric"
        required={required}
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ProductForm({
  mode,
  categories,
  initial,
  error,
}: {
  mode: "new" | "edit";
  categories: { id: string; name: string }[];
  initial?: ProductFormValues;
  error?: string;
}) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [hasVariants, setHasVariants] = useState(initial?.hasVariants ?? false);
  const [variants, setVariants] = useState<VariantRow[]>(() =>
    initial
      ? initial.variants.map((v) => ({ ...v, key: newKey() }))
      : [blankRow()],
  );
  // Varian yang sedang diambil barcode EAN-13-nya dari server.
  const [genKey, setGenKey] = useState<string | null>(null);

  const visible = hasVariants ? variants : variants.slice(0, 1);

  const patch = (key: string, change: Partial<VariantRow>) =>
    setVariants((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );

  // Ambil satu kode EAN-13 baru dari server lalu isi ke kolom barcode varian.
  const generateBarcode = async (key: string) => {
    setGenKey(key);
    try {
      const res = await fetch("/api/barcode", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { code?: string };
        if (data.code) patch(key, { barcode: data.code });
      }
    } finally {
      setGenKey(null);
    }
  };

  const payload = JSON.stringify({
    name,
    categoryId,
    isActive,
    hasVariants,
    variants: visible.map(({ key: _key, qty: _qty, ...rest }) => rest),
  });

  return (
    <Form method="post" className="mx-auto max-w-3xl space-y-6">
      <input type="hidden" name="payload" value={payload} />

      {error ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} />
          <AlertTitle>Gagal menyimpan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Informasi produk</CardTitle>
          <CardDescription>Nama, kategori, dan status produk.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field id="name" label="Nama produk">
            <Input
              id="name"
              required
              maxLength={120}
              placeholder="Contoh: Kaos Polos Premium"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field id="category" label="Kategori">
            <Select
              value={categoryId || "none"}
              onValueChange={(value) =>
                setCategoryId(value === "none" ? "" : value)
              }
            >
              <SelectTrigger id="category" className="w-full">
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanpa kategori</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="isActive">Produk aktif</Label>
              <p className="text-xs text-muted-foreground">
                Produk nonaktif tidak muncul di kasir.
              </p>
            </div>
            <Switch
              id="isActive"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          {mode === "new" ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="hasVariants">Punya varian</Label>
                <p className="text-xs text-muted-foreground">
                  Aktifkan untuk produk dengan ukuran atau warna berbeda.
                </p>
              </div>
              <Switch
                id="hasVariants"
                checked={hasVariants}
                onCheckedChange={setHasVariants}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {visible.map((row, index) => {
        const cost = Number(row.costPrice) || 0;
        const sell = Number(row.sellPrice) || 0;
        const margin = sell - cost;

        return (
          <Card key={row.key}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>
                    {hasVariants ? `Varian ${index + 1}` : "Harga dan stok"}
                  </CardTitle>
                  {row.id ? (
                    <CardDescription>
                      Stok saat ini{" "}
                      <Badge variant="secondary">{row.qty ?? 0}</Badge>{" "}
                      (ubah lewat halaman Stok)
                    </CardDescription>
                  ) : null}
                </div>

                {row.id ? (
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${row.key}-active`} className="text-sm">
                      Aktif
                    </Label>
                    <Switch
                      id={`${row.key}-active`}
                      checked={row.isActive}
                      onCheckedChange={(checked) =>
                        patch(row.key, { isActive: checked })
                      }
                    />
                  </div>
                ) : hasVariants && visible.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      setVariants((rows) =>
                        rows.filter((r) => r.key !== row.key),
                      )
                    }
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                    Hapus
                  </Button>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id={`${row.key}-sku`} label="SKU">
                <Input
                  id={`${row.key}-sku`}
                  required
                  maxLength={50}
                  value={row.sku}
                  onChange={(e) => patch(row.key, { sku: e.target.value })}
                />
              </Field>
              <Field
                id={`${row.key}-barcode`}
                label="Barcode"
                hint="Kosongkan untuk dibuatkan otomatis saat disimpan, atau klik Buat untuk mengisi sekarang. Bisa juga ditempel dari scanner."
              >
                <div className="flex gap-2">
                  <Input
                    id={`${row.key}-barcode`}
                    maxLength={64}
                    inputMode="numeric"
                    placeholder="EAN-13 otomatis"
                    value={row.barcode}
                    onChange={(e) =>
                      patch(row.key, { barcode: e.target.value })
                    }
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={genKey === row.key}
                    onClick={() => generateBarcode(row.key)}
                  >
                    {genKey === row.key ? "Membuat..." : "Buat"}
                  </Button>
                </div>
              </Field>

              {hasVariants ? (
                <>
                  <Field id={`${row.key}-size`} label="Ukuran">
                    <Input
                      id={`${row.key}-size`}
                      maxLength={30}
                      placeholder="S, M, L, 42"
                      value={row.size}
                      onChange={(e) => patch(row.key, { size: e.target.value })}
                    />
                  </Field>
                  <Field id={`${row.key}-color`} label="Warna">
                    <Input
                      id={`${row.key}-color`}
                      maxLength={30}
                      placeholder="Hitam, Putih"
                      value={row.color}
                      onChange={(e) =>
                        patch(row.key, { color: e.target.value })
                      }
                    />
                  </Field>
                </>
              ) : null}

              <Field id={`${row.key}-cost`} label="Harga beli">
                <MoneyInput
                  id={`${row.key}-cost`}
                  value={row.costPrice}
                  onChange={(value) => patch(row.key, { costPrice: value })}
                />
              </Field>
              <Field
                id={`${row.key}-sell`}
                label="Harga jual"
                hint={
                  sell > 0 ? (
                    <span className={margin < 0 ? "text-destructive" : ""}>
                      Margin {formatRupiah(margin)} (
                      {Math.round((margin / sell) * 100)}%)
                    </span>
                  ) : null
                }
              >
                <MoneyInput
                  id={`${row.key}-sell`}
                  required
                  value={row.sellPrice}
                  onChange={(value) => patch(row.key, { sellPrice: value })}
                />
              </Field>

              {row.id ? null : (
                <Field id={`${row.key}-stock`} label="Stok awal">
                  <Input
                    id={`${row.key}-stock`}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={row.initialStock}
                    onChange={(e) =>
                      patch(row.key, { initialStock: e.target.value })
                    }
                  />
                </Field>
              )}
              <Field
                id={`${row.key}-min`}
                label="Stok minimum"
                hint="Peringatan muncul saat stok sama atau di bawah angka ini."
              >
                <Input
                  id={`${row.key}-min`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={row.minQty}
                  onChange={(e) => patch(row.key, { minQty: e.target.value })}
                />
              </Field>
            </CardContent>
          </Card>
        );
      })}

      {hasVariants ? (
        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          onClick={() => setVariants((rows) => [...rows, blankRow()])}
        >
          <HugeiconsIcon icon={Add01Icon} />
          Tambah varian
        </Button>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Button type="button" variant="outline" asChild>
          <Link to="/produk">Batal</Link>
        </Button>
        <Button type="submit" disabled={busy}>
          {busy
            ? "Menyimpan..."
            : mode === "new"
              ? "Simpan produk"
              : "Simpan perubahan"}
        </Button>
      </div>
    </Form>
  );
}