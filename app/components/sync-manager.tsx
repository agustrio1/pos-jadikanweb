import { useEffect } from "react";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { flushOutbox } from "~/lib/offline/sync-engine";
import { useOnline } from "~/lib/offline/use-online";
import { useOutbox } from "~/lib/offline/use-outbox";

const AUTO_FLUSH_MS = 60_000;

// Dipasang sekali di layout. Memicu sinkronisasi otomatis dan menampilkan
// status antrean. Saat offline, tautan mengarah ke /kasir (tempat panel
// antrean berada) karena halaman lain belum tentu bisa dibuka offline.
export function SyncManager() {
  const online = useOnline();
  const { counts, notice } = useOutbox();

  useEffect(() => {
    if (online) void flushOutbox();
  }, [online]);

  useEffect(() => {
    const tick = () => {
      if (navigator.onLine) void flushOutbox();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const id = setInterval(tick, AUTO_FLUSH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const hasIssue = counts.pending + counts.failed + counts.conflict > 0 || notice;
  if (!hasIssue) return null;

  return (
    <Link
      to={online ? "/sinkronisasi" : "/kasir"}
      className="flex flex-wrap items-center gap-1"
    >
      {counts.pending > 0 ? (
        <Badge variant="secondary">
          {counts.syncing > 0 ? "Menyinkronkan" : "Belum sinkron"}:{" "}
          {counts.pending}
        </Badge>
      ) : null}
      {counts.failed > 0 ? (
        <Badge variant="destructive">Gagal sinkron: {counts.failed}</Badge>
      ) : null}
      {counts.conflict > 0 ? (
        <Badge variant="outline">Konflik: {counts.conflict}</Badge>
      ) : null}
      {notice && counts.pending + counts.failed === 0 ? (
        <Badge variant="destructive">Sinkronisasi bermasalah</Badge>
      ) : null}
    </Link>
  );
}