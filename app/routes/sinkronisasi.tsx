import { Link, data, Form, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/sinkronisasi";
import { requireStoreUser } from "~/.server/auth/store-user";
import { withDb } from "~/.server/db/client";
import {
  listOpenConflicts,
  resolveConflict,
} from "~/.server/services/sync-sales";
import { OutboxPanel } from "~/components/outbox-panel";
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
import { formatDateTime, formatReceiptNo } from "~/lib/format";
import { isNetworkError } from "~/lib/offline/network";
import { CONFLICT_LABEL } from "~/lib/offline/sync-schema";

export function meta() {
  return [{ title: "Sinkronisasi | POS JadikanWeb" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, storeId } = await requireStoreUser(request);
  const isAdmin = user.role === "admin";
  const conflicts = isAdmin
    ? await withDb((db) => listOpenConflicts(db, { storeId }))
    : [];
  return { isAdmin, conflicts };
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch (error) {
    if (isNetworkError(error)) return { isAdmin: false, conflicts: [] };
    throw error;
  }
}

const resolveSchema = z.object({
  conflictId: z.uuid(),
  note: z.string().trim().max(200),
});

export async function action({ request }: Route.ActionArgs) {
  const { user, storeId } = await requireStoreUser(request);
  if (user.role !== "admin") {
    throw new Response("Hanya admin yang dapat meninjau konflik.", {
      status: 403,
    });
  }

  const form = await request.formData();
  const parsed = resolveSchema.safeParse({
    conflictId: form.get("conflictId"),
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    return data({ error: "Data tidak valid." }, { status: 400 });
  }

  const ok = await withDb((db) =>
    resolveConflict(db, {
      storeId,
      conflictId: parsed.data.conflictId,
      userId: user.id,
      note: parsed.data.note || null,
    }),
  );
  if (!ok) {
    return data(
      { error: "Konflik tidak ditemukan atau sudah ditandai selesai." },
      { status: 404 },
    );
  }
  return data({ error: null });
}

export default function Sinkronisasi({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { isAdmin, conflicts } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <>
      <PageHeader
        title="Sinkronisasi"
        description="Status transaksi offline di perangkat ini dan konflik yang perlu ditinjau."
      />

      <div className="space-y-4">
        <OutboxPanel limit={50} />

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Konflik yang perlu ditinjau</CardTitle>
              <CardDescription>
                Transaksi tetap tercatat. Stok negatif atau harga berbeda
                perlu diperiksa, lalu ditandai selesai.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {actionData?.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{actionData.error}</AlertDescription>
                </Alert>
              ) : null}

              {conflicts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Tidak ada konflik terbuka.
                </p>
              ) : (
                <ul className="divide-y">
                  {conflicts.map((conflict) => (
                    <li key={conflict.id} className="space-y-2 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          <Link
                            to={`/struk/${conflict.saleId}`}
                            className="underline"
                          >
                            {formatReceiptNo(conflict.receiptNo)}
                          </Link>
                          {conflict.tempNo ? ` · ${conflict.tempNo}` : ""}
                        </span>
                        <Badge variant="outline">
                          {CONFLICT_LABEL[conflict.kind]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(conflict.createdAt)}
                      </p>
                      <p>{conflict.detail}</p>
                      <Form method="post" className="flex flex-wrap gap-2">
                        <input
                          type="hidden"
                          name="conflictId"
                          value={conflict.id}
                        />
                        <Input
                          name="note"
                          maxLength={200}
                          placeholder="Catatan penanganan (opsional)"
                          className="max-w-sm"
                          aria-label="Catatan penanganan"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                        >
                          Tandai selesai
                        </Button>
                      </Form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}