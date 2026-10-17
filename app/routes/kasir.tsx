import { useEffect, useMemo, useRef, useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/kasir";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { listCustomerOptions } from "~/.server/services/customers";
import { createSale } from "~/.server/services/sales";
import { OfflineReceipt } from "~/components/offline-receipt";
import { OutboxPanel } from "~/components/outbox-panel";
import { PageHeader } from "~/components/page-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { CameraScanner } from "~/components/camera-scanner";
import { HugeiconsIcon } from "@hugeicons/react";
import { BarCode01Icon } from "@hugeicons/core-free-icons";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatDateTime, formatRupiah } from "~/lib/format";
import {
  REDEEM_MIN_POINTS,
  REDEEM_RUPIAH_PER_POINT,
  normalizeRedeemPoints,
  pointsEarned,
  redeemDiscount,
} from "~/lib/loyalty-rules";
import { getMeta } from "~/lib/offline/db";
import { isNetworkError } from "~/lib/offline/network";
import { saveOfflineSale } from "~/lib/offline/outbox";
import type {
  CatalogItem,
  OutboxSale,
  SessionUser,
} from "~/lib/offline/types";
import { useCatalog } from "~/lib/offline/use-catalog";
import { useOutbox } from "~/lib/offline/use-outbox";
import {
  describeZodError,
  parseJson,
  saleInputSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Kasir | POS JadikanWeb" }];
}

// Loader menjaga akses dan memberi identitas kasir untuk transaksi offline.
// Katalog dibaca dari penyimpanan lokal (Dexie) yang disinkronkan lewat /api/catalog.
export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const cashier: SessionUser = {
    name: user.name,
    role: user.role,
    storeId,
    maxDiscountPct: user.maxDiscountPct,
  };
  // Opsi pelanggan (loyalti/piutang) hanya tersedia saat online.
  const customers = await withDb((db) =>
    listCustomerOptions(db, { businessId: user.businessId }),
  );
  return { ok: true as const, user: cashier as SessionUser | null, customers };
}

export async function clientLoader({
  serverLoader,
}: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const stored = (await getMeta<SessionUser>("user").catch(
      () => undefined,
    )) as SessionUser | undefined;
    return {
      ok: true as const,
      user: (stored ?? null) as SessionUser | null,
      customers: [] as Awaited<ReturnType<typeof listCustomerOptions>>,
    };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const form = await request.formData();
  const parsed = saleInputSchema.safeParse(parseJson(form.get("payload")));

  if (!parsed.success) {
    return data({ error: describeZodError(parsed.error) }, { status: 400 });
  }

  let saleId: string;
  try {
    const result = await withDb((db) =>
      createSale(
        db,
        { businessId: user.businessId, storeId, userId: user.id },
        parsed.data,
      ),
    );
    saleId = result.saleId;
  } catch (err) {
    return actionErrorFrom(err, "Transaksi bentrok. Coba kirim ulang.");
  }

  return redirect(`/struk/${saleId}`);
}

const ONLINE_SUBMIT_TIMEOUT_MS = 15_000;

