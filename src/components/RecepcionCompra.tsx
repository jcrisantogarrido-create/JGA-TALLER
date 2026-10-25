"use client";

import { useEffect, useState, useTransition } from "react";
import { recibirPedido } from "@/app/(app)/compras/actions";
import EscanerCamara from "./EscanerCamara";

type Linea = { id: string; sku: string; codigo_barras: string | null; nombre: string; unidad: string; pendiente: number };

// Recepción de mercancía: cada escaneo suma 1 a su línea; también se puede escribir la cantidad
export default function RecepcionCompra({ ocId, lineas, ubicaciones }: { ocId: string; lineas: Linea[]; ubicaciones: { id: string; codigo: string }[] }) {
  const [cant, setCant] = useState<Record<string, string>>(() => Object.fromEntries(lineas.map((l) => [l.id, String(l.pendiente)])));
  const [ubicacion, setUbicacion] = useState(ubicaciones[0]?.id ?? "");
  const [referencia, setReferencia] = useState("");
  const [codigo, setCodigo] = useState("");
  const [escaneo, setEscaneo] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pendiente, start] = useTransition();

  // Tras registrar, el pedido se recarga: las cantidades vuelven a ser lo que falta
  const firma = lineas.map((l) => `${l.id}:${l.pendiente}`).join();
  useEffect(() => {
    setCant(Object.fromEntries(lineas.map((l) => [l.id, String(l.pendiente)])));
    setEscaneo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  function escanear(c: string) {
    const v = c.trim();
    if (!v) return;
    const l = lineas.find((x) => x.codigo_barras === v || x.sku.toLowerCase() === v.toLowerCase());
    if (!l) {
      setMsg({ tipo: "error", texto: `“${v}” no está en este pedido.` });
      return;
    }
    // El primer escaneo cambia a modo conteo: todas las líneas empiezan en cero
    const base = escaneo ? cant : Object.fromEntries(lineas.map((x) => [x.id, "0"]));
    const nuevo = Number(base[l.id] || 0) + 1;
    setEscaneo(true);
    setCant({ ...base, [l.id]: String(nuevo) });
    setMsg(nuevo > l.pendiente ? { tipo: "error", texto: `${l.nombre}: llevas ${nuevo} y solo faltaban ${l.pendiente}.` } : { tipo: "ok", texto: `${l.nombre}: ${nuevo} de ${l.pendiente}` });
    setCodigo("");
  }

  function recibir(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await recibirPedido({
        oc_id: ocId,
        ubicacion_id: ubicacion,
        referencia,
        metodo: escaneo ? "escaneo" : "manual",
        lineas: lineas.map((l) => ({ id: l.id, cantidad: Number((cant[l.id] || "0").replace(",", ".")) })),
      });
      setMsg(r.error ? { tipo: "error", texto: r.error } : { tipo: "ok", texto: r.ok ?? "Recibido." });
      if (!r.error) setReferencia("");
    });
  }

  return (
    <div className="form">
      <form className="scan" onSubmit={(e) => { e.preventDefault(); escanear(codigo); }}>
        <input aria-label="Escanear artículo recibido" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanea cada pieza que llega (suma 1)" autoComplete="off" />
        <button className="btn" type="submit">Contar</button>
      </form>
      <EscanerCamara onCodigo={escanear} />
      {msg && <div className={`alert ${msg.tipo}`} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</div>}
      <form className="form" onSubmit={recibir}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Artículo</th><th>Faltan</th><th>Llegó</th></tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id}>
                  <td>{l.nombre} <span className="muted mono">{l.sku}</span></td>
                  <td className="num">{l.pendiente} {l.unidad}</td>
                  <td><input className="mini" aria-label={`Cantidad recibida de ${l.nombre}`} inputMode="decimal" value={cant[l.id] ?? ""} onChange={(e) => setCant({ ...cant, [l.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="fields">
          <div className="field">
            <label htmlFor="rc-ref">Factura o remisión</label>
            <input id="rc-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} required placeholder="F-12345" />
          </div>
          <div className="field">
            <label htmlFor="rc-ubic">Se guarda en</label>
            <select id="rc-ubic" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
              {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
            </select>
          </div>
        </div>
        <div className="row"><button className="btn primary" type="submit" disabled={pendiente}>{pendiente ? "Registrando…" : "Registrar entrada al inventario"}</button></div>
      </form>
    </div>
  );
}
