import { data, Form, useNavigation } from "react-router";
import type { Route } from "./+types/kategori";
import { requireAdminStore } from "~/.server/auth/guards";
import { withDb } from "~/.server/db/client";
import { actionErrorFrom } from "~/.server/errors";
import {
  createCategory,
  listCategories,
} from "~/.server/services/catalog";
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
import { categorySchema, describeZodError } from "~/lib/schemas";

export function meta() {
  return [{ title: "Kategori | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireAdminStore(request);
  const categories = await withDb((db) => listCategories(db, user.businessId));
  return { categories };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireAdminStore(request);
  const form = await request.formData();
  const parsed = categorySchema.safeParse({ name: form.get("name") ?? "" });

  if (!parsed.success) {
    return data({ error: describeZodError(parsed.error) }, { status: 400 });
  }

  try {
    await withDb((db) =>
      createCategory(db, user.businessId, parsed.data.name),
    );
  } catch (err) {
    return actionErrorFrom(err, "Nama kategori sudah dipakai.");
  }

  return { ok: true as const };
}

export default function Kategori({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const error =
    actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Kategori"
        description="Kelompokkan produk agar mudah dicari."
      />

      <Card>
        <CardHeader>
          <CardTitle>Tambah kategori</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form method="post" className="flex gap-2">
            <Input
              name="name"
              required
              maxLength={60}
              placeholder="Contoh: Minuman"
              aria-label="Nama kategori"
            />
            <Button type="submit" disabled={busy}>
              Tambah
            </Button>
          </Form>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Daftar kategori
            <Badge variant="secondary">{loaderData.categories.length}</Badge>
          </CardTitle>
          <CardDescription>Urut abjad.</CardDescription>
        </CardHeader>
        <CardContent>
          {loaderData.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada kategori.
            </p>
          ) : (
            <ul className="divide-y">
              {loaderData.categories.map((c) => (
                <li key={c.id} className="py-2 text-sm">
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}