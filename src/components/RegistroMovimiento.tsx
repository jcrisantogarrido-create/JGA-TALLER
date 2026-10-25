"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MOVIMIENTOS_MANUALES, type TipoMovimiento } from "@/lib/tipos";
import {
  buscarPorCodigo,
  registrarMovimiento,
  transferir,
  type ArticuloEscaneado,
} from "@/app/(app)/inventario/actions";
import EscanerCamara from "./EscanerCamara";
import { dinero } from "@/lib/fechas";

type Ubicacion = { id: string; codigo: string };
type Modo = TipoMovimiento | "transferencia";


// Registro de entradas, salidas, ajustes y transferencias.
// Con `articuloFijo` trabaja sobre un artículo; sin él, empieza escaneando un código.
export default function RegistroMovimiento({
  sucursalId,
  ubicaciones,
  proveedores,
  articuloFijo,
}: {
  sucursalId: string;
  ubicaciones: Ubicacion[];
  proveedores: string[];
  articuloFijo?: ArticuloEscaneado;
}) {
  const router = useRouter();
  const [articulo, setArticulo] = useState<ArticuloEscaneado | null>(articuloFijo ?? null);
  const [codigo, setCodigo] = useState("");
  const [modo, setModo] = useState<Modo>("entrada_compra");
  const [ubicacion, setUbicacion] = useState(ubicaciones[0]?.id ?? "");
  const [destino, setDestino] = useState(ubicaciones[1]?.id ?? "");
  const [cantidad, setCantidad] = useState("1");
  const [costo, setCosto] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [referencia, setReferencia] = useState("");
  const [motivo, setMotivo] = useState("");
  const [porEscaneo, setPorEscaneo] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [historial, setHistorial] = useState<string[]>([]);
  const [pendiente, start] = useTransition();
  const refCodigo = useRef<HTMLInputElement>(null);
  const refCantidad = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (articuloFijo) setArticulo(articuloFijo);
  }, [articuloFijo]);

  // La ubicación propuesta es donde hay más existencia del artículo
  useEffect(() => {
    if (!articulo || articuloFijo) return;
    const conStock = [...articulo.existencias].sort((a, b) => b.cantidad - a.cantidad)[0];
    if (conStock && conStock.cantidad > 0) setUbicacion(conStock.ubicacion_id);
    if (articulo.costo_promedio && !costo) setCosto(String(articulo.costo_promedio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articulo]);

  function buscar(c: string, escaneado: boolean) {
    const limpio = c.trim();
    if (!limpio) return;
    setMsg(null);
    start(async () => {
      const a = await buscarPorCodigo(limpio, sucursalId);
      if (!a) {
        setArticulo(null);
        setMsg({ tipo: "error", texto: `No hay ningún artículo con el código “${limpio}”. Dalo de alta en Inventario → Nuevo artículo.` });
        refCodigo.current?.select();
        return;
      }
      setArticulo(a);
      setPorEscaneo(escaneado);
      setCodigo("");
      setTimeout(() => refCantidad.current?.select(), 0);
    });
  }

  const def = MOVIMIENTOS_MANUALES.find((m) => m.tipo === modo);
  const existenciaEn = (u: string) => articulo?.existencias.find((e) => e.ubicacion_id === u)?.cantidad ?? 0;

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!articulo) return;
    const cant = Number(cantidad.replace(",", "."));
    setMsg(null);
    start(async () => {
      const r =
        modo === "transferencia"
          ? await transferir({ articulo_id: articulo.id, origen: ubicacion, destino, cantidad: cant, metodo: porEscaneo ? "escaneo" : "manual" })
          : await registrarMovimiento({
              articulo_id: articulo.id,
              ubicacion_id: ubicacion,
              tipo: modo,
              cantidad: cant,
              costo_unitario: modo === "entrada_compra" ? Number(costo.replace(/[,$\s]/g, "")) : null,
              proveedor,
              referencia,
              motivo,
              metodo: porEscaneo ? "escaneo" : "manual",
            });
      if (r.error) {
        setMsg({ tipo: "error", texto: r.error });
        return;
      }
      const ubic = ubicaciones.find((u) => u.id === ubicacion)?.codigo;
      const linea =
        modo === "transferencia"
          ? `${articulo.nombre}: ${cant} de ${ubic} a ${ubicaciones.find((u) => u.id === destino)?.codigo}`
          : `${articulo.nombre}: ${def?.signo === 1 ? "+" : "−"}${cant} en ${ubic}${"saldo" in r && r.saldo !== undefined ? ` · queda ${r.saldo}` : ""}`;
      setHistorial((h) => [linea, ...h].slice(0, 8));
      setMsg({ tipo: "ok", texto: r.ok ?? "Registrado." });
      setCantidad("1");
      setMotivo("");
      // La factura se conserva para seguir escaneando la misma remisión; un ajuste no la arrastra
      if (modo !== "entrada_compra") setReferencia("");
      if (articuloFijo) {
        router.refresh();
      } else {
        // Listo para el siguiente escaneo; se conservan tipo, proveedor y referencia
        setArticulo(null);
        setCosto("");
        setTimeout(() => refCodigo.current?.focus(), 0);
      }
    });
  }

  return (
    <div className="form">
      <div className="tabs" role="tablist" aria-label="Tipo de movimiento">
        {[...MOVIMIENTOS_MANUALES.map((m) => [m.tipo, m.texto] as [Modo, string]), ["transferencia", "Transferencia"] as [Modo, string]].map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={modo === k} onClick={() => { setModo(k); setReferencia(""); setMotivo(""); setMsg(null); }}>
            {t}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        {modo === "transferencia" ? "Mueve existencia entre ubicaciones (almacén → bahía). No cambia el total ni el costo." : def?.ayuda}
      </p>

      {!articuloFijo && (
        <>
          <form
            className="scan"
            onSubmit={(e) => {
              e.preventDefault();
              buscar(codigo, true);
            }}
          >
            <input
              ref={refCodigo}
              id="codigo"
              aria-label="Código de barras o SKU"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Escanea el código de barras o escribe el SKU y pulsa Enter"
              autoFocus
              autoComplete="off"
            />
            <button className="btn" type="submit" disabled={pendiente}>Buscar</button>
          </form>
          <EscanerCamara onCodigo={(c) => { setCodigo(c); buscar(c, true); }} />
        </>
      )}

      {msg && <div className={`alert ${msg.tipo}`} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</div>}

      {articulo && (
        <form className="form" onSubmit={guardar}>
          {!articuloFijo && (
            <div className="panel" style={{ background: "var(--bg)" }}>
              <div className="row">
                <b>{articulo.nombre}</b>
                <span className="muted mono">{articulo.sku}</span>
                <button type="button" className="btn small" onClick={() => { setArticulo(null); refCodigo.current?.focus(); }}>Cambiar</button>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Existencia: {articulo.existencias.length === 0 ? "sin existencia" : articulo.existencias.map((e) => `${e.codigo} ${e.cantidad}`).join(" · ")} · costo promedio {dinero(articulo.costo_promedio)}
              </div>
            </div>
          )}
          <div className="fields">
            <div className="field">
              <label htmlFor="m-cant">Cantidad ({articulo.unidad})</label>
              <input ref={refCantidad} id="m-cant" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="m-ubic">{modo === "transferencia" ? "Desde" : "Ubicación"}</label>
              <select id="m-ubic" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo} · hay {existenciaEn(u.id)}</option>)}
              </select>
            </div>
            {modo === "transferencia" && (
              <div className="field">
                <label htmlFor="m-dest">Hacia</label>
                <select id="m-dest" value={destino} onChange={(e) => setDestino(e.target.value)}>
                  {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
                </select>
              </div>
            )}
            {modo === "entrada_compra" && (
              <>
                <div className="field">
                  <label htmlFor="m-costo">Costo unitario</label>
                  <input id="m-costo" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} required placeholder="0.00" />
                </div>
                <div className="field">
                  <label htmlFor="m-prov">Proveedor</label>
                  <input id="m-prov" list="l-prov" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Refaccionaria…" />
                  <datalist id="l-prov">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
                </div>
                <div className="field">
                  <label htmlFor="m-ref">Factura / remisión</label>
                  <input id="m-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="FAC-1234" />
                </div>
              </>
            )}
            {modo !== "entrada_compra" && modo !== "transferencia" && (
              <>
                <div className="field wide">
                  <label htmlFor="m-mot">Motivo</label>
                  <input id="m-mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} required placeholder={modo === "merma" ? "Envase roto" : "Conteo físico del 25 de octubre"} />
                </div>
                <div className="field">
                  <label htmlFor="m-ref2">Referencia</label>
                  <input id="m-ref2" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                </div>
              </>
            )}
          </div>
          {modo === "entrada_compra" && Number(cantidad) > 0 && Number(costo) > 0 && (
            <p className="muted" style={{ fontSize: 13 }}>Importe de la entrada: {dinero(Number(cantidad) * Number(costo))}</p>
          )}
          <div className="row">
            <button className="btn primary" type="submit" disabled={pendiente}>
              {pendiente ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </form>
      )}

      {historial.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 6 }}>Registrados en esta sesión</h3>
          <ul className="list">{historial.map((h, i) => <li key={i} className="num">{h}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
