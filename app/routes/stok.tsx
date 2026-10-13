import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { data, Form, Link, useFetcher } from "react-router";
import type { Route } from "./+types/stok";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { listVariants } from "~/.server/services/catalog";
import { stockAdjust, stockIn } from "~/.server/services/stock";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { variantLabel } from "~/lib/format";
import {
  describeZodError,
  stockAdjustSchema,
  stockInSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Stok | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const low = url.searchParams.get("low") === "1";

  const rows = await withDb((db) =>
    listVariants(db, {
      businessId: user.businessId,
      storeId,
      q: q || undefined,
      low,
    }),
  );

  return { rows, q, low };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const actor = { businessId: user.businessId, storeId, userId: user.id };

  const raw = {
    variantId: form.get("variantId") ?? "",
    qty: form.get("qty") ?? "",
    reason: form.get("reason") ?? "",
  };

  try {
    if (intent === "stockIn") {
      const parsed = stockInSchema.safeParse(raw);
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) => stockIn(db, actor, parsed.data));
      return { ok: true as const };
    }

    if (intent === "adjust") {
      const parsed = stockAdjustSchema.safeParse(raw);
      if (!parsed.success) {
        return data(
          { error: "Isi jumlah hasil hitung dan alasan (minimal 3 karakter)." },
          { status: 400 },
        );
      }
      await withDb((db) => stockAdjust(db, actor, parsed.data));
      return { ok: true as const };
    }
  } catch (err) {
    return actionErrorFrom(err, "Data bentrok.");
  }

  return data({ error: "Aksi tidak dikenal." }, { status: 400 });
}

type Row = Route.ComponentProps["loaderData"]["rows"][number];

function StockRow({ row }: { row: Row }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const error =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const label = variantLabel(row.size, row.color);
  const isLow = row.qty <= row.minQty;

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.productName}
            {label ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {label}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.sku} · minimum {row.minQty}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-2xl font-semibold leading-none">{row.qty}</span>
          {isLow ? (
            <Badge variant="destructive">
              {row.qty <= 0 ? "Habis" : "Menipis"}
            </Badge>
          ) : null}
        </div>
      </div>

      <fetcher.Form
        method="post"
        key={`${row.variantId}-${row.qty}`}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <input type="hidden" name="variantId" value={row.variantId} />
        <Input
          name="qty"
          type="number"
          min={0}
          inputMode="numeric"
          required
          placeholder="Jumlah"
          aria-label="Jumlah"
          className="sm:w-28"
        />
        <Input
          name="reason"
          maxLength={200}
          placeholder="Alasan (wajib untuk Setel)"
          aria-label="Alasan"
          className="sm:flex-1"
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            name="intent"
            value="stockIn"
            variant="outline"
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            + Tambah
          </Button>
          <Button
            type="submit"
            name="intent"
            value="adjust"
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            Setel
          </Button>
        </div>
      </fetcher.Form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export default function Stok({ loaderData }: Route.ComponentProps) {
  const { rows, q, low } = loaderData;

  const href = (lowOnly: boolean) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (lowOnly) params.set("low", "1");
    const query = params.toString();
    return query ? `/stok?${query}` : "/stok";
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Stok"
        description="Tambah stok masuk, atau setel jumlah sesuai hitung fisik."
        actions={
          <Button variant="outline" asChild>
            <Link to="/stok/riwayat">Riwayat</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Form method="get" className="relative min-w-52 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Cari nama, SKU, atau barcode"
            className="pl-9"
          />
          {low ? <input type="hidden" name="low" value="1" /> : null}
        </Form>

        <div className="flex gap-1">
          <Button variant={low ? "outline" : "default"} size="sm" asChild>
            <Link to={href(false)}>Semua</Link>
          </Button>
          <Button variant={low ? "default" : "outline"} size="sm" asChild>
            <Link to={href(true)}>Stok menipis</Link>
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y">
          {rows.length === 0 ? (
            <li className="p-8 text-center text-sm text-muted-foreground">
              Tidak ada produk aktif.
            </li>
          ) : (
            rows.map((row) => <StockRow key={row.variantId} row={row} />)
          )}
        </ul>
      </Card>
    </div>
  );
}