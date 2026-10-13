import { useEffect } from "react";
import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/_app";
import { requireUser } from "~/.server/auth/session";
import { AppSidebar } from "~/components/app-sidebar";
import { OnlineBadge } from "~/components/online-badge";
import { PwaRegister } from "~/components/pwa-register";
import { SyncManager } from "~/components/sync-manager";
import { Separator } from "~/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { getMeta, setMeta } from "~/lib/offline/db";
import { isNetworkError } from "~/lib/offline/network";
import { flushOutbox } from "~/lib/offline/sync-engine";
import type { SessionUser } from "~/lib/offline/types";

export function links() {
  return [
    { rel: "manifest", href: "/manifest.webmanifest" },
    { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const session: SessionUser = {
    name: user.name,
    role: user.role,
    storeId: user.storeId ?? null,
    maxDiscountPct: user.maxDiscountPct,
  };
  return { user: session };
}

// Navigasi di sisi klien saat jaringan putus: pakai identitas terakhir yang
// tersimpan di perangkat. Otorisasi sebenarnya tetap diperiksa server pada
// setiap request online.
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const user = await getMeta<SessionUser>("user");
    if (!user) throw redirect("/login");
    return { user };
  }
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  useEffect(() => {
        // Identitas toko harus tersimpan dulu; sinkronisasi memakainya untuk
    // menyaring antrean menurut toko.
    void setMeta("user", user)
      .then(() => flushOutbox())
      .catch(() => {});
  }, [user]);

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <AppSidebar user={{ name: user.name, role: user.role }} />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <span className="text-sm text-muted-foreground">POS JadikanWeb</span>
            <div className="ml-auto flex items-center gap-2">
              <SyncManager />
              <OnlineBadge />
            </div>
          </header>
          <div className="flex-1 p-4 md:p-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <PwaRegister />
    </TooltipProvider>
  );
}