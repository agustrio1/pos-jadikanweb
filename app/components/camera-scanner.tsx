import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";

// Pemindai barcode memakai kamera perangkat. zxing dimuat dinamis (hanya saat
// dialog terbuka) agar tidak ikut ter-bundle ke jalur render server.
type CameraScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Dipanggil sekali saat sebuah kode terbaca.
  onDetected: (code: string) => void;
};

export function CameraScanner({
  open,
  onOpenChange,
  onDetected,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Simpan callback terbaru di ref supaya effect tidak restart kamera setiap
  // render induk (identity onDetected/onOpenChange bisa berubah tiap render).
  const detectedRef = useRef(onDetected);
  detectedRef.current = onDetected;
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setReady(false);
  };

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        setReady(true);
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _err, ctrls) => {
            if (!result) return;
            const text = result.getText();
            ctrls.stop();
            controlsRef.current = null;
            openChangeRef.current(false);
            detectedRef.current(text);
          },
        );
        // Jika dialog ditutup sebelum jeda, langsung hentikan.
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch {
        setError(
          "Tidak dapat mengakses kamera. Pastikan izin kamera diizinkan dan halaman dibuka lewat HTTPS/localhost.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) stop();
        openChangeRef.current(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-xl border bg-background p-4 shadow-lg">
          <Dialog.Title className="text-base font-semibold">
            Scan barcode dengan kamera
          </Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            Arahkan kamera ke barcode produk. Kode terbaca otomatis lalu masuk ke
            keranjang.
          </Dialog.Description>

          <div className="relative aspect-4/3 overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              autoPlay
              playsInline
            />
            {!ready && !error ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
                Menyalakan kamera…
              </div>
            ) : null}
            {error ? (
              <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Dialog.Close asChild>
              <Button variant="outline" onClick={stop}>
                Tutup
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
