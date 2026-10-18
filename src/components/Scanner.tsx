import { useEffect, useRef } from 'react';

const ID = 'cp-qr-reader';
/** Camera QR scanner (html5-qrcode, loaded on demand). Mounted = scanning; unmount to stop. */
export function Scanner({ onScan, onError }: { onScan(text: string): void; onError(message: string): void }) {
  const scanRef = useRef(onScan); scanRef.current = onScan;
  const errRef = useRef(onError); errRef.current = onError;
  useEffect(() => {
    let cancelled = false; let started = false; let scanner: { stop(): Promise<void>; clear(): void } | null = null;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const s = new Html5Qrcode(ID); scanner = s as unknown as typeof scanner;
        await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => scanRef.current(text), () => undefined);
        started = true;
        if (cancelled) { await s.stop().catch(() => undefined); }
      } catch (e) {
        errRef.current(e instanceof Error && /permission|denied/i.test(e.message)
          ? 'Camera permission was denied. Allow camera access, or enter the pass ID manually.'
          : 'The camera could not be started on this device. Enter the pass ID manually.');
      }
    })();
    return () => { cancelled = true; if (scanner && started) void scanner.stop().then(() => scanner?.clear()).catch(() => undefined); };
  }, []);
  return <div id={ID} className="aspect-square w-full overflow-hidden rounded-xl bg-black" aria-label="Camera view for scanning the QR code" />;
}
