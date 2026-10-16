import { data, Form, Link, useNavigation } from "react-router";
import { useState } from "react";
import { z } from "zod";
import type { Route } from "./+types/struk";
import { requireAdminStore } from "~/.server/auth/guards";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { getReceipt } from "~/.server/services/sales";
import { listReturns, returnSale } from "~/.server/services/returns";
import { getVoidInfo, voidSale } from "~/.server/services/void-sale";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatDateTime, formatReceiptNo, formatRupiah } from "~/lib/format";
import { parseJson, returnInputSchema, describeZodError } from "~/lib/schemas";

export function meta() {
  return [{ title: "Struk | POS JadikanWeb" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const parsed = z.uuid().safeParse(params.id);
  if (!parsed.success) {
    throw new Response("Struk tidak ditemukan", { status: 404 });
  }

  const result = await withDb(async (db) => {
    const receipt = await getReceipt(db, {
      businessId: user.businessId,
      storeId,
      saleId: parsed.data,
      cashierId: user.role === "admin" ? undefined : user.id,
    });
    if (!receipt) return null;
    const voidInfo =
      receipt.sale.status === "void"
        ? await getVoidInfo(db, {
            businessId: user.businessId,
            storeId,
            saleId: parsed.data,
          })
        : null;
    const returns = await listReturns(db, {
      businessId: user.businessId,
      storeId,
      saleId: parsed.data,
    });
    return { receipt, voidInfo, returns };
  });

  if (!result) throw new Response("Struk tidak ditemukan", { status: 404 });
  return {
    ...result.receipt,
    voidInfo: result.voidInfo,
    returns: result.returns,
    isAdmin: user.role === "admin",
  };
}

const voidSchema = z.object({ reason: z.string().trim().min(3).max(200) });

export async function action({ request, params }: Route.ActionArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const id = z.uuid().safeParse(params.id);
  if (!id.success) {
    throw new Response("Struk tidak ditemukan", { status: 404 });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "void");
  const actor = { businessId: user.businessId, storeId, userId: user.id };

  try {
    if (intent === "return") {
      const parsed = returnInputSchema.safeParse(
        parseJson(form.get("payload")),
      );
      if (!parsed.success) {
        return data(
          { error: describeZodError(parsed.error) },
          { status: 400 },
        );
      }
      // saleId selalu dari path, tidak dipercaya dari payload.
      await withDb((db) =>
        returnSale(db, actor, { ...parsed.data, saleId: id.data }),
      );
      return { ok: true as const };
    }

    const parsed = voidSchema.safeParse({ reason: form.get("reason") ?? "" });
    if (!parsed.success) {
      return data(
        { error: "Isi alasan pembatalan (minimal 3 karakter)." },
        { status: 400 },
      );
    }

    await withDb((db) =>
      voidSale(db, actor, { saleId: id.data, reason: parsed.data.reason }),
    );
  } catch (err) {
    return actionErrorFrom(err, "Gagal memproses transaksi.");
  }

  return { ok: true as const };
}

export default function Struk({ loaderData, actionData }: Route.ComponentProps) {
  const { sale, items, payment, voidInfo, returns, isAdmin } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  // Sisa yang masih bisa diretur per varian =qty terjual - total sudah diretur.
  const returnedByVariant = new Map<string, number>();
  for (const r of returns) {
    returnedByVariant.set(
      r.variantId,
      (returnedByVariant.get(r.variantId) ?? 0) + r.qty,
    );
  }

  return (
    <main className="min-h-dvh bg-muted/40 p-4 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[80mm] flex-wrap gap-2 print:hidden">
        <Button onClick={() => window.print()}>Cetak struk</Button>
        <Button variant="outline" asChild>
          <Link to="/kasir">Transaksi baru</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/penjualan">Riwayat</Link>
        </Button>
      </div>

      {sale.status === "void" && voidInfo ? (
        <p className="mx-auto mb-4 max-w-[80mm] rounded-md border bg-card p-3 text-sm print:hidden">
          Dibatalkan
          {voidInfo.voidedByName ? ` oleh ${voidInfo.voidedByName}` : ""}
          {voidInfo.voidedAt ? ` pada ${formatDateTime(voidInfo.voidedAt)}` : ""}
          {voidInfo.voidReason ? `. Alasan: ${voidInfo.voidReason}` : "."}
        </p>
      ) : null}

      {isAdmin && sale.status === "completed" ? (
        <details
          open={Boolean(error)}
          className="mx-auto mb-4 max-w-[80mm] rounded-md border bg-card p-3 text-sm print:hidden"
        >
          <summary className="cursor-pointer font-medium">
            Batalkan transaksi
          </summary>
          <Form
            method="post"
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              if (
                !window.confirm(
                  "Batalkan transaksi ini? Stok dikembalikan dan tindakan ini tidak bisa diurungkan.",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="void" />
            <p className="text-xs text-muted-foreground">
              Semua item dikembalikan ke stok dan transaksi tidak dihitung di
              laporan.
            </p>
            <Input
              name="reason"
              required
              minLength={3}
              maxLength={200}
              placeholder="Alasan pembatalan"
              aria-label="Alasan pembatalan"
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Memproses..." : "Batalkan transaksi"}
            </Button>
          </Form>
        </details>
      ) : null}

      {isAdmin && sale.status === "completed" ? (
        <ReturnForm
          items={items.map((item) => ({
            variantId: item.variantId,
            name: item.productName,
            label: item.variantLabel,
            unitPrice: item.unitPrice,
            remaining: item.qty - (returnedByVariant.get(item.variantId) ?? 0),
          }))}
          subtotal={sale.subtotal}
          discountAmount={sale.discountAmount}
          busy={busy}
        />
      ) : null}

      {returns.length > 0 ? (
        <div className="mx-auto mb-4 max-w-[80mm] rounded-md border bg-card p-3 text-sm print:hidden">
          <p className="mb-1 font-medium">Retur tercatat</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {returns.map((r) => (
              <li key={r.id}>
                {r.productName}
                {r.variantLabel ? ` (${r.variantLabel})` : ""} ×{r.qty} —{" "}
                {formatRupiah(r.refundAmount)}
                {r.createdByName ? ` · ${r.createdByName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <article className="mx-auto max-w-[80mm] bg-white p-4 font-mono text-xs text-black shadow-sm print:shadow-none">
        <header className="space-y-0.5 text-center">
          <p className="text-sm font-bold">{sale.businessName}</p>
          <p>{sale.storeName}</p>
          {sale.storeAddress ? <p>{sale.storeAddress}</p> : null}
        </header>

        <div className="my-3 space-y-0.5 border-y border-dashed border-black py-2">
          <div className="flex justify-between">
            <span>No</span>
            <span>{formatReceiptNo(sale.receiptNo)}</span>
          </div>
          <div className="flex justify-between">
            <span>Waktu</span>
            <span>{formatDateTime(sale.soldAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kasir</span>
            <span>{sale.cashierName ?? "-"}</span>
          </div>
          {sale.status === "void" ? (
            <>
              <p className="pt-1 text-center font-bold">** DIBATALKAN **</p>
              {voidInfo?.voidReason ? (
                <p className="text-center">{voidInfo.voidReason}</p>
              ) : null}
            </>
          ) : null}
        </div>

        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <p>
                {item.productName}
                {item.variantLabel ? ` (${item.variantLabel})` : ""}
              </p>
              <div className="flex justify-between">
                <span>
                  {item.qty} x {formatRupiah(item.unitPrice)}
                </span>
                <span>{formatRupiah(item.lineTotal)}</span>
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
          {payment ? (
            <>
              <div className="flex justify-between">
                <span>Tunai</span>
                <span>{formatRupiah(payment.tendered)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kembali</span>
                <span>{formatRupiah(payment.changeAmount)}</span>
              </div>
            </>
          ) : null}
        </div>

        <p className="text-center">Terima kasih</p>
      </article>
    </main>
  );
}

type ReturnItem = {
  variantId: string;
  name: string;
  label: string | null;
  unitPrice: number;
  remaining: number;
};

function ReturnForm({
  items,
  subtotal,
  discountAmount,
  busy,
}: {
  items: ReturnItem[];
  subtotal: number;
  discountAmount: number;
  busy: boolean;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");

  const returnable = items.filter((item) => item.remaining > 0);
  const chosen = returnable.filter((item) => (qty[item.variantId] ?? 0) > 0);

  // Perkiraan klien: proporsi (subtotal - diskon) / subtotal terhadap nilai
  // retur. Angka resmi dihitung server (pembulatan per baris bisa berbeda).
  const factor = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
  const estimate = chosen.reduce(
    (sum, item) =>
      sum + Math.round(item.unitPrice * (qty[item.variantId] ?? 0) * factor),
    0,
  );

  const payload = JSON.stringify({
    lines: chosen.map((item) => ({
      variantId: item.variantId,
      qty: qty[item.variantId],
    })),
    reason,
  });

  if (returnable.length === 0) return null;

  return (
    <details className="mx-auto mb-4 max-w-[80mm] rounded-md border bg-card p-3 text-sm print:hidden">
      <summary className="cursor-pointer font-medium">Retur sebagian</summary>
      <Form method="post" className="mt-3 space-y-2">
        <input type="hidden" name="intent" value="return" />
        <input type="hidden" name="payload" value={payload} />
        <p className="text-xs text-muted-foreground">
          Pilih item dan jumlah yang dikembalikan. Stok bertambah dan uang
          dikembalikan proporsional.
        </p>
        <ul className="space-y-2">
          {returnable.map((item) => (
            <li key={item.variantId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {item.label ? ` (${item.label})` : ""} ·{" "}
                {formatRupiah(item.unitPrice)}
                <span className="text-muted-foreground">
                  {" "}
                  (sisa {item.remaining})
                </span>
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={item.remaining}
                value={qty[item.variantId] ?? 0}
                onChange={(e) => {
                  const raw = Number(e.target.value) || 0;
                  const next = Math.min(Math.max(Math.floor(raw), 0), item.remaining);
                  setQty((current) => ({ ...current, [item.variantId]: next }));
                }}
                className="h-8 w-16 text-center"
                aria-label={`Jumlah retur ${item.name}`}
              />
            </li>
          ))}
        </ul>
        <Label htmlFor="retur-reason" className="sr-only">
          Alasan retur
        </Label>
        <Input
          id="retur-reason"
          name="reason"
          required
          minLength={3}
          maxLength={200}
          placeholder="Alasan retur"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Perkiraan dikembalikan: {formatRupiah(estimate)}
          </span>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || chosen.length === 0 || reason.trim().length < 3}
          >
            {busy ? "Memproses..." : "Proses retur"}
          </Button>
        </div>
      </Form>
    </details>
  );
}