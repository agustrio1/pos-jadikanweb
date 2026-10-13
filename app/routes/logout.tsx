import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroySession } from "~/.server/auth/session";

export async function loader() {
  return redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  const setCookie = await destroySession(request);
  return redirect("/login", { headers: { "Set-Cookie": setCookie } });
}