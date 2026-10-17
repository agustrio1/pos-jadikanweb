import {
  BarCode01Icon,
  Clock01Icon,
  DeliveryTruck01Icon,
  Home01Icon,
  Invoice01Icon,
  Layers01Icon,
  Money01Icon,
  PackageIcon,
  ShoppingCart01Icon,
  ShoppingBag01Icon,
  StoreAdd01Icon,
  Tag01Icon,
  UserGroupIcon,
  WarehouseIcon,
} from "@hugeicons/core-free-icons";

// Sumber tunggal daftar navigasi. Dipakai sidebar dan pencarian global
// (command palette) agar keduanya selalu konsisten.
export type NavItem = {
  to: string;
  label: string;
  icon: typeof Home01Icon;
  // Hanya halaman ini yang berfungsi tanpa internet.
  offlineReady?: boolean;
  // Cocokkan path persis (bukan awalan) untuk menandai item aktif.
  exact?: boolean;
  // Deskripsi singkat untuk hasil pencarian.
  hint?: string;
};

export type NavGroup = {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    label: "Umum",
    items: [{ to: "/", label: "Beranda", icon: Home01Icon, exact: true }],
  },
  {
    label: "Penjualan",
    items: [
      {
        to: "/kasir",
        label: "Kasir",
        icon: ShoppingCart01Icon,
        offlineReady: true,
        hint: "Buat transaksi baru",
      },
      { to: "/penjualan", label: "Riwayat penjualan", icon: Invoice01Icon },
      {
        to: "/pelanggan",
        label: "Pelanggan",
        icon: UserGroupIcon,
        hint: "Loyalti & piutang",
      },
      { to: "/kas-shift", label: "Kas & Shift", icon: Money01Icon },
    ],
  },
  {
    label: "Laporan",
    adminOnly: true,
    items: [{ to: "/laporan", label: "Laporan", icon: Invoice01Icon }],
  },
  {
    label: "Katalog",
    adminOnly: true,
    items: [
      { to: "/produk", label: "Produk", icon: PackageIcon },
      { to: "/kategori", label: "Kategori", icon: Tag01Icon },
      {
        to: "/label-barcode",
        label: "Label Barcode",
        icon: BarCode01Icon,
        hint: "Cetak sticker barcode",
      },
    ],
  },
  {
    label: "Persediaan",
    adminOnly: true,
    items: [
      { to: "/stok", label: "Stok", icon: Layers01Icon, exact: true },
      { to: "/stok/riwayat", label: "Riwayat stok", icon: Clock01Icon },
      { to: "/opname", label: "Opname", icon: WarehouseIcon },
    ],
  },
  {
    label: "Pembelian",
    adminOnly: true,
    items: [
      { to: "/pembelian", label: "Pembelian", icon: ShoppingBag01Icon },
      { to: "/pemasok", label: "Pemasok", icon: DeliveryTruck01Icon },
    ],
  },
  {
    label: "Administrasi",
    adminOnly: true,
    items: [
      { to: "/pengguna", label: "Pengguna", icon: UserGroupIcon },
      { to: "/toko", label: "Toko", icon: StoreAdd01Icon },
      { to: "/riwayat-aksi", label: "Riwayat Aksi", icon: Clock01Icon },
    ],
  },
];

// Daftar datar untuk pencarian; hanya menyertakan halaman yang dapat diakses
// sesuai peran. Item adminOnly tidak ikut bila peran bukan admin.
export function flattenNav(role: "admin" | "kasir") {
  const flat: (NavItem & { group: string })[] = [];
  for (const group of navGroups) {
    if (group.adminOnly && role !== "admin") continue;
    for (const item of group.items) {
      flat.push({ ...item, group: group.label });
    }
  }
  return flat;
}
