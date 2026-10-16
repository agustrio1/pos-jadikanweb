import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "~/components/page-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
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
import { formatDateTime, formatReceiptNo, formatRupiah } from "~/lib/format";
import { getMeta } from "~/lib/offline/db";
import { saveOfflineReturn } from "~/lib/offline/outbox";
import { flushOutbox } from "~/lib/offline/sync-engine";
import type { OutboxItem, OutboxSale, SessionUser } from "~/lib/offline/types";
import { useOnline } from "~/lib/offline/use-online";
import { useOutbox } from "~/lib/offline/use-outbox";

export function meta() {
  return [{ title: "Retur offline | POS JadikanWeb" }];
}

// Daftar penjualan yang dibuat di perangkat ini (baris outbox ber-kind "sale").
// Saat offline hanya transaksi inilah yang bisa diretur karena riwayat penjualan
// lain ada di server dan tidak tersedia di perangkat.
export default function ReturOffline() {
  const online = useOnline();
  const { rows } = useOutbox();
  const [cashier, setCashier] = useState<SessionUser | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getMeta<SessionUser>("user")
      .then((u) => setCashier(u ?? null))
      .catch(() => setCashier(null));
  }, []);

  const isAdmin = cashier?.role === "admin";

  const targets = useMemo(
    () => rows.filter((row) => row.kind !== "return"),
    [rows],
  );

  const selected = targets.find((row) => row.clientId === selectedId) ?? null;

  // Sisa yang masih bisa diretur per varian = terjual - sudah diretur perangkat ini.
  const returnedOf = (variantId: string) => {
    if (!selected) return 0;
    let total = 0;
    for (const r of rows) {
      if (r.kind === "return" && r.saleClientId === selected.clientId) {
        for (const it of r.items) {
          if (it.variantId === variantId) total += it.qty;
        }
      }
    }
    return total;
  };

  const remainingFor = (item: OutboxItem) => item.qty - returnedOf(item.variantId);

  const choose = (clientId: string) => {
    setSelectedId(clientId);
    setQty({});
    setMessage(null);
    setError(null);
  };

  const setLine = (variantId: string, value: number, max: number) => {
    const clamped = Math.min(Math.max(Math.floor(value) || 0, 0), max);
    setQty((current) => ({ ...current, variantId: clamped }));
  };

  const chosenLines = selected
    ? selected.items.filter((item) => (qty[item.variantId] ?? 0) > 0)
    : [];
  const allSelected =
    chosenLines.length > 0 &&
    chosenLines.length ===
      selected?.items.filter((item) => remainingFor(item) > 0).length &&
    chosenLines.every((item) => (qty[item.variantId] ?? 0) === remainingFor(item));

  const canSubmit =
    isAdmin && selected !== null && chosenLines.length > 0 && !allSelected &&
    reason.trim().length >= 3 && !saving;

  const submit = async () => {
    if (!selected || !canSubmit) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const items: OutboxItem[] = chosenLines.map((item) => ({
        ...item,
        qty: qty[item.variantId] ?? 0,
      }));
      await saveOfflineReturn({
        clientId: crypto.randomUUID(),
        storeId: cashier?.storeId ?? selected.storeId,
        cashierName: cashier?.name ?? "-",
        saleClientId: selected.clientId,
        targetSaleId: null,
        reason: reason.trim(),
        items,
      });
      // Bila sedang online, kirim segera; bila offline, menunggu siklus berikutnya.
      const flush = await flushOutbox({ manual: true });
      setMessage(
        flush.ok
          ? "Retur tersimpan di perangkat dan masuk antrean sinkronisasi."
          : `Retur tersimpan, tetapi belum terkirim: ${flush.message}`,
      );
      setQty({});
      setReason("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan retur ke perangkat.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Retur offline"
        description="Retur sebagian untuk transaksi yang dibuat di perangkat ini. Uang dikembalikan dihitung server saat tersinkron."
        actions={
          <Button variant="outline" asChild>
            <Link to="/kasir">Kembali ke kasir</Link>
          </Button>
        }
      />

      {!isAdmin ? (
        <Alert variant="destructive">
          <AlertDescription>
            Retur hanya dapat dilakukan akun admin. Masuk sebagai admin untuk
            melanjutkan.
          </AlertDescription>
        </Alert>
      ) : null}

      {!online ? (
        <Alert>
          <AlertDescription>
            Anda sedang offline. Retur disimpan di perangkat dan dikirim ke
            server saat koneksi kembali.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Pilih transaksi</CardTitle>
            <CardDescription>
              Transaksi pada perangkat ini yang dapat diretur.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {targets.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                Belum ada transaksi di perangkat ini.
              </p>
            ) : (
              <ul className="divide-y">
                {targets.map((row) => (
                  <li key={row.clientId}>
                    <button
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => choose(row.clientId)}
                      className={`flex w-full flex-col items-start gap-1 p-4 text-left transition hover:bg-accent disabled:cursor-not-allowed ${
                        row.clientId === selectedId ? "bg-accent" : ""
                      }`}
                    >
                      <span className="font-medium">
                        {row.receiptNo
                          ? formatReceiptNo(row.receiptNo)
                          : row.tempNo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(row.soldAt)} ·{" "}
                        {row.items.reduce((sum, i) => sum + i.qty, 0)} barang ·{" "}
                        {formatRupiah(row.total)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Item diretur</CardTitle>
            <CardDescription>
              {selected
                ? `${selected.receiptNo ? formatReceiptNo(selected.receiptNo) : selected.tempNo} · ${formatDateTime(selected.soldAt)}`
                : "Pilih transaksi di samping."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Belum ada transaksi terpilih.
              </p>
            ) : (
              <>
                <ul className="divide-y">
                  {selected.items.map((item) => {
                    const remaining = remainingFor(item);
                    const max = Math.max(remaining, 0);
                    return (
                      <li key={item.variantId} className="space-y-2 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 text-sm">
                            <p className="truncate font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.label ? `${item.label} · ` : ""}
                              {formatRupiah(item.unitPrice)}
                            </p>
                          </div>
                          <Badge variant={max === 0 ? "secondary" : "outline"}>
                            {max === 0 ? "Habis diretur" : `Sisa ${max}`}
                          </Badge>
                        </div>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={max}
                          disabled={max === 0 || !isAdmin}
                          value={qty[item.variantId] ?? 0}
                          onChange={(e) =>
                            setLine(
                              item.variantId,
                              Number(e.target.value),
                              max,
                            )
                          }
                          className="h-8 w-24"
                          aria-label={`Jumlah retur ${item.name}`}
                        />
                      </li>
                    );
                  })}
                </ul>

                <div className="space-y-1.5">
                  <Label htmlFor="reason">Alasan retur</Label>
                  <Input
                    id="reason"
                    value={reason}
                    maxLength={200}
                    disabled={!isAdmin}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Mis. produk rusak"
                  />
                </div>

                {allSelected ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Seluruh item terpilih untuk diretur. Untuk pembatalan penuh
                      gunakan fitur pembatalan saat online.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                {message ? (
                  <Alert>
                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="button"
                  className="w-full"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                  onSubmit={(event) => event.preventDefault()}
                >
                  {saving ? "Menyimpan..." : "Simpan retur"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
