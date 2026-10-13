import { data } from "react-router";

// Error yang pesannya aman ditampilkan ke pengguna.
export class UserError extends Error {}

export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    current = record.cause;
  }
  return false;
}

// Dipakai di catch pada action: mengubah error yang dikenal jadi respons,
// sisanya dilempar ulang.
export function actionErrorFrom(err: unknown, uniqueMessage: string) {
  if (err instanceof UserError) {
    return data({ error: err.message }, { status: 400 });
  }
  if (isUniqueViolation(err)) {
    return data({ error: uniqueMessage }, { status: 409 });
  }
  throw err;
}