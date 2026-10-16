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
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { flattenNav } from "~/lib/nav";
import { useOnline } from "~/lib/offline/use-online";

type PaletteItem = ReturnType<typeof flattenNav>[number];

// Pencarian global ala command palette: tekan Ctrl/Cmd+K, ketik, lalu
// panah naik/turun + Enter untuk berpindah ke halaman. Menampilkan isi menu
// yang dapat diakses sesuai peran (admin/kasir).
export function CommandPalette({ role }: { role: "admin" | "kasir" }) {
  const navigate = useNavigate();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => flattenNav(role), [role]);

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
      // Fokus input setelah dialog muncul.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.label, it.group, it.hint ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  // Jaga indeks aktif tetap valid ketika hasil berubah.
  useEffect(() => {
    setActive((a) => (a >= filtered.length ? 0 : a));
  }, [filtered.length]);

  // Scroll item aktif agar terlihat.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const isDisabled = (it: PaletteItem) => !online && !it.offlineReady;

  const go = (it: PaletteItem) => {
    if (isDisabled(it)) return;
    setOpen(false);
    navigate(it.to);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) =>
        filtered.length ? (a - 1 + filtered.length) % filtered.length : 0,
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[active];
      if (it) go(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

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
          <span className="hidden sm:inline">Cari menu…</span>
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
            Cari dan berpindah ke halaman lain.
          </Dialog.Description>

          <div className="border-b px-3">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Ketik nama menu…"
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
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Tidak ada menu yang cocok.
              </p>
            ) : (
              filtered.map((it, idx) => {
                const disabled = isDisabled(it);
                const isActive = idx === active;
                return (
                  <div
                    key={`${it.to}-${it.label}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(e) => {
                      // Mencegah input kehilangan fokus sebelum klik tercatat.
                      e.preventDefault();
                      go(it);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                      isActive && "bg-accent text-accent-foreground",
                      disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <HugeiconsIcon icon={it.icon} size={16} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{it.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {it.group}
                        {it.hint ? ` · ${it.hint}` : ""}
                      </p>
                    </div>
                    {disabled ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <HugeiconsIcon icon={WifiDisconnected01Icon} size={13} />
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
            <span>{filtered.length} menu</span>
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
