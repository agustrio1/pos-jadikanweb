import { data, Form } from "react-router";
import type { Route } from "./+types/kas-shift";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import {
  closeShift,
  getActiveShift,
  listShifts,
  openShift,
} from "~/.server/services/shifts";
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
import { formatDateTime, formatRupiah } from "~/lib/format";

export function meta() {
  return [{ title: "Kas & Shift | POS JadikanWeb" }];
}

const MAX_AMOUNT = 2_000_000_000;

// Ambil bilangan Rupiah integer dari field formulir; tolak nilai tak wajar.
function readAmount(form: FormData, key: string): number | null {
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

function readNotes(form: FormData): string | null {
  const text = String(form.get("notes") ?? "").trim();
  return text.length > 0 ? text.slice(0, 200) : null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const actor = { businessId: user.businessId, storeId, userId: user.id };
  const [active, history] = await withDb((db) =>
    Promise.all([getActiveShift(db, actor), listShifts(db, { storeId })]),
  );
  return { active, history, userName: user.name };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const actor = { businessId: user.businessId, storeId, userId: user.id };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "open") {
      const openingFloat = readAmount(form, "openingFloat");
      if (openingFloat === null) {
        return data(
          { error: "Isi uang modal awal dengan angka Rupiah bulat (0 atau lebih)." },
          { status: 400 },
        );
      }
      await withDb((db) =>
        openShift(db, actor, { openingFloat, notes: readNotes(form) }),
      );
    } else if (intent === "close") {
      const shiftId = String(form.get("shiftId") ?? "");
      const countedCash = readAmount(form, "countedCash");
      if (countedCash === null) {
        return data(
          { error: "Isi hasil hitung fisik dengan angka Rupiah bulat (0 atau lebih)." },
          { status: 400 },
        );
      }
      await withDb((db) =>
        closeShift(db, actor, {
          shiftId,
          countedCash,
          notes: readNotes(form),
        }),
      );
    } else {
      return data({ error: "Aksi tidak dikenal." }, { status: 400 });
    }
  } catch (err) {
    return actionErrorFrom(err, "Gagal memproses shift.");
  }

  return { ok: true as const };
}

export default function KasShift({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { active, history } = loaderData;
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <>
      <PageHeader
        title="Kas & Shift"
        description="Buka shift dengan modal awal laci, lalu tutup dengan menghitung uang fisik. Selisih tercatat sebagai pertanggungjawaban kasir."
      />

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {active ? (
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Shift sedang berjalan</CardTitle>
              <Badge>Terbuka</Badge>
            </div>
            <CardDescription>
              Dibuka oleh {active.openedByName ?? "—"} pada{" "}
              {formatDateTime(active.openedAt)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Modal awal" value={formatRupiah(active.openingFloat)} />
              <Stat label="Tunai masuk" value={formatRupiah(active.cashIn)} />
              <Stat label="Tunai keluar (retur)" value={formatRupiah(active.cashOut)} />
              <Stat
                label="Kas perkiraan"
                value={formatRupiah(active.expectedCash)}
                hint="Modal awal + masuk − keluar."
              />
            </div>
            <Form method="post" className="space-y-3 rounded-md border p-4">
              <input type="hidden" name="intent" value="close" />
              <input type="hidden" name="shiftId" value={active.id} />
              <div className="space-y-1.5">
                <Label htmlFor="countedCash">Hitung uang fisik di laci (Rp)</Label>
                <Input
                  id="countedCash"
                  name="countedCash"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="close-notes">Catatan (opsional)</Label>
                <Input
                  id="close-notes"
                  name="notes"
                  maxLength={200}
                  placeholder="Mis. alasan selisih"
                />
              </div>
              <Button type="submit">Tutup shift</Button>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Belum ada shift aktif</CardTitle>
            <CardDescription>
              Buka shift untuk mulai bertanggung jawab atas laci kas di toko ini.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="open" />
              <div className="space-y-1.5">
                <Label htmlFor="openingFloat">Uang modal awal (Rp)</Label>
                <Input
                  id="openingFloat"
                  name="openingFloat"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  defaultValue={0}
                  required
                />
              </div>
              <div className="min-w-40 flex-1 space-y-1.5">
                <Label htmlFor="open-notes">Catatan (opsional)</Label>
                <Input id="open-notes" name="notes" maxLength={200} />
              </div>
              <Button type="submit">Buka shift</Button>
            </Form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Riwayat shift</CardTitle>
          <CardDescription>
            Daftar shift toko ini beserta selisih kas saat penutupan.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-6">
          {history.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Belum ada shift tercatat.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dibuka</TableHead>
                  <TableHead>Ditutup</TableHead>
                  <TableHead>Pelaksana</TableHead>
                  <TableHead className="text-right">Modal</TableHead>
                  <TableHead className="text-right">Perkiraan</TableHead>
                  <TableHead className="text-right">Fisik</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(s.openedAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {s.closedAt ? (
                        formatDateTime(s.closedAt)
                      ) : (
                        <Badge variant="secondary">Terbuka</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {s.openedByName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatRupiah(s.openingFloat)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.expectedCash === null
                        ? "—"
                        : formatRupiah(s.expectedCash)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.countedCash === null ? "—" : formatRupiah(s.countedCash)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.variance === null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            s.variance === 0
                              ? "text-muted-foreground"
                              : s.variance > 0
                                ? "font-medium text-emerald-600"
                                : "font-medium text-destructive"
                          }
                        >
                          {s.variance > 0 ? "+" : ""}
                          {formatRupiah(s.variance)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
