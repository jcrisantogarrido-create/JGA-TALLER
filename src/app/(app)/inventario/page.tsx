import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_STOCK, TIPOS_ARTICULO, puedeGestionarInventario } from "@/lib/tipos";
import { dinero } from "@/lib/fechas";
import FiltrosAuto from "@/components/FiltrosAuto";

export const metadata: Metadata = { title: "Inventario" };

type Fila = {
  articulo_id: string; sku: string; codigo_barras: string | null; nombre: string; tipo: keyof typeof TIPOS_ARTICULO;
  unidad: string; categoria: string | null; marca: string | null; stock: number; punto_reorden: number | null;
  costo_promedio: number; precio_venta: number; valor: number; estado: keyof typeof ESTADOS_STOCK;
};

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; tipo?: string; categoria?: string; sucursal?: string }>;
}) {
  const perfil = await requierePerfil();
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const q = (sp.q ?? "").trim().replace(/[,()%*\\]/g, " ").slice(0, 60);

  // Un código escaneado que coincide exacto lleva directo a la ficha del artículo
  if (q && !q.includes(" ")) {
    const { data } = await supabase.rpc("articulo_por_codigo", { p_codigo: q });
    const exacto = (data as { id: string }[] | null)?.[0];
    if (exacto) redirect(`/inventario/${exacto.id}`);
  }

  let consulta = supabase
    .from("v_existencias")
    .select("articulo_id, sku, codigo_barras, nombre, tipo, unidad, categoria, marca, stock, punto_reorden, costo_promedio, precio_venta, valor, estado")
    .eq("sucursal_id", sucursal.id)
    .eq("activo", true)
    .order("nombre")
    .limit(500);
  if (q) consulta = consulta.or(`nombre.ilike.%${q}%,sku.ilike.%${q}%,codigo_barras.ilike.%${q}%,marca.ilike.%${q}%`);
  if (sp.estado === "alerta") consulta = consulta.in("estado", ["agotado", "bajo"]);
  else if (sp.estado) consulta = consulta.eq("estado", sp.estado);
  if (sp.tipo) consulta = consulta.eq("tipo", sp.tipo);
  if (sp.categoria) consulta = consulta.eq("categoria", sp.categoria);

  const [{ data }, { data: resumen }, { data: categorias }, { count: alertas }] = await Promise.all([
    consulta,
    supabase.from("v_existencias").select("valor, estado").eq("sucursal_id", sucursal.id).eq("activo", true),
    supabase.from("categorias_articulo").select("nombre").order("nombre"),
    supabase.from("alertas_reabastecimiento").select("id", { count: "exact", head: true }).eq("sucursal_id", sucursal.id).eq("estado", "abierta"),
  ]);
  const filas = (data as Fila[]) ?? [];
  const todos = (resumen as { valor: number; estado: string }[]) ?? [];
  const valorTotal = todos.reduce((s, r) => s + Number(r.valor), 0);
  const bajos = todos.filter((r) => r.estado === "bajo" || r.estado === "agotado").length;
  const gestiona = puedeGestionarInventario(perfil.rol);

  return (
    <>
      <div className="head">
        <div>
          <h1>Inventario</h1>
          <p className="sub">{sucursal.nombre} · existencias en tiempo real</p>
        </div>
        <div className="row">
          <Link className="btn" href="/kardex">Ver kardex</Link>
          {gestiona && <Link className="btn" href="/inventario/ubicaciones">Ubicaciones</Link>}
          {gestiona && <Link className="btn" href="/inventario/movimiento">Registrar movimiento</Link>}
          {gestiona && <Link className="btn primary" href="/inventario/nuevo">Nuevo artículo</Link>}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{todos.length}</b><span>Artículos</span></div>
        <div className="stat"><b>{dinero(valorTotal)}</b><span>Valor del inventario (a costo)</span></div>
        <Link className="stat" href="/inventario?estado=alerta" style={{ textDecoration: "none", color: "inherit" }}>
          <b style={{ color: bajos ? "var(--warn)" : undefined }}>{bajos}</b><span>Agotados o bajo mínimo</span>
        </Link>
        <div className="stat"><b>{alertas ?? 0}</b><span>Alertas de compra abiertas</span></div>
      </div>

      <FiltrosAuto
        valores={sp}
        campos={[
          { nombre: "q", etiqueta: "Buscar o escanear", tipo: "texto", placeholder: "Nombre, SKU, marca o código de barras", grow: true, autofocus: true },
          { nombre: "estado", etiqueta: "Estado", tipo: "select", opciones: [["", "Todos"], ["alerta", "Agotados o bajos"], ...Object.entries(ESTADOS_STOCK)] },
          { nombre: "tipo", etiqueta: "Tipo", tipo: "select", opciones: [["", "Todos"], ...Object.entries(TIPOS_ARTICULO)] },
          { nombre: "categoria", etiqueta: "Categoría", tipo: "select", opciones: [["", "Todas"], ...((categorias as { nombre: string }[]) ?? []).map((c) => [c.nombre, c.nombre] as [string, string])] },
        ]}
      />

      {filas.length === 0 ? (
        <div className="empty">
          {q || sp.estado || sp.tipo || sp.categoria
            ? <>Ningún artículo coincide con los filtros.{gestiona && q && !q.includes(" ") && <> <Link href={`/inventario/nuevo?codigo=${encodeURIComponent(q)}`}>Dar de alta “{q}” como artículo nuevo</Link></>}</>
            : gestiona
              ? "Aún no hay artículos. Da de alta el primero con “Nuevo artículo”."
              : "Aún no hay artículos registrados."}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artículo</th><th>Categoría · marca</th><th className="num" style={{ textAlign: "right" }}>Existencia</th>
                <th style={{ textAlign: "right" }}>Mínimo</th><th>Estado</th>
                <th style={{ textAlign: "right" }}>Costo prom.</th><th style={{ textAlign: "right" }}>Precio</th><th style={{ textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.articulo_id}>
                  <td>
                    <Link href={`/inventario/${a.articulo_id}`}>{a.nombre}</Link>
                    <div className="muted mono">{a.sku}{a.codigo_barras && ` · ${a.codigo_barras}`}</div>
                  </td>
                  <td>{a.categoria ?? "—"}<div className="muted">{a.marca ?? ""}</div></td>
                  <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{Number(a.stock).toLocaleString("es-PE")} <span className="muted" style={{ fontWeight: 400 }}>{a.unidad}</span></td>
                  <td className="num" style={{ textAlign: "right" }}>{a.punto_reorden ?? "—"}</td>
                  <td><span className={`chip ${a.estado}`}>{ESTADOS_STOCK[a.estado]}</span></td>
                  <td className="num" style={{ textAlign: "right" }}>{dinero(a.costo_promedio)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{dinero(a.precio_venta)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{dinero(a.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
