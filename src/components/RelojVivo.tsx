"use client";

import { useEffect, useState } from "react";

// Tiempo transcurrido de un reloj encendido, actualizado cada segundo
export default function RelojVivo({ desde }: { desde: string }) {
  const [ahora, setAhora] = useState<number | null>(null);
  useEffect(() => {
    setAhora(Date.now());
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (ahora === null) return <span className="reloj corriendo">…</span>;
  const s = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return <span className="reloj corriendo">{p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>;
}
