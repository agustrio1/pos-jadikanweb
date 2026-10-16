import { data, Form, Link, redirect, useFetcher } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/opname";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { listVariants } from "~/.server/services/catalog";
import {
  cancelStockCount,
  createStockCount,
  finalizeStockCount,
  getStockCount,
  listStockCounts,
  setStockCountItem,
} from "~/.server/services/stockCounts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatDateTime, variantLabel } from "~/lib/format";
import {
  describeZodError,
  stockCountItemSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Opname | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");

  if (idParam && z.uuid().safeParse(idParam).success) {
    const [count, variants] = await withDb((db) =>
      Promise.all([
        getStockCount(db, { businessId: user.businessId, id: idParam }),
        listVariants(db, { businessId: user.businessId, storeId }),
      ]),
    );
    if (!count) throw new Response("Dokumen opname tidak ditemukan", { status: 404 });
    return { view: "detail" as const, count, variants };
  }

  const rows = await withDb((db) =>
    listStockCounts(db, { businessId: user.businessId, storeId }),
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
      const id = await withDb((db) =>
        createStockCount(db, actor, {
          note: String(form.get("note") ?? ""),
        }),
      );
      return redirect(`/opname?id=${id}`);
    }

    if (intent === "setItem") {
      const counted = form.get("countedQty");
      if (counted === null || counted === "") {
        return data({ error: "Isi jumlah hitung." }, { status: 400 });
      }
      const parsed = stockCountItemSchema.safeParse({
        countId: String(form.get("countId") ?? ""),
        variantId: String(form.get("variantId") ?? ""),
        countedQty: counted,
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) => setStockCountItem(db, actor, parsed.data));
      return { ok: true as const };
    }

    if (intent === "finalize") {
      const id = String(form.get("id") ?? "");
      await withDb((db) => finalizeStockCount(db, actor, id));
      return redirect(`/opname?id=${id}`);
    }

    if (intent === "cancel") {
      const id = String(form.get("id") ?? "");
      await withDb((db) => cancelStockCount(db, actor, id));
      return redirect(`/opname?id=${id}`);
    }

    return data({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    return actionErrorFrom(err, "Data opname bentrok.");
  }
}

function statusBadge(status: string) {
  if (status === "finalized") return <Badge>Difinalisasi</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">Dibatalkan</Badge>;
  return <Badge variant="secondary">Terbuka</Badge>;
}

export default function Opname(props: Route.ComponentProps) {
  const { loaderData, actionData } = props;
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Opname stok"
        description="Hitung stok fisik, lalu finalisasi untuk mencatat selisih sebagai koreksi stok."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loaderData.view === "detail" ? (
        <Detail count={loaderData.count} variants={loaderData.variants} />
      ) : (
        <List rows={loaderData.rows} />
      )}
    </div>
  );
}

type ListRow = Extract<Route.ComponentProps["loaderData"], { view: "list" }>["rows"][number];

function List({ rows }: { rows: ListRow[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Mulai opname baru</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="create" />
            <div className="min-w-40 flex-1 space-y-1.5">
              <label htmlFor="note" className="text-sm font-medium">
                Catatan (opsional)
              </label>
              <Input id="note" name="note" maxLength={200} />
            </div>
            <Button type="submit">Buat dokumen</Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dokumen opname</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Belum ada dokumen opname.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>Petugas</TableHead>
                  <TableHead className="text-right">Baris</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to={`/opname?id=${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {formatDateTime(r.createdAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.createdByName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.itemCount}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type DetailData = Extract<Route.ComponentProps["loaderData"], { view: "detail" }>;
type VariantRow = DetailData["variants"][number];

function Detail({ count, variants }: { count: NonNullable<DetailData["count"]>; variants: VariantRow[] }) {
  const editable = count.status === "open";
  const countedByVariant = new Map(
    count.items.map((i) => [i.variantId, i.countedQty]),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            Opname {formatDateTime(count.createdAt)}
          </h2>
          {statusBadge(count.status)}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/opname">Kembali</Link>
        </Button>
      </div>

      {count.note ? (
        <p className="text-sm text-muted-foreground">Catatan: {count.note}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Hitungan fisik</CardTitle>
          <CardDescription>
            Masukkan jumlah hasil hitung per produk. Stok saat ini tampil sebagai
            referensi; selisih dihitung saat disimpan.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {variants.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Tidak ada produk aktif.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Stok sistem</TableHead>
                  <TableHead className="w-32 text-right">Dihitung</TableHead>
                  <TableHead className="w-24 text-right">Selisih</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v) => (
                  <CountRow
                    key={v.variantId}
                    variant={v}
                    countId={count.id}
                    editable={editable}
                    savedCounted={countedByVariant.get(v.variantId)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Form method="post">
            <input type="hidden" name="id" value={count.id} />
            <Button type="submit" name="intent" value="finalize">
              Finalisasi opname
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="id" value={count.id} />
            <Button type="submit" name="intent" value="cancel" variant="outline">
              Batalkan
            </Button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}

function CountRow({
  variant,
  countId,
  editable,
  savedCounted,
}: {
  variant: VariantRow;
  countId: string;
  editable: boolean;
  savedCounted: number | undefined;
}) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const label = variantLabel(variant.size, variant.color);
  const error =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  return (
    <TableRow>
      <TableCell className="font-medium">
        {variant.productName}
        {label ? (
          <span className="font-normal text-muted-foreground"> · {label}</span>
        ) : null}
        <span className="block text-xs font-normal text-muted-foreground">
          {variant.sku}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{variant.qty}</TableCell>
      <TableCell>
        <fetcher.Form method="post" className="flex items-center justify-end gap-1">
          <input type="hidden" name="intent" value="setItem" />
          <input type="hidden" name="countId" value={countId} />
          <input type="hidden" name="variantId" value={variant.variantId} />
          <Input
            name="countedQty"
            type="number"
            min={0}
            inputMode="numeric"
            disabled={!editable}
            defaultValue={savedCounted ?? ""}
            placeholder={String(variant.qty)}
            aria-label={`Jumlah dihitung ${variant.productName}`}
            className="h-8 w-24 text-right"
            required
          />
          <Button type="submit" size="sm" variant="outline" disabled={!editable || busy}>
            Simpan
          </Button>
        </fetcher.Form>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {savedCounted === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={
              savedCounted - variant.qty > 0
                ? "text-emerald-600"
                : savedCounted - variant.qty < 0
                  ? "text-destructive"
                  : ""
            }
          >
            {savedCounted - variant.qty > 0 ? "+" : ""}
            {savedCounted - variant.qty}
          </span>
        )}
      </TableCell>
      <TableCell />
    </TableRow>
  );
}
