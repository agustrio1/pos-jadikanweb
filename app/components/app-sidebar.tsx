import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons/core-free-icons";
import { Link, useFetcher, useLocation } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { clearOfflineData } from "~/lib/offline/clear";
import { countUnsent } from "~/lib/offline/logout-guard";
import { flushOutbox } from "~/lib/offline/sync-engine";
import { useOnline } from "~/lib/offline/use-online";
import { navGroups as groups, type NavItem } from "~/lib/nav";

export function AppSidebar({
  user,
}: {
  user: { name: string; role: "admin" | "kasir" };
}) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const fetcher = useFetcher();
  const online = useOnline();

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?";

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.to
      : pathname === item.to || pathname.startsWith(`${item.to}/`);

  const logout = async () => {
    // Coba kirim dulu transaksi offline yang tertunda. Jika masih ada yang
    // belum diterima server, minta konfirmasi sebelum data perangkat dihapus.
    let unsent = await countUnsent();
    if (unsent > 0) {
      await flushOutbox({ manual: true });
      unsent = await countUnsent();
    }
    if (unsent > 0) {
      const proceed = window.confirm(
                `Masih ada ${unsent} transaksi offline yang belum terkirim ke server. Data tetap tersimpan di perangkat ini dan terkirim saat Anda login lagi di sini, tetapi belum masuk laporan sampai saat itu. Tetap keluar?`,
      );
      if (!proceed) return;
    }

    await clearOfflineData();
    fetcher.submit(null, { method: "post", action: "/logout" });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link
                to={online ? "/" : "/kasir"}
                onClick={() => setOpenMobile(false)}
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                  P
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">POS JadikanWeb</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Kasir dan stok
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups
          .filter((group) => !group.adminOnly || user.role === "admin")
          .map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const disabled = !online && !item.offlineReady;
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item)}
                          tooltip={
                            disabled
                              ? `${item.label} (perlu internet)`
                              : item.label
                          }
                          className={
                            disabled ? "pointer-events-none opacity-50" : undefined
                          }
                        >
                          <Link
                            to={item.to}
                            aria-disabled={disabled}
                            tabIndex={disabled ? -1 : undefined}
                            onClick={(event) => {
                              if (disabled) {
                                event.preventDefault();
                                return;
                              }
                              setOpenMobile(false);
                            }}
                          >
                            <HugeiconsIcon icon={item.icon} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
                    {initials}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs capitalize text-muted-foreground">
                      {user.role}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {user.role}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!online} onSelect={() => void logout()}>
                  <HugeiconsIcon icon={Logout01Icon} />
                  {online ? "Keluar" : "Keluar (perlu internet)"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}