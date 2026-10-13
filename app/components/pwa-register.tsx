import { useEffect } from "react";
import { useLocation } from "react-router";

const supported = () =>
  import.meta.env.PROD && typeof navigator !== "undefined" &&
  "serviceWorker" in navigator;

export function PwaRegister() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!supported()) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error) =>
        console.error("Gagal mendaftarkan service worker:", error),
      );
    // Minta browser agar tidak menghapus data situs saat penyimpanan menipis.
    // Hasilnya bergantung pada browser dan bisa ditolak.
    void navigator.storage?.persist?.();
  }, []);

  // Setelah service worker aktif, minta ia menyimpan aset halaman yang
  // sedang terbuka (dimuat sebelum worker mengendalikan halaman).
  useEffect(() => {
    if (!supported()) return;
    let cancelled = false;

    navigator.serviceWorker.ready.then((registration) => {
      if (cancelled || !registration.active) return;
      const urls = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => new URL(name).pathname.startsWith("/assets/"));
      if (pathname === "/kasir") urls.push(`${location.origin}/kasir`);
      registration.active.postMessage({ type: "CACHE_URLS", urls });
    });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}