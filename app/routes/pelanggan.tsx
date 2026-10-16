import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/pelanggan";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import {
  createCustomer,
  getCustomerDetail,
  listCustomers,
  updateCustomer,
} from "~/.server/services/customers";
import { recordDebtPayment } from "~/.server/services/debts";
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
import {
  formatDateTime,
  formatReceiptNo,
  formatRupiah,
} from "~/lib/format";
import {
  customerInputSchema,
  debtPaymentSchema,
  describeZodError,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Pelanggan | POS JadikanWeb" }];
}

const DEBT_METHODS = [
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "debit", label: "Debit" },
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireStoreUser(request);
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");

  if (idParam && z.uuid().safeParse(idParam).success) {
    const detail = await withDb((db) =>
      getCustomerDetail(db, { businessId: user.businessId, id: idParam }),
    );
    if (!detail) throw new Response("Pelanggan tidak ditemukan", { status: 404 });
    return { view: "detail" as const, detail, search: "" };
  }

  const search = (url.searchParams.get("q") ?? "").trim();
  const rows = await withDb((db) =>
    listCustomers(db, {
      businessId: user.businessId,
      search: search || undefined,
    }),
  );
  return { view: "list" as const, rows, search };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireStoreUser(request);
  const scope = { businessId: user.businessId };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "create") {
      const parsed = customerInputSchema.safeParse({
        name: String(form.get("name") ?? ""),
        phone: String(form.get("phone") ?? ""),
        tier: String(form.get("tier") ?? ""),
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      const id = await withDb((db) => createCustomer(db, scope, parsed.data));
      return redirect(`/pelanggan?id=${id}`);
    }

    if (intent === "update") {
      const id = String(form.get("id") ?? "");
      if (!z.uuid().safeParse(id).success) {
        return data({ error: "Pelanggan tidak valid." }, { status: 400 });
      }
      const parsed = customerInputSchema.safeParse({
        name: String(form.get("name") ?? ""),
        phone: String(form.get("phone") ?? ""),
        tier: String(form.get("tier") ?? ""),
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) =>
        updateCustomer(db, scope, { id, ...parsed.data }),
      );
      return { ok: true as const };
    }

    if (intent === "payDebt") {
      const parsed = debtPaymentSchema.safeParse({
        debtId: String(form.get("debtId") ?? ""),
        amount: form.get("amount"),
        method: String(form.get("method") ?? "cash"),
        reference: String(form.get("reference") ?? "").trim() || undefined,
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) =>
        recordDebtPayment(
          db,
          { businessId: user.businessId, userId: user.id },
          parsed.data,
        ),
      );
      return { ok: true as const };
    }

    return data({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    return actionErrorFrom(err, "Gagal memproses pelanggan.");
  }
}

export default function Pelanggan({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <>
      <PageHeader
        title="Pelanggan"
        description="Kelola pelanggan, pantau poin loyalti, dan catat pembayaran piutang."
      />
      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loaderData.view === "detail" ? (
        <Detail detail={loaderData.detail} />
      ) : (
        <List rows={loaderData.rows} search={loaderData.search} />
      )}
    </>
  );
}

function List({
  rows,
  search,
}: {
  rows: Awaited<ReturnType<typeof listCustomers>>;
  search: string;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tambah pelanggan</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="create" />
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="name">Nama</Label>
              <Input id="name" name="name" required maxLength={100} />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="phone">No. HP</Label>
              <Input id="phone" name="phone" maxLength={32} />
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="tier">Tingkat</Label>
              <Input id="tier" name="tier" maxLength={40} placeholder="opsional" />
            </div>
            <Button type="submit">Simpan</Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar pelanggan</CardTitle>
          <CardDescription>
            Klik nama untuk melihat detail, riwayat, dan piutang.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          <Form method="get" className="px-6 pb-3">
            <div className="flex gap-2">
              <Input
                name="q"
                defaultValue={search}
                placeholder="Cari nama atau nomor HP"
                className="max-w-xs"
              />
              <Button type="submit" size="sm" variant="outline">
                Cari
              </Button>
            </div>
          </Form>
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Belum ada pelanggan.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>No. HP</TableHead>
                  <TableHead>Tingkat</TableHead>
                  <TableHead className="text-right">Poin</TableHead>
                  <TableHead className="text-right">Piutang</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        to={`/pelanggan?id=${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.phone ?? "—"}
                    </TableCell>
                    <TableCell>{c.tier ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.points}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.debtBalance > 0 ? (
                        <span className="text-destructive">
                          {formatRupiah(c.debtBalance)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
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

function Detail({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>;
}) {
  const { customer, outstanding, recentSales, openDebts } = detail;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{customer.name}</h2>
        <Button variant="outline" size="sm" asChild>
          <Link to="/pelanggan">Kembali ke daftar</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Poin loyalti" value={String(customer.points)} />
        <Stat
          label="Saldo piutang"
          value={outstanding > 0 ? formatRupiah(outstanding) : "Rp0"}
          tone={outstanding > 0 ? "destructive" : undefined}
        />
        <Stat label="Terdaftar" value={formatDateTime(customer.createdAt)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ubah data</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={customer.id} />
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="d-name">Nama</Label>
              <Input
                id="d-name"
                name="name"
                defaultValue={customer.name}
                required
                maxLength={100}
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="d-phone">No. HP</Label>
              <Input
                id="d-phone"
                name="phone"
                defaultValue={customer.phone ?? ""}
                maxLength={32}
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="d-tier">Tingkat</Label>
              <Input
                id="d-tier"
                name="tier"
                defaultValue={customer.tier ?? ""}
                maxLength={40}
              />
            </div>
            <Button type="submit">Simpan perubahan</Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Piutang terbuka</CardTitle>
          <CardDescription>
            Cicil pembayaran untuk mengurangi saldo. Setiap pembayaran tercatat
            dan menambah jejak audit.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {openDebts.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Tidak ada piutang terbuka.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaksi</TableHead>
                  <TableHead className="text-right">Pokok</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                  <TableHead>Jatuh tempo</TableHead>
                  <TableHead>Bayar cicilan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openDebts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap">
                      {d.saleId ? (
                        <Link
                          to={`/struk/${d.saleId}`}
                          className="hover:underline"
                        >
                          {d.receiptNo ? formatReceiptNo(d.receiptNo) : "Struk"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(d.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(d.balance)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.dueDate ? formatDateTime(d.dueDate) : "—"}
                    </TableCell>
                    <TableCell>
                      <Form method="post" className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="intent" value="payDebt" />
                        <input type="hidden" name="debtId" value={d.id} />
                        <select
                          name="method"
                          defaultValue="cash"
                          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                          aria-label="Metode pembayaran"
                        >
                          {DEBT_METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <Input
                          name="reference"
                          placeholder="Ref. (opsional)"
                          maxLength={64}
                          className="h-8 w-28"
                        />
                        <Input
                          name="amount"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={d.balance}
                          step={1}
                          required
                          placeholder="Nominal"
                          className="h-8 w-28"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Bayar
                        </Button>
                      </Form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat transaksi</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {recentSales.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Belum ada transaksi.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>No</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(s.soldAt)}
                    </TableCell>
                    <TableCell>
                      <Link to={`/struk/${s.id}`} className="hover:underline">
                        {formatReceiptNo(s.receiptNo)}
                      </Link>
                    </TableCell>
                    <TableCell>{s.cashierName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(s.total)}
                    </TableCell>
                    <TableCell>
                      {s.status === "completed" ? (
                        <Badge variant="secondary">Selesai</Badge>
                      ) : (
                        <Badge variant="destructive">Batal</Badge>
                      )}
                    </TableCell>
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "destructive" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
