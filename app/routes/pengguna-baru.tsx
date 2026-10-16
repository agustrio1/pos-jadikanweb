import { useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/pengguna-baru";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import { createUser } from "~/.server/services/users";
import { listStores } from "~/.server/services/stores";
import { PageHeader } from "~/components/page-header";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { createUserSchema, describeZodError } from "~/lib/schemas";

export function meta() {
  return [{ title: "Tambah pengguna | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireAdminStore(request);
  const stores = await withDb((db) => listStores(db, user.businessId));
  return { stores };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const form = await request.formData();
  const parsed = createUserSchema.safeParse({
    username: form.get("username"),
    name: form.get("name"),
    role: form.get("role"),
    storeId: form.get("storeId"),
    password: form.get("password"),
    maxDiscountPct: form.get("maxDiscountPct"),
  });

  if (!parsed.success) {
    return data({ error: describeZodError(parsed.error) }, { status: 400 });
  }

  try {
    await withDb((db) =>
      createUser(
        db,
        { businessId: user.businessId, userId: user.id },
        parsed.data,
      ),
    );
  } catch (err) {
    return actionErrorFrom(err, "Username sudah dipakai akun aktif.");
  }

  return redirect("/pengguna");
}

export default function PenggunaBaru({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [role, setRole] = useState("kasir");
  const [storeId, setStoreId] = useState("none");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Tambah pengguna"
          description="Buat akun admin atau kasir untuk bisnis ini."
          backTo="/pengguna"
        />
      </div>

      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-4 pt-6">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Form method="post" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  pattern="[a-z0-9._-]{3,32}"
                  maxLength={32}
                  placeholder="contoh: kasir-sari"
                />
                <p className="text-xs text-muted-foreground">
                  3-32 karakter: huruf kecil, angka, titik, garis bawah, tanda
                  hubung.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Nama tampil</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Contoh: Sari"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <input type="hidden" name="role" value={role} />
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="role" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kasir">Kasir</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Toko</Label>
                <input
                  type="hidden"
                  name="storeId"
                  value={storeId === "none" ? "" : storeId}
                />
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger aria-label="Toko">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa toko</SelectItem>
                    {loaderData.stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Kasir harus terikat ke satu toko agar bisa menjual.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxDiscountPct">Batas diskon (%)</Label>
                <Input
                  id="maxDiscountPct"
                  name="maxDiscountPct"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  defaultValue={0}
                  disabled={role === "admin"}
                />
                <p className="text-xs text-muted-foreground">
                  Admin selalu leluasa memberi diskon (100%).
                </p>
              </div>
            </div>

            <Button type="submit" disabled={busy}>
              {busy ? "Menyimpan..." : "Buat akun"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
