import { data, Form, useFetcher } from "react-router";
import type { Route } from "./+types/pemasok";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import {
  createSupplier,
  listSuppliers,
  updateSupplier,
} from "~/.server/services/suppliers";
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
import { describeZodError, supplierInputSchema } from "~/lib/schemas";

export function meta() {
  return [{ title: "Pemasok | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireAdminStore(request);
  const url = new URL(request.url);
  const search = (url.searchParams.get("q") ?? "").trim();
  const rows = await withDb((db) =>
    listSuppliers(db, { businessId: user.businessId, search: search || undefined }),
  );
  return { rows, search };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const scope = { businessId: user.businessId };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const parsed = supplierInputSchema.safeParse({
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
    address: String(form.get("address") ?? ""),
  });
  if (!parsed.success) {
    return data({ error: describeZodError(parsed.error) }, { status: 400 });
  }

  try {
    if (intent === "create") {
      await withDb((db) => createSupplier(db, scope, parsed.data));
      return { ok: true as const };
    }
    if (intent === "update") {
      const id = String(form.get("id") ?? "");
      await withDb((db) => updateSupplier(db, scope, { id, ...parsed.data }));
      return { ok: true as const };
    }
    return data({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    return actionErrorFrom(err, "Data pemasok bentrok.");
  }
}

type Row = Route.ComponentProps["loaderData"]["rows"][number];

function SupplierRow({ row }: { row: Row }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  return (
    <TableRow>
      <TableCell className="font-medium">{row.name}</TableCell>
      <TableCell className="text-muted-foreground">{row.phone ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground">{row.address ?? "—"}</TableCell>
      <TableCell className="text-right">
        <details className="inline-block text-left">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Ubah
          </summary>
          <fetcher.Form method="post" className="mt-2 flex w-64 flex-col gap-2">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={row.id} />
            <Input name="name" defaultValue={row.name} required maxLength={100} aria-label="Nama" />
            <Input
              name="phone"
              defaultValue={row.phone ?? ""}
              maxLength={32}
              placeholder="No. HP"
              aria-label="No. HP"
            />
            <Input
              name="address"
              defaultValue={row.address ?? ""}
              maxLength={200}
              placeholder="Alamat"
              aria-label="Alamat"
            />
            <Button type="submit" size="sm" disabled={busy}>
              Simpan
            </Button>
          </fetcher.Form>
        </details>
      </TableCell>
    </TableRow>
  );
}

export default function Pemasok({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { rows, search } = loaderData;
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pemasok"
        description="Daftar pemasok yang dapat ditautkan ke purchase order."
      />

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tambah pemasok</CardTitle>
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
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="address">Alamat</Label>
              <Input id="address" name="address" maxLength={200} />
            </div>
            <Button type="submit">Simpan</Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Daftar pemasok
            <Badge variant="secondary">{rows.length}</Badge>
          </CardTitle>
          <CardDescription>Urut nama. Klik "Ubah" untuk menyunting.</CardDescription>
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
              Belum ada pemasok.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>No. HP</TableHead>
                  <TableHead>Alamat</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <SupplierRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
