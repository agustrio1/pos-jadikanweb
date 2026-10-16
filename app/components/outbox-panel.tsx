import { useState } from "react";
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
import { formatDateTime, formatReceiptNo, formatRupiah } from "~/lib/format";
import { retryOne } from "~/lib/offline/outbox";
import { flushOutbox } from "~/lib/offline/sync-engine";
import { CONFLICT_LABEL } from "~/lib/offline/sync-schema";
import type { OutboxStatus } from "~/lib/offline/types";
import { useOnline } from "~/lib/offline/use-online";
import { useOutbox } from "~/lib/offline/use-outbox";

const STATUS_LABEL: Record<OutboxStatus, string> = {
  pending_sync: "Menunggu sinkron",
  syncing: "Menyinkronkan",
  synced: "Tersinkron",
  conflict: "Perlu ditinjau",
  sync_failed: "Gagal sinkron",
};

const STATUS_VARIANT: Record<
  OutboxStatus,
  "secondary" | "destructive" | "outline"
> = {
  pending_sync: "secondary",
  syncing: "secondary",
  synced: "outline",
  conflict: "outline",
  sync_failed: "destructive",
};

export function OutboxPanel({
  limit = 20,
  hideWhenEmpty = false,
}: {
  limit?: number;
  hideWhenEmpty?: boolean;
}) {
  const online = useOnline();
  const { rows, notice, counts } = useOutbox();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (hideWhenEmpty && rows.length === 0) return null;

  const syncAll = async () => {
    setBusy(true);
    const result = await flushOutbox({ manual: true });
    setBusy(false);
    setMessage(
      result.ok
        ? result.sent > 0
          ? `${result.sent} transaksi diproses server.`
          : "Tidak ada transaksi yang perlu dikirim."
        : result.message,
    );
  };

  const retry = async (clientId: string) => {
    await retryOne(clientId);
    await syncAll();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antrean sinkronisasi</CardTitle>
        <CardDescription>
          Transaksi yang dibuat di perangkat ini. Tersimpan di browser dan
          dikirim otomatis saat online.
          {counts.pending + counts.failed > 0
            ? ` ${counts.pending + counts.failed} belum diterima server.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!online || busy}
            onClick={() => void syncAll()}
          >
            {busy ? "Menyinkronkan..." : "Sinkronkan sekarang"}
          </Button>
          {message ? (
            <span className="text-xs text-muted-foreground">{message}</span>
          ) : null}
        </div>

        {notice ? (
          <Alert variant="destructive">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada transaksi offline.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.slice(0, limit).map((row) => (
              <li key={row.clientId} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {row.kind === "return" ? (
                      <Badge variant="outline" className="mr-2">
                        Retur
                      </Badge>
                    ) : null}
                    {row.receiptNo
                      ? `${formatReceiptNo(row.receiptNo)} · ${row.tempNo}`
                      : row.tempNo}
                  </span>
                  <Badge variant={STATUS_VARIANT[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.soldAt)}
                  {row.kind === "return"
                    ? ` · ${row.items.reduce((sum, item) => sum + item.qty, 0)} barang diretur`
                    : ` · ${formatRupiah(row.total)} · ${row.items.reduce(
                        (sum, item) => sum + item.qty,
                        0,
                      )} barang`}
                </p>
                {row.lastError && row.status !== "synced" ? (
                  <p className="text-xs text-destructive">{row.lastError}</p>
                ) : null}
                {row.conflicts.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {row.conflicts.map((c, index) => (
                      <li key={index}>
                        <span className="font-medium">
                          {CONFLICT_LABEL[c.kind]}:
                        </span>{" "}
                        {c.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {row.status === "sync_failed" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!online || busy}
                    onClick={() => void retry(row.clientId)}
                  >
                    Coba lagi
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}