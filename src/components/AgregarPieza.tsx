"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buscarPorCodigo, type ArticuloEscaneado } from "@/app/(app)/inventario/actions";
import { agregarPieza } from "@/app/(app)/ordenes/actions";
import EscanerCamara from "./EscanerCamara";

// Agrega piezas a un trabajo de la orden escaneando el código; descuenta del inventario al instante
export default function AgregarPieza({
  ordenId,
  sucursalId,
  trabajos,
  ubicaciones,
}: {
  ordenId: string;
  sucursalId: string;
  trabajos: { id: string; descripcion: string }[];
  ubicaciones: { id: string; codigo: string }[];
}) {
  const router = useRouter();
  const [trabajo, setTrabajo] = useState(trabajos[0]?.id ?? "");
  const [codigo, setCodigo] = useState("");
  const [articulo, setArticulo] = useState<ArticuloEscaneado | null>(null);
  const [ubicacion, setUbicacion] = useState(ubicaciones[0]?.id ?? "");
  const [cantidad, setCantidad] = useState("1");
  const [porEscaneo, setPorEscaneo] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pendiente, start] = useTransition();
  const refCodigo = useRef<HTMLInputElement>(null);
  const refCantidad = useRef<HTMLInputElement>(null);

  if (trabajos.length === 0) return <p className="muted">Agrega primero un trabajo para poder cargarle piezas.</p>;

  function buscar(c: string, escaneado: boolean) {
    const limpio = c.trim();
    if (!limpio) return;
    setMsg(null);
    start(async () => {
      const a = await buscarPorCodigo(limpio, sucursalId);
      if (!a) {
        setArticulo(null);
        setMsg({ tipo: "error", texto: `No hay ningún artículo con el código “${limpio}”.` });
        refCodigo.current?.select();
        return;
      }
      setArticulo(a);
      setPorEscaneo(escaneado);
      setCodigo("");
      const conStock = [...a.existencias].sort((x, y) => y.cantidad - x.cantidad)[0];
      if (conStock && conStock.cantidad > 0) setUbicacion(conStock.ubicacion_id);
      setTimeout(() => refCantidad.current?.select(), 0);
    });
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!articulo) return;
    const cant = Number(cantidad.replace(",", "."));
    setMsg(null);
    start(async () => {
      const r = await agregarPieza({ orden_id: ordenId, orden_servicio_id: trabajo, articulo_id: articulo.id, ubicacion_id: ubicacion, cantidad: cant, metodo: porEscaneo ? "escaneo" : "manual" });
      if (r.error) {
        setMsg({ tipo: "error", texto: r.error });
        return;
      }
      setMsg({ tipo: "ok", texto: `${articulo.nombre} ×${cant}: ${r.ok}` });
      setArticulo(null);
      setCantidad("1");
      router.refresh();
      setTimeout(() => refCodigo.current?.focus(), 0);
    });
  }

  const hay = (u: string) => articulo?.existencias.find((e) => e.ubicacion_id === u)?.cantidad ?? 0;

  return (
    <div className="form">
      {trabajos.length > 1 && (
        <div className="field">
          <label htmlFor="p-trab">Para el trabajo</label>
          <select id="p-trab" value={trabajo} onChange={(e) => setTrabajo(e.target.value)}>
            {trabajos.map((t) => <option key={t.id} value={t.id}>{t.descripcion}</option>)}
          </select>
        </div>
      )}
      <form className="scan" onSubmit={(e) => { e.preventDefault(); buscar(codigo, true); }}>
        <input ref={refCodigo} aria-label="Código de barras o SKU de la pieza" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanea la pieza o escribe el SKU y pulsa Enter" autoComplete="off" />
        <button className="btn" type="submit" disabled={pendiente}>Buscar</button>
      </form>
      <EscanerCamara onCodigo={(c) => { setCodigo(c); buscar(c, true); }} />
      {msg && <div className={`alert ${msg.tipo}`} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</div>}
      {articulo && (
        <form className="form" onSubmit={guardar}>
          <div className="row">
            <b>{articulo.nombre}</b>
            <span className="muted mono">{articulo.sku}</span>
            <button type="button" className="btn small" onClick={() => setArticulo(null)}>Cambiar</button>
          </div>
          <div className="fields">
            <div className="field">
              <label htmlFor="p-cant">Cantidad ({articulo.unidad})</label>
              <input ref={refCantidad} id="p-cant" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="p-ubic">Se toma de</label>
              <select id="p-ubic" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo} · hay {hay(u.id)}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={pendiente}>{pendiente ? "Agregando…" : "Agregar a la orden"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
