"use client";

import { useRef, useState, useTransition } from "react";
import { agregarLinea } from "@/app/(app)/compras/actions";
import EscanerCamara from "./EscanerCamara";

export type ArticuloCompra = { id: string; sku: string; codigo_barras: string | null; nombre: string; unidad: string; costo: number; sugerido: number | null };

// Agrega artículos a un pedido en borrador: por SKU, código de barras (lector o cámara) o nombre
export default function AgregarLineaCompra({ ocId, articulos }: { ocId: string; articulos: ArticuloCompra[] }) {
  const [texto, setTexto] = useState("");
  const [art, setArt] = useState<ArticuloCompra | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [costo, setCosto] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pendiente, start] = useTransition();
  const refTexto = useRef<HTMLInputElement>(null);
  const refCant = useRef<HTMLInputElement>(null);

  function elegir(valor: string) {
    const v = valor.trim().toLowerCase();
    if (!v) return;
    const a =
      articulos.find((x) => x.sku.toLowerCase() === v || x.codigo_barras === valor.trim()) ??
      articulos.find((x) => `${x.sku} · ${x.nombre}`.toLowerCase() === v) ??
      (articulos.filter((x) => x.nombre.toLowerCase().includes(v)).length === 1 ? articulos.find((x) => x.nombre.toLowerCase().includes(v)) : undefined);
    if (!a) {
      setMsg({ tipo: "error", texto: `No encontré “${valor}”. Escribe el SKU, escanea el código o elige de la lista.` });
      return;
    }
    setMsg(null);
    setArt(a);
    setTexto("");
    setCosto(String(a.costo ?? 0));
    setCantidad(String(a.sugerido ?? 1));
    setTimeout(() => refCant.current?.select(), 0);
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!art) return;
    start(async () => {
      const r = await agregarLinea({ oc_id: ocId, articulo_id: art.id, cantidad: Number(cantidad.replace(",", ".")), costo: Number(costo.replace(/[,$\s]/g, "")) });
      setMsg(r.error ? { tipo: "error", texto: r.error } : { tipo: "ok", texto: `${art.nombre}: ${r.ok}` });
      if (!r.error) {
        setArt(null);
        setTimeout(() => refTexto.current?.focus(), 0);
      }
    });
  }

  return (
    <div className="form">
      <form className="scan" onSubmit={(e) => { e.preventDefault(); elegir(texto); }}>
        <input ref={refTexto} list="l-art-oc" aria-label="Artículo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="SKU, código de barras o nombre del artículo" autoComplete="off" />
        <datalist id="l-art-oc">{articulos.map((a) => <option key={a.id} value={`${a.sku} · ${a.nombre}`} />)}</datalist>
        <button className="btn" type="submit">Elegir</button>
      </form>
      <EscanerCamara onCodigo={elegir} />
      {msg && <div className={`alert ${msg.tipo}`} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</div>}
      {art && (
        <form className="form" onSubmit={guardar}>
          <div className="row"><b>{art.nombre}</b><span className="muted mono">{art.sku}</span></div>
          <div className="fields">
            <div className="field">
              <label htmlFor="lc-cant">Cantidad ({art.unidad})</label>
              <input ref={refCant} id="lc-cant" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="lc-costo">Costo unitario</label>
              <input id="lc-costo" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} required />
            </div>
          </div>
          <div className="row"><button className="btn primary" type="submit" disabled={pendiente}>{pendiente ? "Agregando…" : "Agregar al pedido"}</button></div>
        </form>
      )}
    </div>
  );
}
