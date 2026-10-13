import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { createCookie, redirect } from "react-router";
import { withDb } from "../db/client";
import { sessions, users } from "../db/schema";

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const sessionCookie = createCookie("pos_session", {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
});

export type AuthUser = {
  id: string;
  businessId: string;
  storeId: string | null;
  username: string;
  name: string;
  role: "admin" | "kasir";
  maxDiscountPct: number;
};

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

// Mengembalikan nilai header Set-Cookie.
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);

  await withDb(async (db) => {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    });
  });

  return sessionCookie.serialize(token);
}

export async function getUser(request: Request): Promise<AuthUser | null> {
  const token = await sessionCookie.parse(request.headers.get("Cookie"));
  if (typeof token !== "string" || token.length === 0) return null;

  const rows = await withDb((db) =>
    db
      .select({
        id: users.id,
        businessId: users.businessId,
        storeId: users.storeId,
        username: users.username,
        name: users.name,
        role: users.role,
        maxDiscountPct: users.maxDiscountPct,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          gt(sessions.expiresAt, new Date()),
          eq(users.isActive, true),
        ),
      )
      .limit(1),
  );

  return rows[0] ?? null;
}

// api: true -> balas 401 JSON (untuk fetch dari client), bukan redirect.
export async function requireUser(
  request: Request,
  opts: { role?: AuthUser["role"]; api?: boolean } = {},
): Promise<AuthUser> {
  const user = await getUser(request);

  if (!user) {
    if (opts.api) {
      throw Response.json({ error: "unauthorized" }, { status: 401 });
    }
    throw redirect("/login");
  }

  if (opts.role && user.role !== opts.role) {
    throw Response.json({ error: "forbidden" }, { status: 403 });
  }

  return user;
}

// Mengembalikan nilai header Set-Cookie yang menghapus cookie.
export async function destroySession(request: Request): Promise<string> {
  const token = await sessionCookie.parse(request.headers.get("Cookie"));
  if (typeof token === "string" && token.length > 0) {
    await withDb((db) =>
      db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))),
    );
  }
  return sessionCookie.serialize("", { maxAge: 0 });
}