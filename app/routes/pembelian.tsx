import { useMemo, useState } from "react";
import { data, Form, Link, redirect, useFetcher } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/pembelian";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { listVariants } from "~/.server/services/catalog";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
} from "~/.server/services/purchases";
import { listSupplierOptions } from "~/.server/services/suppliers";
import { PageHeader } from "~/components/page-header";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatDateTime, formatRupiah, variantLabel } from "~/lib/format";
import {
  describeZodError,
  parseJson,
  purchaseOrderInputSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Pembelian | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");

  if (idParam && z.uuid().safeParse(idParam).success) {
    const po = await withDb((db) =>
      getPurchaseOrder(db, { businessId: user.businessId, id: idParam }),
    );
    if (!po) throw new Response("PO tidak ditemukan", { status: 404 });
    return { view: "detail" as const, po };
  }

  if (url.searchParams.get("baru") === "1") {
    const [suppliers, variants] = await withDb((db) =>
      Promise.all([
        listSupplierOptions(db, { businessId: user.businessId }),
        listVariants(db, { businessId: user.businessId, storeId }),
      ]),
    );
    return { view: "baru" as const, suppliers, variants };
  }

  const rows = await withDb((db) =>
    listPurchaseOrders(db, { businessId: user.businessId, storeId }),
  );
  return { view: "list" as const, rows };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const actor = { businessId: user.businessId, storeId, userId: user.id };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "create") {
      const parsed = purchaseOrderInputSchema.safeParse({
        supplierId: String(form.get("supplierId") ?? ""),
        note: String(form.get("note") ?? ""),
        items: parseJson(form.get("items")) ?? [],
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      const id = await withDb((db) =>
        createPurchaseOrder(db, actor, parsed.data),
      );
      return redirect(`/pembelian?id=${id}`);
    }

    if (intent === "receive") {
      const id = String(form.get("id") ?? "");
      await withDb((db) => receivePurchaseOrder(db, actor, id));
      return redirect(`/pembelian?id=${id}`);
    }

    if (intent === "cancel") {
      const id = String(form.get("id") ?? "");
      await withDb((db) => cancelPurchaseOrder(db, actor, id));
      return redirect(`/pembelian?id=${id}`);
    }

    return data({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    return actionErrorFrom(err, "Data pembelian bentrok.");
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  received: "Diterima",
  cancelled: "Dibatalkan",
};

function statusBadge(status: string) {
  if (status === "received") return <Badge>Diterima</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">Dibatalkan</Badge>;
  return <Badge variant="secondary">Draf</Badge>;
}

export default function Pembelian(props: Route.ComponentProps) {
  const { loaderData, actionData } = props;
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pembelian"
        description="Buat purchase order ke pemasok, lalu terima barang untuk menambah stok dan memperbarui harga pokok."
        actions={
          <Button asChild>
            <Link to="/pembelian?baru=1">PO baru</Link>
          </Button>
        }
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loaderData.view === "detail" ? (
        <Detail po={loaderData.po} />
      ) : loaderData.view === "baru" ? (
        <NewPo suppliers={loaderData.suppliers} variants={loaderData.variants} />
      ) : (
        <List rows={loaderData.rows} />
      )}
    </div>
  );
}

type ListRow = Extract<
  Route.ComponentProps["loaderData"],
  { view: "list" }
>["rows"][number];

function List({ rows }: { rows: ListRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar purchase order</CardTitle>
        <CardDescription>Urut terbaru.</CardDescription>
      </CardHeader>
      <CardContent className="p-0 pt-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            Belum ada purchase order.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. PO</TableHead>
                <TableHead>Pemasok</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((po) => (
                <TableRow key={po.id}>
                  <TableCell>
                    <Link
                      to={`/pembelian?id=${po.id}`}
                      className="font-medium hover:underline"
                    >
                      {po.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{po.supplierName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {po.itemCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(po.totalCost)}
                  </TableCell>
                  <TableCell>{statusBadge(po.status)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(po.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type DetailPo = Extract<
  Route.ComponentProps["loaderData"],
  { view: "detail" }
>["po"];

function Detail({ po }: { po: NonNullable<DetailPo> }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{po.poNumber}</h2>
        <Button variant="outline" size="sm" asChild>
          <Link to="/pembelian">Kembali</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Pemasok" value={po.supplierName} />
        <Summary label="Total harga beli" value={formatRupiah(po.totalCost)} />
        <Summary label="Status" value={STATUS_LABEL[po.status] ?? po.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item</CardTitle>
          <CardDescription>
            Dibuat {formatDateTime(po.createdAt)} oleh {po.createdByName ?? "—"}
            {po.receivedAt ? ` · diterima ${formatDateTime(po.receivedAt)}` : ""}
            {po.note ? ` · ${po.note}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Harga beli</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((it) => {
                const label = variantLabel(it.size, it.color);
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">
                      {it.productName}
                      {label ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {label}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.sku}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(it.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(it.lineTotal)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {po.status === "draft" ? (
        <fetcher.Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={po.id} />
          <Button type="submit" name="intent" value="receive" disabled={busy}>
            {busy ? "Memproses..." : "Terima barang"}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="cancel"
            variant="outline"
            disabled={busy}
          >
            Batalkan PO
          </Button>
        </fetcher.Form>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

type VariantOption = Extract<
  Route.ComponentProps["loaderData"],
  { view: "baru" }
>["variants"][number];
type SupplierOption = Extract<
  Route.ComponentProps["loaderData"],
  { view: "baru" }
>["suppliers"][number];

type Line = { variantId: string; qty: number; unitCost: number };

function NewPo({
  suppliers,
  variants,
}: {
  suppliers: SupplierOption[];
  variants: VariantOption[];
}) {
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");

  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.variantId, v])),
    [variants],
  );

  const addLine = () => {
    const v = variantById.get(pick);
    if (!v || lines.some((l) => l.variantId === v.variantId)) return;
    setLines((cur) => [
      ...cur,
      { variantId: v.variantId, qty: 1, unitCost: v.costPrice ?? 0 },
    ]);
    setPick("");
  };

  const update = (variantId: string, patch: Partial<Line>) =>
    setLines((cur) =>
      cur.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)),
    );

  const remove = (variantId: string) =>
    setLines((cur) => cur.filter((l) => l.variantId !== variantId));

  const total = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
  const canSubmit = supplierId !== "" && lines.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase order baru</CardTitle>
        <CardDescription>
          Pilih pemasok, tambahkan item, dan tentukan harga beli per satuan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="create" />
          <input
            type="hidden"
            name="items"
            value={JSON.stringify(
              lines.map((l) => ({
                variantId: l.variantId,
                qty: Math.floor(l.qty) || 0,
                unitCost: Math.floor(l.unitCost) || 0,
              })),
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplierId">Pemasok</Label>
              <select
                id="supplierId"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                required
              >
                <option value="">— pilih pemasok —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Catatan</Label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="opsional"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1 space-y-1.5">
              <Label htmlFor="pick">Tambah produk</Label>
              <select
                id="pick"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">— pilih varian —</option>
                {variants.map((v) => {
                  const label = variantLabel(v.size, v.color);
                  return (
                    <option key={v.variantId} value={v.variantId}>
                      {v.productName}
                      {label ? ` · ${label}` : ""} ({v.sku})
                    </option>
                  );
                })}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={addLine} disabled={!pick}>
              Tambah item
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada item.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="w-24 text-right">Qty</TableHead>
                    <TableHead className="w-36 text-right">Harga beli</TableHead>
                    <TableHead className="w-32 text-right">Subtotal</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const v = variantById.get(l.variantId);
                    const label = v ? variantLabel(v.size, v.color) : null;
                    return (
                      <TableRow key={l.variantId}>
                        <TableCell className="font-medium">
                          {v?.productName ?? l.variantId}
                          {label ? (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {label}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            inputMode="numeric"
                            value={l.qty}
                            onChange={(e) =>
                              update(l.variantId, { qty: Number(e.target.value) })
                            }
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={l.unitCost}
                            onChange={(e) =>
                              update(l.variantId, {
                                unitCost: Number(e.target.value),
                              })
                            }
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRupiah((Math.floor(l.qty) || 0) * (Math.floor(l.unitCost) || 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => remove(l.variantId)}
                          >
                            Hapus
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total harga beli</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatRupiah(total)}
            </span>
          </div>

          <Button type="submit" disabled={!canSubmit}>
            Simpan PO
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
