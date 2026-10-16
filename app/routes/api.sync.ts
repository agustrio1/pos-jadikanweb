import type { Route } from "./+types/api.sync";
import { assertSameOrigin } from "~/.server/auth/origin";
import { requireUser } from "~/.server/auth/session";
import { withDb } from "~/.server/db/client";
import { syncReturnSale, syncSale } from "~/.server/services/sync-sales";
import {
  syncBatchSchema,
  type SyncResponse,
  type SyncResultItem,
} from "~/lib/offline/sync-schema";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Hanya nama dan kode error yang dicatat di log: pesan error Drizzle
// menyertakan parameter query (data transaksi).
function describeError(error: unknown) {
  const e = error as
    | { name?: string; code?: string; cause?: { code?: string } }
    | undefined;
  return {
    name: e?.name ?? "Error",
    code: e?.code ?? e?.cause?.code ?? null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Metode tidak diizinkan." }, 405);
  }

  // Endpoint JSON bercookie: pastikan permintaan berasal dari aplikasi ini.
  assertSameOrigin(request);

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type harus application/json." }, 415);
  }

  // api: true -> 401 JSON, bukan redirect ke /login.
  const user = await requireUser(request, { api: true });
  if (!user.storeId) {
    return json({ error: "Akun belum terhubung ke toko." }, 403);
  }
  const storeId = user.storeId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid." }, 400);
  }

  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String).join(".") || "data";
    return json({ error: `${path}: ${issue?.message ?? "tidak valid"}` }, 400);
  }

  // Penjualan hanya boleh masuk ke toko milik sesi ini. Pengaman cadangan:
  // klien sudah menyaring antrean menurut toko sebelum mengirim.
  if (
    parsed.data.sales.some((sale) => sale.storeId && sale.storeId !== storeId)
  ) {
    return json({ error: "Antrean berisi transaksi toko lain." }, 409);
  }

  const actor = {
    businessId: user.businessId,
    storeId,
    userId: user.id,
    role: user.role,
    maxDiscountPct: user.maxDiscountPct,
  };

  // Satu transaksi database per penjualan. Jika proses terputus di tengah,
  // kiriman ulang aman karena idempoten.
  const results = await withDb(async (db) => {
    const out: SyncResultItem[] = [];
    let unexpected = 0;
    let firstError: unknown = null;

    for (const item of parsed.data.sales) {
      try {
        out.push(
          item.kind === "return"
            ? await syncReturnSale(db, actor, item)
            : await syncSale(db, actor, item),
        );
      } catch (error) {
        // Satu transaksi bermasalah tidak boleh menggagalkan yang lain.
        unexpected += 1;
        firstError ??= error;
        console.error("sync: gagal memproses transaksi", {
          clientId: item.clientId,
          ...describeError(error),
        });
        out.push({
          clientId: item.clientId,
          status: "rejected",
          message:
            "Gagal diproses server (kesalahan tak terduga). Tekan Coba lagi; jika berulang, hubungi admin.",
        });
      }
    }

    // Semua gagal tak terduga: kemungkinan gangguan sementara (mis. database).
    // Lempar ulang supaya klien mencoba lagi otomatis, bukan menandai gagal.
    if (unexpected === parsed.data.sales.length) throw firstError;

    return out;
  });

  const response: SyncResponse = { results };
  return json(response, 200);
}