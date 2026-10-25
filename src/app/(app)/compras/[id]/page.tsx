import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil } from "@/lib/sesion";
import { ESTADOS_OC, type EstadoOC } from "@/lib/tipos";
import { dinero, fechaHora } from "@/lib/fechas";
import FormSimple from "@/components/FormSimple";
import AgregarLineaCompra, { type ArticuloCompra } from "@/components/AgregarLineaCompra";
import RecepcionCompra from "@/components/RecepcionCompra";
import { actualizarLinea, cambiarEstadoPedido, guardarPedido, quitarLinea } from "../actions";

export const metadata: Metadata = { title: "Pedido a proveedor" };

const MENSAJES: Record<string, string> = {
  transicion: "Ese cambio de estado no es válido desde el estado actual.",
  vacio: "Agrega al menos un artículo antes de enviar el pedido.",
};

type Linea = {
  id: string; cantidad: number; costo_unitario: number; cantidad_recibida: number;
  articulos: { id: string; sku: string; codigo_barras: string | null; nombre: string; unidad: string } | null;
};

export default async function PedidoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requierePerfil(["admin", "gerente"]);
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ordenes_compra")
    .select("id, folio, estado, fecha_esperada, notas, created_at, sucursal_id, proveedor_id, proveedores(nombre, contacto, telefono, email, condiciones_pago, dias_entrega), sucursales(nombre, zona_horaria), perfiles(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const oc = data as unknown as {
    id: string; folio: number; estado: EstadoOC; fecha_esperada: string | null; notas: string | null; created_at: string; sucursal_id: string; proveedor_id: string;
    proveedores: { nombre: string; contacto: string | null; telefono: string | null; email: string | null; condiciones_pago: string | null; dias_entrega: number | null } | null;
    sucursales: { nombre: string; zona_horaria: string } | null; perfiles: { nombre: string } | null;
  };
  const borrador = oc.estado === "borrador";
  const porRecibir = oc.estado === "enviada" || oc.estado === "parcial";

  const [{ data: lineasData }, { data: ubicaciones }, catalogo, { data: entradas }] = await Promise.all([
    supabase.from("ordenes_compra_lineas").select("id, cantidad, costo_unitario, cantidad_recibida, articulos(id, sku, codigo_barras, nombre, unidad)").eq("orden_compra_id", id).order("id"),
    supabase.from("ubicaciones").select("id, codigo").eq("sucursal_id", oc.sucursal_id).eq("activa", true).order("codigo"),
    borrador
      ? Promise.all([
          supabase.from("articulos").select("id, sku, codigo_barras, nombre, unidad, ultimo_costo, costo_promedio").eq("activo", true).order("nombre").limit(2000),
          supabase.from("articulo_proveedores").select("articulo_id, costo").eq("proveedor_id", oc.proveedor_id),
          supabase.from("parametros_stock").select("articulo_id, cantidad_reorden").eq("sucursal_id", oc.sucursal_id),
        ])
      : Promise.resolve(null),
    supabase.from("v_kardex").select("id, fecha, articulo, entrada, ubicacion, referencia, usuario").like("documento", `OC ${oc.folio}`).order("fecha", { ascending: false }),
  ]);
  const lineas = (lineasData as unknown as Linea[]) ?? [];
  const total = lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.costo_unitario), 0);
  const tz = oc.sucursales?.zona_horaria ?? "America/Lima";

  let articulos: ArticuloCompra[] = [];
  if (catalogo) {
    const [{ data: arts }, { data: ap }, { data: params }] = catalogo;
    const costoProv = new Map((ap ?? []).map((x) => [x.articulo_id as string, Number(x.costo)]));
    const reorden = new Map((params ?? []).map((x) => [x.articulo_id as string, Number(x.cantidad_reorden)]));
    articulos = ((arts as { id: string; sku: string; codigo_barras: string | null; nombre: string; unidad: string; ultimo_costo: number | null; costo_promedio: number }[]) ?? []).map((a) => ({
      id: a.id, sku: a.sku, codigo_barras: a.codigo_barras, nombre: a.nombre, unidad: a.unidad,
      costo: costoProv.get(a.id) ?? Number(a.ultimo_costo ?? a.costo_promedio ?? 0),
      sugerido: reorden.get(a.id) || null,
    }));
  }

  // Texto del pedido para mandarlo por WhatsApp o correo
  const textoPedido = [
    `Pedido OC ${oc.folio} de ${oc.sucursales?.nombre ?? "Taller JGA"}`,
    ...lineas.map((l) => `- ${Number(l.cantidad)} ${l.articulos?.unidad} ${l.articulos?.nombre} (${l.articulos?.sku})`),
    oc.fecha_esperada ? `Lo necesitamos para el ${oc.fecha_esperada}.` : "",
    "Gracias.",
  ].filter(Boolean).join("\n");
  const tel = oc.proveedores?.telefono?.replace(/\D/g, "");

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/compras">Compras</Link> /</p>
          <h1>OC {oc.folio} · {oc.proveedores?.nombre}</h1>
          <p className="sub">
            {oc.sucursales?.nombre} · creado {fechaHora(oc.created_at, tz)}{oc.perfiles && ` por ${oc.perfiles.nombre}`}
            {oc.proveedores?.condiciones_pago && ` · pago ${oc.proveedores.condiciones_pago}`}
          </p>
        </div>
        <span className={`chip ${oc.estado}`} style={{ fontSize: 14 }}>{ESTADOS_OC[oc.estado]}</span>
      </div>

      {error && <div className="alert error" role="alert">{MENSAJES[error] ?? error}</div>}

      <div className="row">
        {borrador && (
          <form action={cambiarEstadoPedido.bind(null, oc.id, oc.estado, "enviada")}>
            <button className="btn primary" type="submit">Marcar como enviado al proveedor</button>
          </form>
        )}
        {oc.estado === "enviada" && (
          <form action={cambiarEstadoPedido.bind(null, oc.id, oc.estado, "borrador")}>
            <button className="btn" type="submit">Volver a borrador para editar</button>
          </form>
        )}
        {lineas.length > 0 && (borrador || oc.estado === "enviada") && tel && (
          <a className="btn" href={`https://wa.me/${tel}?text=${encodeURIComponent(textoPedido)}`} target="_blank" rel="noreferrer">Mandar por WhatsApp</a>
        )}
        {lineas.length > 0 && (borrador || oc.estado === "enviada") && oc.proveedores?.email && (
          <a className="btn" href={`mailto:${oc.proveedores.email}?subject=${encodeURIComponent(`Pedido OC ${oc.folio}`)}&body=${encodeURIComponent(textoPedido)}`}>Mandar por correo</a>
        )}
        {(borrador || porRecibir) && (
          <form action={cambiarEstadoPedido.bind(null, oc.id, oc.estado, "cancelada")}>
            <button className="btn danger" type="submit">{oc.estado === "parcial" ? "Cerrar (lo que falta ya no llegará)" : "Cancelar pedido"}</button>
          </form>
        )}
      </div>

      <section className="panel">
        <h2>Artículos <span className="muted num" style={{ fontSize: 15 }}>{dinero(total)}</span></h2>
        {lineas.length === 0 ? (
          <div className="empty">El pedido está vacío. Agrega artículos abajo.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Artículo</th><th>Pedido</th><th>Recibido</th><th>Costo</th><th>Importe</th>{borrador && <th></th>}</tr></thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td>{l.articulos?.nombre} <span className="muted mono">{l.articulos?.sku}</span></td>
                    <td className="num">{Number(l.cantidad)} {l.articulos?.unidad}</td>
                    <td className="num" style={{ color: Number(l.cantidad_recibida) >= Number(l.cantidad) ? "var(--ok)" : undefined }}>{Number(l.cantidad_recibida)}</td>
                    <td className="num">{dinero(l.costo_unitario)}</td>
                    <td className="num">{dinero(Number(l.cantidad) * Number(l.costo_unitario))}</td>
                    {borrador && (
                      <td>
                        <details>
                          <summary className="btn small">Editar</summary>
                          <div style={{ marginTop: 8, minWidth: 260 }}>
                            <FormSimple accion={actualizarLinea} textoBoton="Guardar" limpiar={false}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="oc_id" value={oc.id} />
                              <div className="fields">
                                <div className="field"><label htmlFor={`lq-${l.id}`}>Cantidad</label><input id={`lq-${l.id}`} name="cantidad" inputMode="decimal" defaultValue={Number(l.cantidad)} /></div>
                                <div className="field"><label htmlFor={`lc-${l.id}`}>Costo</label><input id={`lc-${l.id}`} name="costo" inputMode="decimal" defaultValue={Number(l.costo_unitario)} /></div>
                              </div>
                            </FormSimple>
                            <form action={quitarLinea.bind(null, l.id, oc.id)} style={{ marginTop: 6 }}>
                              <button className="btn small danger" type="submit">Quitar del pedido</button>
                            </form>
                          </div>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {borrador && <AgregarLineaCompra ocId={oc.id} articulos={articulos} />}
      </section>

      {porRecibir && (
        <section className="panel">
          <h2>Recibir mercancía</h2>
          <RecepcionCompra
            ocId={oc.id}
            ubicaciones={ubicaciones ?? []}
            lineas={lineas
              .filter((l) => Number(l.cantidad_recibida) < Number(l.cantidad))
              .map((l) => ({ id: l.id, sku: l.articulos?.sku ?? "", codigo_barras: l.articulos?.codigo_barras ?? null, nombre: l.articulos?.nombre ?? "", unidad: l.articulos?.unidad ?? "", pendiente: Number(l.cantidad) - Number(l.cantidad_recibida) }))}
          />
          <p className="muted" style={{ fontSize: 13 }}>La entrada actualiza existencias y costo promedio, y queda en el kardex con el folio del pedido y la factura.</p>
        </section>
      )}

      <div className="grid2">
        <section className="panel">
          <h2>Datos del pedido</h2>
          {borrador || porRecibir ? (
            <FormSimple accion={guardarPedido} textoBoton="Guardar" limpiar={false}>
              <input type="hidden" name="id" value={oc.id} />
              <div className="fields">
                <div className="field"><label htmlFor="oc-fecha">Fecha esperada</label><input id="oc-fecha" name="fecha_esperada" type="date" defaultValue={oc.fecha_esperada ?? ""} /></div>
                <div className="field wide"><label htmlFor="oc-notas">Notas</label><textarea id="oc-notas" name="notas" defaultValue={oc.notas ?? ""} /></div>
              </div>
            </FormSimple>
          ) : (
            <dl className="kv"><dt>Fecha esperada</dt><dd>{oc.fecha_esperada ?? "—"}</dd><dt>Notas</dt><dd>{oc.notas ?? "—"}</dd></dl>
          )}
          <dl className="kv">
            <dt>Proveedor</dt><dd><Link href={`/compras/proveedores/${oc.proveedor_id}`}>{oc.proveedores?.nombre}</Link></dd>
            {oc.proveedores?.contacto && (<><dt>Contacto</dt><dd>{oc.proveedores.contacto}</dd></>)}
            {oc.proveedores?.telefono && (<><dt>Teléfono</dt><dd className="num">{oc.proveedores.telefono}</dd></>)}
            {oc.proveedores?.email && (<><dt>Correo</dt><dd>{oc.proveedores.email}</dd></>)}
          </dl>
        </section>
        <section className="panel">
          <h2>Entradas registradas</h2>
          {(entradas ?? []).length === 0 ? (
            <div className="empty">Aún no llega nada de este pedido.</div>
          ) : (
            <ul className="list">
              {(entradas as { id: number; fecha: string; articulo: string; entrada: number; ubicacion: string; referencia: string | null; usuario: string | null }[]).map((e) => (
                <li key={e.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}><span>{e.articulo}</span><b className="num">+{Number(e.entrada)}</b></div>
                  <div className="meta"><span className="num">{fechaHora(e.fecha, tz)}</span><span>{e.ubicacion}</span>{e.referencia && <span>Factura {e.referencia}</span>}{e.usuario && <span>{e.usuario}</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