// Pembayaran online yang terputus di tengah jalan tidak boleh menjatuhkan
// halaman (keranjang hilang, pembayaran tidak tercatat). Kegagalan jaringan
// dikembalikan sebagai hasil biasa, lalu halaman menyimpan transaksi ke
// antrean offline dengan clientId yang sama. Jika server ternyata sudah
// mencatatnya, sinkronisasi nanti mengenalinya sebagai duplikat.
export async function clientAction({
  request,
  serverAction,
}: Route.ClientActionArgs) {
  // Salin payload sebelum request dikirim.
  let payload: string | null = null;
  try {
    const value = (await request.clone().formData()).get("payload");
    payload = typeof value === "string" ? value : null;
  } catch {
    payload = null;
  }

  const pending = serverAction();
  // Jika kita berhenti menunggu (batas waktu), hasil susulannya tidak boleh
  // menjadi unhandled rejection.
  pending.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TypeError("Batas waktu pembayaran habis.")),
      ONLINE_SUBMIT_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([pending, timeout]);
  } catch (error) {
    // Redirect ke struk (Response) dan error server tidak termasuk kegagalan
    // jaringan, jadi diteruskan seperti biasa.
    if (isNetworkError(error) && payload) {
      return { networkFailed: true as const, payload };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type CartLine = { variantId: string; qty: number };
type DiscountType = "none" | "percent" | "amount";

type Method = "cash" | "qris" | "debit" | "credit";
type PayLine = { id: string; method: Method; amount: string; reference: string };
// Hanya metode non-tunai yang bisa ditambah baris; tunai tetap satu kolom.
const NON_CASH_METHODS: Method[] = ["qris", "debit", "credit"];
const PAYMENT_LABEL: Record<Method, string> = {
  cash: "Tunai",
  qris: "QRIS",
  debit: "Debit",
  credit: "Kredit",
};

const QUICK_CASH = [20_000, 50_000, 100_000];
const MAX_CARDS = 24;

export default function Kasir({ actionData, loaderData }: Route.ComponentProps) {
  const cashier = loaderData.user;
  const customers = loaderData.customers ?? [];
  const catalog = useCatalog();
  const { items, ready, online, syncedAt, truncated, syncing } = catalog;
  const { rows: outboxRows } = useOutbox();

  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [cash, setCash] = useState("");
  const [payLines, setPayLines] = useState<PayLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [redeemInput, setRedeemInput] = useState("");
  const [clientId, setClientId] = useState("");
  // Umpan balik singkat untuk hasil scan/Enter pada kolom cari.
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  // Dialog pemindai kamera.
  const [cameraOpen, setCameraOpen] = useState(false);

  const [savedSale, setSavedSale] = useState<OutboxSale | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // ID baru setiap isi transaksi berubah, tetap sama untuk kirim ulang
  // transaksi yang identik (idempotensi) pada jalur online.
  useEffect(() => {
    setClientId(crypto.randomUUID());
  }, [cart, discountType, discountValue, cash, payLines, customerId, redeemInput]);

  const byId = useMemo(
    () => new Map(items.map((item) => [item.variantId, item])),
    [items],
  );

  // Stok di layar = stok katalog dikurangi transaksi di outbox yang belum
  // diterima server. Hanya perkiraan: perangkat lain bisa menjual barang yang sama.
  const reserved = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of outboxRows) {
      if (row.status === "synced" || row.status === "conflict") continue;
      for (const item of row.items) {
        // Retur mengembalikan stok, penjualan mengurangi.
        const delta = row.kind === "return" ? -item.qty : item.qty;
        map.set(item.variantId, (map.get(item.variantId) ?? 0) + delta);
      }
    }
    return map;
  }, [outboxRows]);

  const stockOf = (item: CatalogItem) =>
    Math.max(item.qty - (reserved.get(item.variantId) ?? 0), 0);

  const matched = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        item.sku.toLowerCase().includes(term) ||
        (item.barcode ?? "").toLowerCase().includes(term),
    );
  }, [items, search]);

  // Satu kartu per produk; varian-variannya dikelompokkan di dalam kartu.
  const groups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of matched) {
      const list = map.get(item.productId);
      if (list) list.push(item);
      else map.set(item.productId, [item]);
    }
    return Array.from(map.values()).slice(0, MAX_CARDS);
  }, [matched]);

  const lines = cart.flatMap((line) => {
    const item = byId.get(line.variantId);
    return item ? [{ ...line, item }] : [];
  });

  const subtotal = lines.reduce((sum, l) => sum + l.item.price * l.qty, 0);
  const discountNum = Number(discountValue) || 0;
  const discount =
    discountType === "percent"
      ? Math.floor((subtotal * Math.min(discountNum, 100)) / 100)
      : discountType === "amount"
        ? Math.min(discountNum, subtotal)
        : 0;
  const totalBase = subtotal - discount;
  // Loyalti: pelanggan terpilih & penukaran poin (server memvalidasi ulang).
  const selectedCustomer =
    customers.find((c) => c.id === customerId) ?? null;
  const availablePoints = selectedCustomer?.points ?? 0;
  const requestedPoints = Number(redeemInput) || 0;
  const pointsCap = Math.floor(totalBase / REDEEM_RUPIAH_PER_POINT);
  const pointsUsed =
    selectedCustomer && requestedPoints > 0
      ? Math.min(
          normalizeRedeemPoints(requestedPoints, availablePoints),
          normalizeRedeemPoints(pointsCap, availablePoints),
        )
      : 0;
  const loyaltyDiscount = redeemDiscount(pointsUsed);
  const total = totalBase - loyaltyDiscount;
  const earnedPoints = pointsEarned(total);
  const cashNum = Number(cash) || 0;
  // Bagian tagihan yang dilunasi metode non-tunai; sisanya ditanggung tunai.
  const nonCashSum = payLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const nonCashOver = nonCashSum > total;
  const nonCashValid = payLines.every((l) => (Number(l.amount) || 0) > 0);
  const cashDue = Math.max(total - nonCashSum, 0);
  const change = cashNum - cashDue;
  // Kredit memerlukan pelanggan (untuk membentuk piutang).
  const creditSelected = payLines.some(
    (l) => l.method === "credit" && (Number(l.amount) || 0) > 0,
  );
  const creditNeedsCustomer = creditSelected && !customerId;

  // Rincian metode pembayaran: hanya dibangun bila ada baris non-tunai.
  // Tanpa non-tunai, payload memakai jalur lama (cashReceived) supaya identik
  // dengan sebelumnya.
  const buildPayments = () => {
    if (payLines.length === 0) return undefined;
    type Row = {
      method: Method;
      amount: number;
      tendered?: number;
      reference?: string;
    };
    const rows: Row[] = payLines
      .map((l) => ({
        method: l.method,
        amount: Number(l.amount) || 0,
        reference: l.reference.trim() || undefined,
      }))
      .filter((r) => r.amount > 0);
    if (cashDue > 0) {
      rows.push({ method: "cash", amount: cashDue, tendered: cashNum });
    }
    return rows;
  };

  // Batas diskon dipakai di jalur offline; jalur online diperiksa server.
  const discountLimitPct =
    cashier?.role === "admin" ? 100 : (cashier?.maxDiscountPct ?? 0);
  const overDiscountLimit = discount * 100 > subtotal * discountLimitPct;

  const canSubmit =
    online &&
    lines.length > 0 &&
    clientId !== "" &&
    !busy &&
    !nonCashOver &&
    nonCashValid &&
    !creditNeedsCustomer &&
    cashNum >= cashDue;
  const canSaveOffline =
    !online &&
    !saving &&
    lines.length > 0 &&
    !nonCashOver &&
    nonCashValid &&
    !creditNeedsCustomer &&
    cashNum >= cashDue &&
    !overDiscountLimit;

  const add = (variantId: string) => {
    const item = byId.get(variantId);
    if (!item || stockOf(item) <= 0) return;
    setCart((current) => {
      const index = current.findIndex((l) => l.variantId === variantId);
      if (index === -1) return [...current, { variantId, qty: 1 }];
      return current.map((l, i) =>
        i === index ? { ...l, qty: Math.min(l.qty + 1, stockOf(item)) } : l,
      );
    });
  };

  const setQty = (variantId: string, value: number) => {
    const item = byId.get(variantId);
    if (!item) return;
    const qty = Math.min(
      Math.max(Math.floor(value) || 1, 1),
      Math.max(stockOf(item), 1),
    );
    setCart((current) =>
      current.map((l) => (l.variantId === variantId ? { ...l, qty } : l)),
    );
  };

  const remove = (variantId: string) =>
    setCart((current) => current.filter((l) => l.variantId !== variantId));

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = search.trim().toLowerCase();
    if (!term) return;
    const exact = items.find(
      (item) =>
        (item.barcode ?? "").toLowerCase() === term ||
        item.sku.toLowerCase() === term,
    );
    const target = exact ?? (matched.length === 1 ? matched[0] : undefined);
    if (target) {
      if (stockOf(target) <= 0) {
        setScanNotice(`"${search.trim()}" stoknya habis.`);
        return;
      }
      add(target.variantId);
      setSearch("");
      setScanNotice(null);
    } else {
      // Scan barcode/SKU yang tidak dikenal -> beri tahu kasir.
      setScanNotice(`Barcode/SKU "${search.trim()}" tidak ditemukan.`);
    }
  };

  // Hasil dari pemindai kamera: cocokkan persis barcode/SKU lalu tambahkan.
  const handleCameraCode = (code: string) => {
    const term = code.trim().toLowerCase();
    if (!term) return;
    const hit = items.find(
      (i) =>
        (i.barcode ?? "").toLowerCase() === term ||
        i.sku.toLowerCase() === term,
    );
    if (hit) {
      add(hit.variantId);
      setScanNotice(null);
    } else {
      setScanNotice(`Barcode "${code}" tidak ditemukan di katalog.`);
    }
  };

  // Opsi scanner USB / ketik manual: fokuskan ke kolom cari (sudah menangani Enter).
  const focusScanInput = () => {
    document.getElementById("kasir-scan-input")?.focus();
    setScanNotice(
      "Mode scanner aktif — arahkan scanner atau ketik kode lalu Enter.",
    );
  };

  // Ref tangani terbaru agar pendengar keyboard global tidak memakai closure basi.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const addRef = useRef(add);
  addRef.current = add;

  // Scanner USB mengetik karakter cepat lalu mengirim Enter. Tangkap di level
  // jendela supaya scan tetap menambah produk walau fokus bukan di kolom cari
  // (mis. saat checkout). Saat sedang mengetik di kolom, biarkan kolom itu
  // yang memproses supaya tidak mengganggu input normal.
  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;

      if (e.key === "Enter") {
        const code = buffer.trim();
        buffer = "";
        if (code.length < 3) return;
        const term = code.toLowerCase();
        const hit = itemsRef.current.find(
          (i) =>
            (i.barcode ?? "").toLowerCase() === term ||
            i.sku.toLowerCase() === term,
        );
        if (hit) {
          addRef.current(hit.variantId);
          setScanNotice(null);
        } else {
          setScanNotice(`Barcode/SKU "${code}" tidak ditemukan.`);
        }
        return;
      }

      if (e.key.length === 1) {
        const now = Date.now();
        // Jeda antar-tombol panjang -> dianggap ketikan manual, reset buffer.
        if (now - lastKeyAt > 150) buffer = "";
        lastKeyAt = now;
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // reuseClientId diisi saat pembayaran online terputus: transaksi yang sama
  // disimpan ke antrean dengan ID yang sama agar server tidak mencatat ganda.
  const persistOffline = async (reuseClientId?: string) => {
    if (savingRef.current || lines.length === 0) return;
    savingRef.current = true;
    setSaving(true);
    setOfflineError(null);
    try {
      const sale = await saveOfflineSale({
        clientId: reuseClientId,
        storeId: cashier?.storeId ?? null,
        cashierName: cashier?.name ?? "-",
        items: lines.map(({ item, qty }) => ({
          variantId: item.variantId,
          name: item.name,
          sku: item.sku,
          label: item.label,
          qty,
          unitPrice: item.price,
        })),
        discount: {
          type: discountType,
          value: discountType === "none" ? 0 : discountNum,
        },
        discountAmount: discount,
        subtotal,
        total,
        cashReceived: cashNum,
        payments: buildPayments(),
        change,
      });
      setSavedSale(sale);
      setCart([]);
      setDiscountType("none");
      setDiscountValue("");
      setCash("");
      setPayLines([]);
      setCustomerId("");
      setRedeemInput("");
      if (reuseClientId) {
        setFallbackNotice(
          "Koneksi ke server terputus saat memproses pembayaran. Transaksi disimpan di perangkat dan dikirim otomatis. Jika server ternyata sudah mencatatnya, sistem mengenalinya dan tidak mencatat ganda.",
        );
      }
    } catch (err) {
      setOfflineError(
        err instanceof Error
          ? `Gagal menyimpan ke perangkat: ${err.message}`
          : "Gagal menyimpan transaksi ke perangkat.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveOffline = async () => {
    if (!canSaveOffline) return;
    await persistOffline();
  };

  // Pembayaran online terputus: simpan ke antrean offline dengan clientId yang
  // sama dengan percobaan online tadi.
  useEffect(() => {
    if (!actionData || !("networkFailed" in actionData)) return;
    let id: string | null = null;
    try {
      const parsed = JSON.parse(actionData.payload) as { clientId?: unknown };
      id = typeof parsed.clientId === "string" ? parsed.clientId : null;
    } catch {
      id = null;
    }
    if (!id) {
      setOfflineError(
        "Koneksi terputus dan transaksi tidak dapat disimpan otomatis. Catat pembayaran ini secara manual.",
      );
      return;
    }
    void persistOffline(id);
    // Dijalankan tepat sekali untuk setiap hasil aksi yang baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);

  const payload = JSON.stringify({
    clientId,
    items: cart,
    discount: {
      type: discountType,
      value: discountType === "none" ? 0 : discountNum,
    },
    cashReceived: cashNum,
    payments: buildPayments(),
    customerId: customerId || null,
    redeemPoints: pointsUsed,
  });

  return (
    <>
      <PageHeader
        title="Kasir"
        description="Cari produk atau scan barcode, lalu terima pembayaran tunai."
      />

      <CameraScanner
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onDetected={handleCameraCode}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              id="kasir-scan-input"
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setScanNotice(null);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Cari nama, SKU, atau scan barcode lalu Enter"
              aria-label="Cari produk"
              className="h-9 flex-1"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 shrink-0">
                  <HugeiconsIcon
                    icon={BarCode01Icon}
                    size={16}
                    className="mr-2"
                  />
                  Scan
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setCameraOpen(true)}>
                  Scan dengan kamera
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={focusScanInput}>
                  Scanner USB / ketik manual
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {scanNotice ? (
            <p role="alert" className="text-sm text-destructive">
              {scanNotice}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {ready ? `${items.length} varian tersimpan` : "Memuat katalog..."}
              {syncedAt ? ` · sinkron ${formatDateTime(syncedAt)}` : ""}
            </span>
            <div className="flex flex-wrap gap-2">
              {!online && cashier?.role === "admin" ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/retur">Retur offline</Link>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!online || syncing}
                onClick={() => void catalog.sync()}
              >
                {syncing ? "Menyinkronkan..." : "Perbarui katalog"}
              </Button>
            </div>
          </div>

          {catalog.storageError ? (
            <Alert variant="destructive">
              <AlertDescription>
                Penyimpanan lokal bermasalah: {catalog.storageError}
              </AlertDescription>
            </Alert>
          ) : null}

          {catalog.error && online ? (
            <Alert variant="destructive">
              <AlertDescription>
                Gagal memperbarui katalog: {catalog.error} Menampilkan data yang
                tersimpan di perangkat.
              </AlertDescription>
            </Alert>
          ) : null}

          {ready && items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {online
                ? syncing
                  ? "Mengunduh katalog..."
                  : "Belum ada produk aktif."
                : "Katalog belum tersimpan di perangkat ini. Hubungkan internet sekali untuk mengunduhnya."}
            </p>
          ) : groups.length === 0 && items.length > 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Produk tidak ditemukan.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => {
                const first = group[0];

                // Produk tanpa varian: satu kartu, satu klik.
                if (group.length === 1) {
                  const stock = stockOf(first);
                  const empty = stock <= 0;
                  return (
                    <button
                      key={first.variantId}
                      type="button"
                      disabled={empty}
                      onClick={() => add(first.variantId)}
                      className="rounded-lg border bg-card p-3 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <p className="line-clamp-2 text-sm font-medium">
                        {first.name}
                      </p>
                      {first.label ? (
                        <p className="text-xs text-muted-foreground">
                          {first.label}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {formatRupiah(first.price)}
                        </span>
                        <Badge variant={empty ? "destructive" : "secondary"}>
                          {empty ? "Habis" : `Stok ${stock}`}
                        </Badge>
                      </div>
                    </button>
                  );
                }

                // Produk dengan varian: tampilkan semua variannya.
                return (
                  <div
                    key={first.productId}
                    className="rounded-lg border bg-card p-3 sm:col-span-2 xl:col-span-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium">
                        {first.name}
                      </p>
                      <Badge variant="outline">{group.length} varian</Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.map((variant) => {
                        const stock = stockOf(variant);
                        const empty = stock <= 0;
                        return (
                          <button
                            key={variant.variantId}
                            type="button"
                            disabled={empty}
                            onClick={() => add(variant.variantId)}
                            className="rounded-md border p-2 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <p className="truncate text-sm font-medium">
                              {variant.label ?? variant.sku}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="text-sm">
                                {formatRupiah(variant.price)}
                              </span>
                              <Badge
                                variant={empty ? "destructive" : "secondary"}
                              >
                                {empty ? "Habis" : `Stok ${stock}`}
                              </Badge>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {truncated ? (
            <p className="text-xs text-muted-foreground">
              Katalog dibatasi 5.000 varian pertama. Gunakan pencarian dengan
              SKU atau barcode untuk produk lain.
            </p>
          ) : null}

          <OutboxPanel limit={10} hideWhenEmpty />
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {savedSale ? (
            <Card>
              <CardHeader>
                <CardTitle>Transaksi tersimpan di perangkat</CardTitle>
                <CardDescription>
                  Akan dikirim otomatis saat koneksi kembali.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {fallbackNotice ? (
                  <Alert>
                    <AlertDescription>{fallbackNotice}</AlertDescription>
                  </Alert>
                ) : null}
                <OfflineReceipt sale={savedSale} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => window.print()}>
                    Cetak struk
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSavedSale(null);
                      setFallbackNotice(null);
                    }}
                  >
                    Transaksi baru
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Form method="post">
            <input type="hidden" name="payload" value={payload} />
            <Card>
              <CardHeader>
                <CardTitle>Keranjang</CardTitle>
                <CardDescription>
                  {lines.length === 0
                    ? "Belum ada item."
                    : `${lines.length} jenis produk`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                {offlineError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{offlineError}</AlertDescription>
                  </Alert>
                ) : null}

                {!online ? (
                  <Alert>
                    <AlertDescription>
                      Anda sedang offline. Transaksi tunai disimpan di
                      perangkat dan dikirim otomatis saat koneksi kembali. Stok
                      di layar hanya perkiraan.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {lines.length > 0 ? (
                  <ul className="divide-y">
                    {lines.map(({ item, qty, variantId }) => (
                      <li key={variantId} className="space-y-2 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 text-sm">
                            <p className="truncate font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.label ? `${item.label} · ` : ""}
                              {formatRupiah(item.price)}
                            </p>
                          </div>
                          <span className="text-sm font-medium">
                            {formatRupiah(item.price * qty)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label="Kurangi"
                            onClick={() => setQty(variantId, qty - 1)}
                          >
                            −
                          </Button>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Math.max(stockOf(item), 1)}
                            value={qty}
                            onChange={(e) =>
                              setQty(variantId, Number(e.target.value))
                            }
                            className="h-8 w-16 text-center"
                            aria-label="Jumlah"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label="Tambah"
                            disabled={qty >= stockOf(item)}
                            onClick={() => setQty(variantId, qty + 1)}
                          >
                            +
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-auto text-destructive"
                            onClick={() => remove(variantId)}
                          >
                            Hapus
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* Pelanggan & loyalti (hanya online). */}
                {online ? (
                  <div className="space-y-2 border-b pb-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="customer">Pelanggan (opsional)</Label>
                      <select
                        id="customer"
                        value={customerId}
                        onChange={(e) => {
                          setCustomerId(e.target.value);
                          setRedeemInput("");
                        }}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">Tanpa pelanggan</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.phone ? ` · ${c.phone}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedCustomer ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Poin tersedia: {availablePoints}</span>
                          <span>
                            {pointsUsed > 0
                              ? `Pakai ${pointsUsed} → -${formatRupiah(loyaltyDiscount)}`
                              : `Tukar per kelipatan ${REDEEM_MIN_POINTS} poin`}
                          </span>
                        </div>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={REDEEM_MIN_POINTS}
                          value={redeemInput}
                          onChange={(e) => setRedeemInput(e.target.value)}
                          placeholder="Poin ditukar"
                          aria-label="Poin ditukar"
                        />
                        {requestedPoints > 0 && pointsUsed === 0 ? (
                          <p className="text-xs text-destructive">
                            Poin tidak cukup atau bukan kelipatan{" "}
                            {REDEEM_MIN_POINTS}.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label>Diskon</Label>
                  <div className="flex gap-2">
                    <Select
                      value={discountType}
                      onValueChange={(v) => setDiscountType(v as DiscountType)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Tanpa diskon</SelectItem>
                        <SelectItem value="percent">Persen (%)</SelectItem>
                        <SelectItem value="amount">Nominal (Rp)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      disabled={discountType === "none"}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      aria-label="Nilai diskon"
                    />
                  </div>
                  {!online && overDiscountLimit ? (
                    <p className="text-sm text-destructive">
                      Diskon melebihi batas kewenangan Anda ({discountLimitPct}
                      %).
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatRupiah(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Diskon</span>
                    <span>- {formatRupiah(discount)}</span>
                  </div>
                  {loyaltyDiscount > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Diskon poin ({pointsUsed})
                      </span>
                      <span>- {formatRupiah(loyaltyDiscount)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatRupiah(total)}</span>
                  </div>
                  {customerId && earnedPoints > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Poin diperoleh transaksi ini: +{earnedPoints}
                    </p>
                  ) : null}
                </div>

                {/* Metode non-tunai (opsional): beberapa baris bisa ditambah.
                    Sisanya otomatis ditanggung tunai. */}
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label>Metode non-tunai (opsional)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={payLines.length >= NON_CASH_METHODS.length || total <= 0}
                      onClick={() =>
                        setPayLines((cur) => [
                          ...cur,
                          {
                            id: crypto.randomUUID(),
                            method: "qris",
                            amount: "",
                            reference: "",
                          },
                        ])
                      }
                    >
                      + Metode
                    </Button>
                  </div>
                  {payLines.map((line) => (
                    <div
                      key={line.id}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <select
                        value={line.method}
                        onChange={(e) =>
                          setPayLines((cur) =>
                            cur.map((l) =>
                              l.id === line.id
                                ? { ...l, method: e.target.value as Method }
                                : l,
                            ),
                          )
                        }
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                        aria-label="Metode non-tunai"
                      >
                        {NON_CASH_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="Nominal"
                        value={line.amount}
                        onChange={(e) =>
                          setPayLines((cur) =>
                            cur.map((l) =>
                              l.id === line.id
                                ? { ...l, amount: e.target.value }
                                : l,
                            ),
                          )
                        }
                        className="h-9 w-32"
                        aria-label="Nominal non-tunai"
                      />
                      <Input
                        placeholder="No. referensi"
                        value={line.reference}
                        onChange={(e) =>
                          setPayLines((cur) =>
                            cur.map((l) =>
                              l.id === line.id
                                ? { ...l, reference: e.target.value }
                                : l,
                            ),
                          )
                        }
                        className="h-9 min-w-0 flex-1"
                        aria-label="Nomor referensi"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() =>
                          setPayLines((cur) =>
                            cur.filter((l) => l.id !== line.id),
                          )
                        }
                      >
                        Hapus
                      </Button>
                    </div>
                  ))}
                  {nonCashOver ? (
                    <p className="text-sm text-destructive">
                      Total non-tunai melebihi tagihan.
                    </p>
                  ) : null}
                  {creditNeedsCustomer ? (
                    <p className="text-sm text-destructive">
                      Pembayaran kredit memerlukan pemilihan pelanggan.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cash">Uang tunai diterima</Label>
                  <Input
                    id="cash"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={cashDue <= 0}
                      onClick={() => setCash(String(cashDue))}
                    >
                      Uang pas
                    </Button>
                    {QUICK_CASH.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCash(String(value))}
                      >
                        {formatRupiah(value)}
                      </Button>
                    ))}
                  </div>
                  {cashDue <= 0 && nonCashSum > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Tagihan lunas sepenuhnya dengan non-tunai.
                    </p>
                  ) : (
                    <p
                      className={`text-sm ${
                        cash !== "" && change < 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {cash === ""
                        ? `Butuh tunai ${formatRupiah(cashDue)}.`
                        : change < 0
                          ? `Kurang ${formatRupiah(-change)}`
                          : `Kembalian ${formatRupiah(change)}`}
                    </p>
                  )}
                </div>

                {online ? (
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!canSubmit}
                  >
                    {busy
                      ? "Memproses..."
                      : payLines.length > 0
                        ? "Bayar campuran"
                        : "Bayar tunai"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!canSaveOffline}
                    onClick={() => void saveOffline()}
                  >
                    {saving ? "Menyimpan..." : "Simpan transaksi offline"}
                  </Button>
                )}
              </CardContent>
            </Card>
          </Form>
        </div>
      </div>
    </>
  );
}