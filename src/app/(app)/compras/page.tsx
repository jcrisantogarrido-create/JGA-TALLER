import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_OC, type EstadoOC } from "@/lib/tipos";
import { dinero, fechaHora } from "@/lib/fechas";
import FiltrosAuto from "@/components/FiltrosAuto";
import FormSimple from "@/components/FormSimple";
import { crearPedido, generarSugeridos } from "./actions";

export const metadata: Metadata = { title: "Compras" };

type Pedido = { id: string; folio: number; proveedor: string; estado: EstadoOC; moneda: string; fecha_esperada: string | null; created_at: string; lineas: number; total: number; piezas_pendientes: number };
type Alerta = {
  id: string; stock_detectado: number; punto_reorden: number; estado: string; orden_compra_id: string | null; created_at: string;
  articulos: { id: string; sku: string; nombre: string; unidad: string; articulo_proveedores: { preferido: boolean; costo: number; proveedores: { nombre: string; moneda: string } | null }[] } | null;
  ordenes_compra: { folio: number } | null;
};

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; sucursal?: string; generados?: string; error?: string }>;
}) {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const vista = sp.estado ?? "abiertos";

  let consulta = supabase.from("v_ordenes_compra").select("id, folio, proveedor, estado, moneda, fecha_esperada, created_at, lineas, total, piezas_pendientes")
    .eq("sucursal_id", sucursal.id).order("created_at", { ascending: false }).limit(200);
  if (vista === "abiertos") consulta = consulta.in("estado", ["borrador", "enviada", "parcial"]);
  else if (vista !== "todos") consulta = consulta.eq("estado", vista);

  const [{ data: pedidos }, { data: alertas }, { data: proveedores }] = await Promise.all([
    consulta,
    supabase
      .from("alertas_reabastecimiento")
      .select("id, stock_detectado, punto_reorden, estado, orden_compra_id, created_at, articulos(id, sku, nombre, unidad, articulo_proveedores(preferido, costo, proveedores(nombre, moneda))), ordenes_compra(folio)")
      .eq("sucursal_id", sucursal.id).in("estado", ["abierta", "en_compra"]).order("created_at"),
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
  ]);
  const ps = (pedidos as Pedido[]) ?? [];
  const als = (alertas as unknown as Alerta[]) ?? [];
  const abiertas = als.filter((a) => a.estado === "abierta");
  const conProveedor = abiertas.filter((a) => a.articulos?.articulo_proveedores.some((x) => x.preferido)).length;
  const tz = sucursal.zona_horaria;

  return (
    <>
      <div className="head">
        <div>
          <h1>Compras</h1>
          <p className="sub">{sucursal.nombre} · pedidos a proveedores y reabastecimiento</p>
        </div>
        <div className="row">
          <Link className="btn" href="/compras/proveedores">Proveedores</Link>
        </div>
      </div>

      {sp.error && <div className="alert error">{sp.error}</div>}
      {sp.generados !== undefined && (
        <div className="alert ok" role="status">
          {Number(sp.generados) > 0 ? (Number(sp.generados) === 1 ? "Se creó 1 pedido en borrador. Revísalo y márcalo como enviado." : `Se crearon ${sp.generados} pedidos en borrador. Revísalos y márcalos como enviados.`) : "No había artículos con alerta y proveedor preferido para pedir."}
        </div>
      )}

      <div className="stats">
        <div className="stat"><b style={{ color: abiertas.length ? "var(--warn)" : undefined }}>{abiertas.length}</b><span>Artículos por pedir</span></div>
        <div className="stat"><b>{als.length - abiertas.length}</b><span>Ya pedidos, por llegar</span></div>
        <div className="stat"><b>{ps.filter((p) => p.estado === "borrador").length}</b><span>Pedidos en borrador</span></div>
        <div className="stat"><b>{ps.filter((p) => p.estado === "enviada" || p.estado === "parcial").length}</b><span>Pedidos por recibir</span></div>
      </div>

      <section className="panel">
        <h2>
          Por reabastecer
          {conProveedor > 0 && (
            <form action={generarSugeridos.bind(null, sucursal.id)}>
              <button className="btn primary small" type="submit">Generar pedidos sugeridos ({conProveedor})</button>
            </form>
          )}
        </h2>
        {als.length === 0 ? (
          <div className="empty">Todo el inventario está por encima de su punto de reorden.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Artículo</th><th>Existencia</th><th>Punto de reorden</th><th>Proveedor preferido</th><th>Estado</th></tr></thead>
              <tbody>
                {als.map((a) => {
                  const pref = a.articulos?.articulo_proveedores.find((x) => x.preferido);
                  return (
                    <tr key={a.id}>
                      <td><Link href={`/inventario/${a.articulos?.id}`}>{a.articulos?.nombre}</Link> <span className="muted mono">{a.articulos?.sku}</span></td>
                      <td className="num">{Number(a.stock_detectado)} {a.articulos?.unidad}</td>
                      <td className="num">{Number(a.punto_reorden)}</td>
                      <td>{pref ? <>{pref.proveedores?.nombre} <span className="muted num">{dinero(pref.costo, pref.proveedores?.moneda)}</span></> : <span className="muted">Sin proveedor preferido</span>}</td>
                      <td>
                        {a.estado === "en_compra" && a.orden_compra_id
                          ? <Link className="chip enviada" href={`/compras/${a.orden_compra_id}`}>En pedido OC {a.ordenes_compra?.folio}</Link>
                          : <span className="chip bajo">Por pedir</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          Un artículo entra aquí cuando su existencia baja al punto de reorden (se define en la ficha del artículo). Los pedidos sugeridos usan la cantidad de reorden y el proveedor preferido de cada artículo; asígnalo en <Link href="/compras/proveedores">Proveedores</Link>.
        </p>
      </section>

      <section className="panel">
          <h2>Pedidos</h2>
          <FiltrosAuto
            valores={{ estado: vista }}
            campos={[{ nombre: "estado", etiqueta: "Mostrar", tipo: "select", opciones: [["abiertos", "Abiertos"], ["todos", "Todos"], ...(Object.entries(ESTADOS_OC) as [string, string][])] }]}
          />
          {ps.length === 0 ? (
            <div className="empty">No hay pedidos con ese filtro.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Folio</th><th>Proveedor</th><th>Estado</th><th>Artículos</th><th>Total</th><th>Llega</th><th>Creado</th></tr></thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.id}>
                      <td className="mono"><Link href={`/compras/${p.id}`}>OC {p.folio}</Link></td>
                      <td>{p.proveedor}</td>
                      <td><span className={`chip ${p.estado}`}>{ESTADOS_OC[p.estado]}</span></td>
                      <td className="num">{p.lineas}{p.estado === "parcial" && <span className="muted"> · faltan {Number(p.piezas_pendientes)}</span>}</td>
                      <td className="num">{dinero(p.total, p.moneda)}</td>
                      <td className="num">{p.fecha_esperada ?? "—"}</td>
                      <td className="num">{fechaHora(p.created_at, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="panel">
        <h2>Nuevo pedido</h2>
        {(proveedores ?? []).length === 0 ? (
          <div className="empty">Primero <Link href="/compras/proveedores">registra un proveedor</Link>.</div>
        ) : (
          <FormSimple accion={crearPedido} textoBoton="Crear pedido" limpiar={false}>
            <input type="hidden" name="sucursal_id" value={sucursal.id} />
            <div className="field" style={{ maxWidth: 360 }}>
              <label htmlFor="np-prov">Proveedor</label>
              <select id="np-prov" name="proveedor_id" required defaultValue="">
                <option value="" disabled>Elige…</option>
                {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          </FormSimple>
        )}
      </section>
    </>
  );
}
