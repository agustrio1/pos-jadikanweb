// Pemeriksaan asal permintaan untuk endpoint JSON bercookie (route resource).
// Route UI sudah dilindungi pemeriksaan Origin bawaan React Router.

function forbidden() {
  return Response.json(
    { error: "Asal permintaan tidak diizinkan." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export function assertSameOrigin(request: Request): void {
  // Browser modern mengirim Sec-Fetch-Site. Sibling subdomain bernilai
  // "same-site", bukan "same-origin", sehingga ikut ditolak.
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") throw forbidden();

  // fetch POST dari browser selalu menyertakan Origin.
  const origin = request.headers.get("Origin");
  if (!origin) throw forbidden();

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden();
  }

  const host =
    request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim() ||
    request.headers.get("Host") ||
    new URL(request.url).host;

  if (originHost !== host) throw forbidden();
}