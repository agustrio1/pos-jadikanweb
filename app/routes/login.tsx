import { eq } from "drizzle-orm";
import { data, Form, redirect, useNavigation } from "react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import type { Route } from "./+types/login";
import {
  clearFailures,
  isBlocked,
  recordFailure,
} from "~/.server/auth/rate-limit";
import { verifyPassword } from "~/.server/auth/password";
import { createSession, getUser } from "~/.server/auth/session";
import { withDb } from "~/.server/db/client";
import { users } from "~/.server/db/schema";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { loginSchema } from "~/lib/schemas";

export function meta() {
  return [{ title: "Masuk | POS JadikanWeb" }];
}

// Akun demo untuk calon klien agar bisa mencoba langsung (diisi lewat
// `bun run db:seed:demo`). Klik tombol akan mengisi form secara otomatis.
const DEMO_ACCOUNTS = [
  { label: "Admin", username: "admin", password: "password" },
  { label: "Kasir", username: "kasir", password: "kasir12345" },
];

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = loginSchema.safeParse({
    username: form.get("username"),
    password: form.get("password"),
  });

  if (!parsed.success) {
    return data({ error: "Username atau password tidak valid." }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${username}|${ip}`;

  const result = await withDb(async (db) => {
    if (await isBlocked(db, key)) return { kind: "blocked" as const };

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const ok = await verifyPassword(password, user?.passwordHash);

    if (!user || !user.isActive || !ok) {
      await recordFailure(db, key);
      return { kind: "invalid" as const };
    }

    await clearFailures(db, key);
    return { kind: "ok" as const, userId: user.id };
  });

  if (result.kind === "blocked") {
    return data(
      { error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
      { status: 429 },
    );
  }

  if (result.kind === "invalid") {
    return data({ error: "Username atau password salah." }, { status: 401 });
  }

  const setCookie = await createSession(result.userId);
  return redirect("/", { headers: { "Set-Cookie": setCookie } });
}

export default function Login({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  // Isi kolom username/password tanpa reload (input uncontrolled pada Form).
  const fill = (username: string, password: string) => {
    const u = document.getElementById("username") as HTMLInputElement | null;
    const p = document.getElementById("password") as HTMLInputElement | null;
    if (u) u.value = username;
    if (p) p.value = password;
    u?.focus();
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            P
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            POS JadikanWeb
          </h1>
          <p className="text-sm text-muted-foreground">
            Masuk untuk mulai berjualan
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Form method="post" className="space-y-4">
              {actionData?.error ? (
                <Alert variant="destructive">
                  <HugeiconsIcon icon={AlertCircleIcon} />
                  <AlertDescription>{actionData.error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Memeriksa..." : "Masuk"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardContent className="pt-6">
            <p className="text-sm font-medium">Akun demo — coba langsung</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Klik salah satu untuk mengisi otomatis, lalu tekan Masuk.
            </p>
            <div className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  onClick={() => fill(a.username, a.password)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.username} / {a.password}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-primary">
                    Isi
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}