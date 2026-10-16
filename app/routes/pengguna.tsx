import { useState } from "react";
import { Link, data, Form, useNavigation } from "react-router";
import type { Route } from "./+types/pengguna";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import {
  listUsers,
  resetUserPassword,
  setActiveUser,
  updateUser,
} from "~/.server/services/users";
import { listStores } from "~/.server/services/stores";
import { PageHeader } from "~/components/page-header";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  describeZodError,
  resetPasswordSchema,
  setUserActiveSchema,
  updateUserSchema,
} from "~/lib/schemas";

export function meta() {
  return [{ title: "Pengguna | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireAdminStore(request);
  const [users, stores] = await withDb((db) =>
    Promise.all([
      listUsers(db, user.businessId),
      listStores(db, user.businessId),
    ]),
  );
  return { users, stores, selfId: user.id };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = { businessId: user.businessId, userId: user.id };

  try {
    if (intent === "toggle") {
      const parsed = setUserActiveSchema.safeParse({
        userId: form.get("userId"),
        active: form.get("active"),
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) => setActiveUser(db, actor, parsed.data));
      return { ok: true as const };
    }

    if (intent === "reset") {
      const parsed = resetPasswordSchema.safeParse({
        userId: form.get("userId"),
        password: form.get("password"),
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) => resetUserPassword(db, actor, parsed.data));
      return { ok: true as const };
    }

    if (intent === "update") {
      const parsed = updateUserSchema.safeParse({
        userId: form.get("userId"),
        name: form.get("name"),
        role: form.get("role"),
        storeId: form.get("storeId"),
        maxDiscountPct: form.get("maxDiscountPct"),
      });
      if (!parsed.success) {
        return data({ error: describeZodError(parsed.error) }, { status: 400 });
      }
      await withDb((db) => updateUser(db, actor, parsed.data));
      return { ok: true as const };
    }

    return data({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    return actionErrorFrom(err, "Username sudah dipakai.");
  }
}

const ROLE_LABEL: Record<string, string> = { admin: "Admin", kasir: "Kasir" };

function EditForm({
  userId,
  initial,
  stores,
}: {
  userId: string;
  initial: {
    name: string;
    role: "admin" | "kasir";
    storeId: string | null;
    maxDiscountPct: number;
  };
  stores: { id: string; name: string }[];
}) {
  const [name, setName] = useState(initial.name);
  const [role, setRole] = useState<string>(initial.role);
  const [storeId, setStoreId] = useState<string>(initial.storeId ?? "none");
  const [maxDiscountPct, setMaxDiscountPct] = useState<string>(
    String(initial.maxDiscountPct),
  );

  return (
    <Form method="post" className="space-y-3">
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`name-${userId}`}>Nama</Label>
          <Input
            id={`name-${userId}`}
            name="name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <input type="hidden" name="role" value={role} />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="kasir">Kasir</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Toko</Label>
          <input type="hidden" name="storeId" value={storeId === "none" ? "" : storeId} />
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger aria-label="Toko">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tanpa toko</SelectItem>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`disc-${userId}`}>Batas diskon (%)</Label>
          <Input
            id={`disc-${userId}`}
            name="maxDiscountPct"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            disabled={role === "admin"}
            value={role === "admin" ? "100" : maxDiscountPct}
            onChange={(e) => setMaxDiscountPct(e.target.value)}
          />
        </div>
      </div>
      {role === "kasir" ? (
        <p className="text-xs text-muted-foreground">
          Sebelum mengganti toko kasir, pastikan ia menyelesaikan transaksi
          dan mengosongkan antrean sinkronisasi di perangkatnya.
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="outline">
        Simpan perubahan
      </Button>
    </Form>
  );
}

export default function Pengguna({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { users, stores, selfId } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;
  const [openRow, setOpenRow] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun admin dan kasir bisnis ini."
        actions={
          <Button asChild>
            <Link to="/pengguna/baru">Tambah pengguna</Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Daftar akun</CardTitle>
          <CardDescription>
            Akun nonaktif tidak bisa masuk dan sesi aktifnya langsung berakhir.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {users.map((row) => {
              const open = openRow === row.id;
              return (
                <li key={row.id} className="px-6 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {row.username}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={row.role === "admin" ? "secondary" : "outline"}>
                        {ROLE_LABEL[row.role]}
                      </Badge>
                      <Badge variant={row.isActive ? "outline" : "destructive"}>
                        {row.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {row.storeName ?? "Tanpa toko"}
                        {row.role === "kasir"
                          ? ` · diskon maks ${row.maxDiscountPct}%`
                          : ""}
                      </span>
                      {row.id !== selfId ? (
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="toggle" />
                          <input type="hidden" name="userId" value={row.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={row.isActive ? "nonaktif" : "aktif"}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                          >
                            {row.isActive ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        </Form>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenRow(open ? null : row.id)}
                      >
                        {open ? "Tutup" : "Ubah"}
                      </Button>
                    </div>
                  </div>

                  {open ? (
                    <div className="mt-3 space-y-4 rounded-md border bg-muted/30 p-3">
                      <EditForm
                        userId={row.id}
                        stores={stores}
                        initial={{
                          name: row.name,
                          role: row.role,
                          storeId: row.storeId,
                          maxDiscountPct: row.maxDiscountPct,
                        }}
                      />
                      <div className="border-t pt-3">
                        <Form method="post" className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="intent" value="reset" />
                          <input type="hidden" name="userId" value={row.id} />
                          <div className="space-y-1.5">
                            <Label htmlFor={`pw-${row.id}`}>
                              Reset password
                            </Label>
                            <Input
                              id={`pw-${row.id}`}
                              name="password"
                              type="password"
                              required
                              minLength={8}
                              placeholder="Password baru (min. 8 karakter)"
                              className="max-w-xs"
                            />
                          </div>
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={(e) => {
                              if (
                                !window.confirm(
                                  "Reset password akan mengakhiri sesi login akun ini di semua perangkat. Lanjutkan?",
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            Reset
                          </Button>
                        </Form>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
