"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

// Lector con la cámara del celular usando BarcodeDetector del navegador (Chrome en Android).
// Donde no existe, el botón no aparece y se usa un lector USB/Bluetooth o el teclado.
export default function EscanerCamara({ onCodigo }: { onCodigo: (codigo: string) => void }) {
  const [disponible, setDisponible] = useState(false);
  const [activo, setActivo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCodigo);
  callback.current = onCodigo;

  useEffect(() => {
    setDisponible(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (!activo) return;
    let stream: MediaStream | null = null;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector: Detector = new (window as any).BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || cancelado) return;
        video.current.srcObject = stream;
        await video.current.play();
        const ciclo = async () => {
          if (cancelado || !video.current) return;
          try {
            const r = await detector.detect(video.current);
            if (r[0]?.rawValue) {
              navigator.vibrate?.(80);
              callback.current(r[0].rawValue);
              setActivo(false);
              return;
            }
          } catch {
            /* cuadro sin código */
          }
          timer = setTimeout(ciclo, 250);
        };
        ciclo();
      } catch {
        setError("No se pudo abrir la cámara. Revisa el permiso del navegador.");
        setActivo(false);
      }
    })();
    return () => {
      cancelado = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [activo]);

  if (!disponible) return null;
  return (
    <div className="form" style={{ gap: 8 }}>
      <div className="row">
        <button type="button" className="btn small" onClick={() => { setError(null); setActivo((a) => !a); }}>
          {activo ? "Cerrar cámara" : "Escanear con la cámara"}
        </button>
        {error && <span className="muted" style={{ fontSize: 13 }}>{error}</span>}
      </div>
      {activo && <video ref={video} className="camera" muted playsInline />}
    </div>
  );
}
