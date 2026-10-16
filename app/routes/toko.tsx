import { data, Form, useNavigation } from "react-router";
import type { Route } from "./+types/toko";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { createStore, listStores, updateStore } from "~/.server/services/stores";
import { PageHeader } from "~/components/page-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
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
import { describeZodError, storeSchema } from "~/lib/schemas";

export function meta() {
  return [{ title: "Toko | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireAdminStore(request);
  const stores = await withDb((db) => listStores(db, user.businessId));
  return { stores, currentStoreId: storeId };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = { businessId: user.businessId };

  const storeIdField =
    intent === "update" ? String(form.get("storeId") ?? "") : "";
  const parsed = storeSchema.safeParse({
    name: form.get("name"),
    // Form tambah hanya mengirim nama; alamat hanya dari form ubah.
    address: intent === "update" ? (form.get("address") ?? "") : "",
  });
  if (!parsed.success) {
    return data({ error: describeZodError(parsed.error) }, { status: 400 });
  }

  try {
    if (intent === "create") {
      await withDb((db) => createStore(db, actor, parsed.data.name));
    } else if (intent === "update") {
      await withDb((db) =>
        updateStore(db, actor, {
          storeId: storeIdField,
          name: parsed.data.name,
          address: parsed.data.address,
        }),
      );
    } else {
      return data({ error: "Aksi tidak dikenal." }, { status: 400 });
    }
  } catch (err) {
    return actionErrorFrom(err, "Nama toko sudah dipakai.");
  }

  return { ok: true as const };
}

export default function Toko({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { stores, currentStoreId } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <>
      <PageHeader
        title="Toko"
        description="Kelola toko dalam bisnis ini. Nomor struk berjalan terpisah per toko."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tambah toko</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap gap-2">
            <input type="hidden" name="intent" value="create" />
            <Input
              name="name"
              required
              maxLength={100}
              placeholder="Nama toko, mis. Cabang Bandung"
              aria-label="Nama toko"
              className="max-w-xs"
            />
            <Button type="submit" disabled={busy}>
              Tambah
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Daftar toko</CardTitle>
          <CardDescription>
            Toko tempat akun admin ini bertugas ditandai "toko Anda".
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {stores.map((store) => (
              <li key={store.id} className="px-6 py-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{store.name}</span>
                  {store.id === currentStoreId ? (
                    <span className="text-xs text-muted-foreground">
                      · toko Anda
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    · {store.lastReceiptNo} struk tercetak
                  </span>
                </div>
                <Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="storeId" value={store.id} />
                  <div className="space-y-1">
                    <Label htmlFor={`store-name-${store.id}`} className="text-xs">
                      Nama
                    </Label>
                    <Input
                      id={`store-name-${store.id}`}
                      name="name"
                      required
                      maxLength={100}
                      defaultValue={store.name}
                      className="h-8 w-44"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor={`store-address-${store.id}`}
                      className="text-xs"
                    >
                      Alamat (tampil di struk)
                    </Label>
                    <Input
                      id={`store-address-${store.id}`}
                      name="address"
                      maxLength={200}
                      defaultValue={store.address ?? ""}
                      className="h-8 w-64"
                    />
                  </div>
                  <Button type="submit" size="sm" variant="outline" disabled={busy}>
                    Simpan
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
