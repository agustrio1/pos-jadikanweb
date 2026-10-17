import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Dialog } from "radix-ui";
import { useNavigate } from "react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  CornerDownLeftIcon,
  WifiDisconnected01Icon,
  PackageIcon,
  Invoice01Icon,
  UserGroupIcon,
  DeliveryTruck01Icon,
  ShoppingBag01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { flattenNav } from "~/lib/nav";
import { useOnline } from "~/lib/offline/use-online";

type IconType = typeof PackageIcon;

// Grup hasil dari /api/search (lihat app/.server/services/search.ts).
type SearchItem = { to: string; title: string; subtitle: string };
type SearchGroup = { type: string; label: string; items: SearchItem[] };

// Item terpadu untuk daftar & navigasi keyboard: menu dan hasil data digabung.
type FlatItem = {
  key: string;
  kind: "menu" | "data";
  section: string;
  icon: IconType;
  title: string;
  subtitle: string;
  to: string;
  disabled?: boolean;
};

const DATA_ICON: Record<string, IconType> = {
  produk: PackageIcon,
  penjualan: Invoice01Icon,
  pelanggan: UserGroupIcon,
  pemasok: DeliveryTruck01Icon,
  pembelian: ShoppingBag01Icon,
};

// Pencarian global ala command palette: tekan Ctrl/Cmd+K, ketik, lalu panah
// naik/turun + Enter. Mencari menu (offline, sesuai peran) DAN data nyata
// (produk, penjualan, pelanggan, pemasok, pembelian) lewat /api/search.
export function CommandPalette({ role }: { role: "admin" | "kasir" }) {
  const navigate = useNavigate();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => flattenNav(role), [role]);
  const q = query.trim();
  const wantData = q.length >= 2;

  // Pintu keyboard global: Ctrl/Cmd+K membuka/menutup; "/" membuka saat diam.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (
        e.key === "/" &&
        !open &&
        !isTypingTarget(e.target as HTMLElement | null)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset saat membuka.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setGroups([]);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Ambil hasil data dari server dengan debounce ringan saat dialog terbuka.
  useEffect(() => {
    if (!open || !wantData || !online) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal, headers: { accept: "application/json" } },
        );
        const data = res.ok ? ((await res.json()) as { groups?: SearchGroup[] }) : {};
        setGroups(data.groups ?? []);
      } catch {
        /* batal/offline — biarkan hasil menu saja */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, q, wantData, online]);

  // Menu yang cocok dengan kueri (kosong = tampilkan semua menu).
  const menuMatches = useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return items;
    return items.filter((it) =>
      [it.label, it.group, it.hint ?? ""].join(" ").toLowerCase().includes(needle),
    );
  }, [items, q]);

  // Gabungkan menu + data menjadi satu daftar linear untuk indeks aktif.
  const flat = useMemo<FlatItem[]>(() => {
    const menu: FlatItem[] = menuMatches.map((it) => ({
      key: `menu-${it.to}-${it.label}`,
      kind: "menu",
      section: "Menu",
      icon: it.icon,
      title: it.label,
      subtitle: `${it.group}${it.hint ? ` · ${it.hint}` : ""}`,
      to: it.to,
      disabled: !online && !it.offlineReady,
    }));
    const data: FlatItem[] = groups.flatMap((g) =>
      g.items.map((it, i) => ({
        key: `data-${g.type}-${it.to}-${i}`,
        kind: "data" as const,
        section: g.label,
        icon: DATA_ICON[g.type] ?? Search01Icon,
        title: it.title,
        subtitle: it.subtitle,
        to: it.to,
      })),
    );
    return [...menu, ...data];
  }, [menuMatches, groups, online]);

  // Jaga indeks aktif valid & reset ke atas saat kueri berubah.
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    setActive((a) => (a >= flat.length ? 0 : a));
  }, [flat.length]);

  // Scroll item aktif agar terlihat.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const go = (it: FlatItem) => {
    if (it.disabled) return;
    setOpen(false);
    navigate(it.to);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = flat[active];
      if (it) go(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  let lastSection = "";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Pencarian global"
        >
          <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={2} />
          <span className="hidden sm:inline">Cari menu & data…</span>
          <kbd className="ml-1 hidden rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium sm:inline">
            Ctrl K
          </kbd>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[12%] z-50 w-[92vw] max-w-lg -translate-x-1/2 rounded-xl border bg-background shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <Dialog.Title className="sr-only">Pencarian global</Dialog.Title>
          <Dialog.Description className="sr-only">
            Cari menu dan data: produk, penjualan, pelanggan, pemasok, pembelian.
          </Dialog.Description>

          <div className="border-b px-3">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Cari produk, struk, pelanggan, menu…"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div
            ref={listRef}
            id="palette-results"
            role="listbox"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {flat.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {loading
                  ? "Mencari…"
                  : q
                    ? "Tidak ada hasil yang cocok."
                    : "Mulai ketik untuk mencari."}
              </p>
            ) : (
              flat.map((it, idx) => {
                const showHeader = it.section !== lastSection;
                lastSection = it.section;
                const isActive = idx === active;
                return (
                  <div key={it.key}>
                    {showHeader ? (
                      <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {it.section}
                      </p>
                    ) : null}
                    <div
                      data-idx={idx}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => {
                        // Cegah input kehilangan fokus sebelum klik tercatat.
                        e.preventDefault();
                        go(it);
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                        isActive && "bg-accent text-accent-foreground",
                        it.disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <HugeiconsIcon icon={it.icon} size={16} strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{it.title}</p>
                        {it.subtitle ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {it.subtitle}
                          </p>
                        ) : null}
                      </div>
                      {it.disabled ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <HugeiconsIcon
                            icon={WifiDisconnected01Icon}
                            size={13}
                          />
                          offline
                        </span>
                      ) : isActive ? (
                        <HugeiconsIcon
                          icon={CornerDownLeftIcon}
                          size={14}
                          className="text-muted-foreground"
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> pilih
              <Kbd>Enter</Kbd> buka
              <Kbd>Esc</Kbd> tutup
            </span>
            <span>{loading ? "mencari…" : `${flat.length} hasil`}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium">
      {children}
    </kbd>
  );
}

function isTypingTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}
