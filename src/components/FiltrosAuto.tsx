"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

type Campo = {
  nombre: string;
  etiqueta: string;
  tipo: "texto" | "select" | "fecha";
  opciones?: [string, string][];
  placeholder?: string;
  grow?: boolean;
  autofocus?: boolean;
};

// Filtros que se aplican solos al cambiar: listas y kardex se actualizan sin pulsar "Buscar"
export default function FiltrosAuto({ campos, valores }: { campos: Campo[]; valores: Record<string, string | undefined> }) {
  const router = useRouter();
  const ruta = usePathname();
  const [estado, setEstado] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.nombre, valores[c.nombre] ?? ""])),
  );
  const [cargando, startTransition] = useTransition();
  const primera = useRef(true);
  const textoCambio = useRef(false);

  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    const aplicar = () => {
      const p = new URLSearchParams();
      // Se conservan parámetros que no son de estos filtros (p. ej. sucursal)
      Object.entries(valores).forEach(([k, v]) => v && !campos.some((c) => c.nombre === k) && p.set(k, v));
      Object.entries(estado).forEach(([k, v]) => v && p.set(k, v));
      startTransition(() => router.replace(`${ruta}?${p.toString()}`, { scroll: false }));
    };
    if (textoCambio.current) {
      textoCambio.current = false;
      const t = setTimeout(aplicar, 350);
      return () => clearTimeout(t);
    }
    aplicar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const cambiar = (k: string, v: string, esTexto = false) => {
    textoCambio.current = esTexto;
    setEstado((e) => ({ ...e, [k]: v }));
  };
  const hayFiltros = Object.values(estado).some(Boolean);

  return (
    <form
      className="filters"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        textoCambio.current = false;
        setEstado((s) => ({ ...s }));
      }}
    >
      {campos.map((c) => (
        <div key={c.nombre} className={`field${c.grow ? " grow" : ""}`}>
          <label htmlFor={`f-${c.nombre}`}>{c.etiqueta}</label>
          {c.tipo === "select" ? (
            <select id={`f-${c.nombre}`} value={estado[c.nombre]} onChange={(e) => cambiar(c.nombre, e.target.value)}>
              {c.opciones?.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          ) : (
            <input
              id={`f-${c.nombre}`}
              type={c.tipo === "fecha" ? "date" : "search"}
              value={estado[c.nombre]}
              placeholder={c.placeholder}
              autoFocus={c.autofocus}
              onChange={(e) => cambiar(c.nombre, e.target.value, c.tipo === "texto")}
            />
          )}
        </div>
      ))}
      <div className="row" style={{ alignSelf: "end" }}>
        {hayFiltros && (
          <button type="button" className="btn small" onClick={() => setEstado(Object.fromEntries(campos.map((c) => [c.nombre, ""])))}>
            Limpiar
          </button>
        )}
        <span className="muted" style={{ fontSize: 12.5 }} aria-live="polite">{cargando ? "Actualizando…" : ""}</span>
      </div>
    </form>
  );
}
