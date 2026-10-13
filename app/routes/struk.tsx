import { data, Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/struk";
import { requireAdminStore } from "~/.server/auth/guards";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { getReceipt } from "~/.server/services/sales";
import { getVoidInfo, voidSale } from "~/.server/services/void-sale";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDateTime, formatReceiptNo, formatRupiah } from "~/lib/format";

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
    return { receipt, voidInfo };
  });

  if (!result) throw new Response("Struk tidak ditemukan", { status: 404 });
  return {
    ...result.receipt,
    voidInfo: result.voidInfo,
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
  const parsed = voidSchema.safeParse({ reason: form.get("reason") ?? "" });
  if (!parsed.success) {
    return data(
      { error: "Isi alasan pembatalan (minimal 3 karakter)." },
      { status: 400 },
    );
  }

  try {
    await withDb((db) =>
      voidSale(
        db,
        { businessId: user.businessId, storeId, userId: user.id },
        { saleId: id.data, reason: parsed.data.reason },
      ),
    );
  } catch (err) {
    return actionErrorFrom(err, "Gagal membatalkan transaksi.");
  }

  return { ok: true as const };
}

export default function Struk({ loaderData, actionData }: Route.ComponentProps) {
  const { sale, items, payment, voidInfo, isAdmin } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

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