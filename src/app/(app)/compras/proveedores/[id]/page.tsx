import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil } from "@/lib/sesion";
import { ESTADOS_OC, type EstadoOC } from "@/lib/tipos";
import { dinero } from "@/lib/fechas";
import FormSimple from "@/components/FormSimple";
import CamposProveedor from "@/components/CamposProveedor";
import { desvincularArticulo, guardarProveedor, marcarPreferido, vincularArticulo } from "../../actions";

export const metadata: Metadata = { title: "Proveedor" };

type AP = { articulo_id: string; costo: number; codigo_proveedor: string | null; preferido: boolean; articulos: { sku: string; nombre: string; unidad: string; ultimo_costo: number | null } | null };

export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  await requierePerfil(["admin", "gerente"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: prov }, { data: apData }, { data: pedidos }, { data: articulos }] = await Promise.all([
    supabase.from("proveedores").select("*").eq("id", id).maybeSingle(),
    supabase.from("articulo_proveedores").select("articulo_id, costo, codigo_proveedor, preferido, articulos(sku, nombre, unidad, ultimo_costo)").eq("proveedor_id", id),
    supabase.from("v_ordenes_compra").select("id, folio, estado, total, created_at").eq("proveedor_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("articulos").select("sku, nombre").eq("activo", true).order("nombre").limit(2000),
  ]);
  if (!prov) notFound();
  const aps = ((apData as unknown as AP[]) ?? []).sort((a, b) => (a.articulos?.nombre ?? "").localeCompare(b.articulos?.nombre ?? ""));

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/compras">Compras</Link> / <Link href="/compras/proveedores">Proveedores</Link> /</p>
          <h1>{prov.nombre}</h1>
          <p className="sub">{[prov.contacto, prov.telefono, prov.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
        </div>
      </div>

      <section className="panel">
        <h2>Artículos que vende <span className="muted mono" style={{ fontSize: 13 }}>{aps.length}</span></h2>
        {aps.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Artículo</th><th>Su código</th><th>Costo</th><th>Preferido</th><th></th></tr></thead>
              <tbody>
                {aps.map((a) => (
                  <tr key={a.articulo_id}>
                    <td><Link href={`/inventario/${a.articulo_id}`}>{a.articulos?.nombre}</Link> <span className="muted mono">{a.articulos?.sku}</span></td>
                    <td className="mono">{a.codigo_proveedor ?? "—"}</td>
                    <td className="num">{dinero(a.costo)}</td>
                    <td>
                      <form action={marcarPreferido.bind(null, a.articulo_id, id, !a.preferido)}>
                        <button className={`btn small ${a.preferido ? "primary" : ""}`} type="submit" title={a.preferido ? "Quitar como preferido" : "Pedir este artículo a este proveedor"}>
                          {a.preferido ? "Preferido" : "Hacer preferido"}
                        </button>
                      </form>
                    </td>
                    <td>
                      <form action={desvincularArticulo.bind(null, a.articulo_id, id)}><button className="btn small danger" type="submit">Quitar</button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <FormSimple accion={vincularArticulo} textoBoton="Agregar artículo">
          <input type="hidden" name="proveedor_id" value={id} />
          <div className="fields">
            <div className="field">
              <label htmlFor="va-cod">SKU o código de barras</label>
              <input id="va-cod" name="codigo" list="l-arts" required autoComplete="off" placeholder="ACE-5W30" />
              <datalist id="l-arts">{(articulos ?? []).map((a) => <option key={a.sku} value={a.sku}>{a.nombre}</option>)}</datalist>
            </div>
            <div className="field"><label htmlFor="va-costo">Costo</label><input id="va-costo" name="costo" inputMode="decimal" required placeholder="0.00" /></div>
            <div className="field"><label htmlFor="va-cp">Código del proveedor</label><input id="va-cp" name="codigo_proveedor" /></div>
            <label className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="preferido" defaultChecked /> Pedirle este artículo (preferido)</label>
          </div>
        </FormSimple>
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Datos</h2>
          <FormSimple accion={guardarProveedor} textoBoton="Guardar cambios" limpiar={false}>
            <input type="hidden" name="id" value={id} />
            <CamposProveedor p={prov} />
            <label className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="activo" defaultChecked={prov.activo} /> Activo</label>
          </FormSimple>
        </section>
        <section className="panel">
          <h2>Pedidos recientes</h2>
          {(pedidos ?? []).length === 0 ? (
            <div className="empty">Aún no hay pedidos a este proveedor.</div>
          ) : (
            <ul className="list">
              {(pedidos as { id: string; folio: number; estado: EstadoOC; total: number; created_at: string }[]).map((p) => (
                <li key={p.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Link className="mono" href={`/compras/${p.id}`}>OC {p.folio}</Link>
                    <span className={`chip ${p.estado}`}>{ESTADOS_OC[p.estado]}</span>
                    <span className="num">{dinero(p.total)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
