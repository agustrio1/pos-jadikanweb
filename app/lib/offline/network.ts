// Membedakan kegagalan jaringan dari error server (500, 403, redirect, dll).
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Response) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  return error instanceof TypeError;
}