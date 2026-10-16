import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("struk/:id", "routes/struk.tsx"),
  route("api/catalog", "routes/api.catalog.ts"),
  route("api/sync", "routes/api.sync.ts"),
  route("laporan/csv", "routes/laporan-csv.ts"),
  layout("routes/_app.tsx", [
    index("routes/home.tsx"),
    route("kasir", "routes/kasir.tsx"),
    route("retur", "routes/retur.tsx"),
    route("penjualan", "routes/penjualan.tsx"),
    route("sinkronisasi", "routes/sinkronisasi.tsx"),
    route("laporan", "routes/laporan.tsx"),
    route("kategori", "routes/kategori.tsx"),
    route("pengguna", "routes/pengguna.tsx"),
    route("pengguna/baru", "routes/pengguna-baru.tsx"),
    route("toko", "routes/toko.tsx"),
    route("produk", "routes/produk.tsx"),
    route("produk/baru", "routes/produk-baru.tsx"),
    route("produk/:id", "routes/produk-detail.tsx"),
    route("stok", "routes/stok.tsx"),
    route("stok/riwayat", "routes/stok-riwayat.tsx"),
  ]),
] satisfies RouteConfig;