import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_STOCK, TIPOS_ARTICULO, TIPOS_MOVIMIENTO, puedeGestionarInventario } from "@/lib/tipos";
import { dinero } from "@/lib/fechas";
import { consultaKardex, type FilaKardex, type FiltrosKardex } from "@/lib/kardex";
import FormArticulo from "@/components/FormArticulo";
import RegistroMovimiento from "@/components/RegistroMovimiento";
import TablaKardex from "@/components/TablaKardex";
import FiltrosAuto from "@/components/FiltrosAuto";
import { actualizarArticulo, resolverAlerta } from "../actions";

export const metadata: Metadata = { title: "Artículo" };

export default async function ArticuloPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<FiltrosKardex>;
}) {
  const perfil = await requierePerfil();
  const { id } = await params;
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const tz = sucursal.zona_horaria;
  const supabase = await createClient();

  const { consulta, desde, hasta } = consultaKardex(supabase, { ...sp, articulo: id, sucursal: sucursal.id, q: undefined }, tz, 2000);
  const [{ data: art }, { data: estado }, { data: existencias }, { data: ubicaciones }, kardex, { data: alertas }, { data: proveedores }, { data: categorias }, { data: marcas }] =
    await Promise.all([
      supabase.from("articulos").select("*, categorias_articulo(nombre), marcas(nombre)").eq("id", id).maybeSingle(),
      supabase.from("v_existencias").select("stock, punto_reorden, cantidad_reorden, stock_maximo, valor, estado").eq("articulo_id", id).eq("sucursal_id", sucursal.id).maybeSingle(),
      supabase.from("existencias").select("ubicacion_id, cantidad, updated_at, ubicaciones!inner(codigo, descripcion, sucursal_id)").eq("articulo_id", id).eq("ubicaciones.sucursal_id", sucursal.id),
      supabase.from("ubicaciones").select("id, codigo").eq("sucursal_id", sucursal.id).eq("activa", true).order("codigo"),
      consulta,
      supabase.from("alertas_reabastecimiento").select("id, stock_detectado, punto_reorden, estado, created_at").eq("articulo_id", id).eq("sucursal_id", sucursal.id).in("estado", ["abierta", "en_compra"]),
      supabase.from("proveedores").select("nombre").eq("activo", true).order("nombre"),
      supabase.from("categorias_articulo").select("nombre").order("nombre"),
      supabase.from("marcas").select("nombre").order("nombre"),
    ]);
  if (!art) notFound();

  const gestiona = puedeGestionarInventario(perfil.rol);
  const ubic = (ubicaciones as { id: string; codigo: string }[]) ?? [];
  const ex = ((existencias as unknown as { ubicacion_id: string; cantidad: number; updated_at: string; ubicaciones: { codigo: string; descripcion: string | null } }[]) ?? [])
    .sort((a, b) => a.ubicaciones.codigo.localeCompare(b.ubicaciones.codigo));
  const filas = (kardex.data as FilaKardex[]) ?? [];
  const st = estado as { stock: number; punto_reorden: number | null; cantidad_reorden: number | null; stock_maximo: number | null; valor: number; estado: keyof typeof ESTADOS_STOCK } | null;
  const modo = sp.ubicacion ? "ubicacion" : "sucursal";

  const exportar = new URLSearchParams({ articulo: id, desde, hasta });
  if (sp.ubicacion) exportar.set("ubicacion", sp.ubicacion);
  if (sp.tipo) exportar.set("tipo", sp.tipo);

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/inventario">Inventario</Link> /</p>
          <h1>{art.nombre}</h1>
          <p className="sub mono">
            {art.sku}{art.codigo_barras && ` · ${art.codigo_barras}`} · {TIPOS_ARTICULO[art.tipo as keyof typeof TIPOS_ARTICULO]}
            {art.categorias_articulo?.nombre && ` · ${art.categorias_articulo.nombre}`}{art.marcas?.nombre && ` · ${art.marcas.nombre}`}
            {!art.activo && " · INACTIVO"}
          </p>
        </div>
        {st && <span className={`chip ${st.estado}`} style={{ fontSize: 14 }}>{ESTADOS_STOCK[st.estado]}</span>}
      </div>

      {((alertas as { id: string; stock_detectado: number; punto_reorden: number }[]) ?? []).map((a) => (
        <div key={a.id} className="alert error row" style={{ justifyContent: "space-between" }}>
          <span>
            Alerta de reabastecimiento: quedan {Number(a.stock_detectado)} {art.unidad} y el mínimo es {Number(a.punto_reorden)}.
            {st?.cantidad_reorden ? ` Sugerido pedir ${Number(st.cantidad_reorden)}.` : ""}
          </span>
          {gestiona && (
            <form action={resolverAlerta.bind(null, a.id, id)}>
              <button className="btn small" type="submit">Descartar alerta</button>
            </form>
          )}
        </div>
      ))}

      <div className="stats">
        <div className="stat"><b>{Number(st?.stock ?? 0).toLocaleString("es-MX")}</b><span>Existencia en {sucursal.nombre} ({art.unidad})</span></div>
        <div className="stat"><b>{dinero(art.costo_promedio)}</b><span>Costo promedio · último {dinero(art.ultimo_costo)}</span></div>
        <div className="stat"><b>{dinero(st?.valor)}</b><span>Valor a costo</span></div>
        <div className="stat"><b>{dinero(art.precio_venta)}</b><span>Precio de venta{Number(art.costo_promedio) > 0 && ` · margen ${Math.round((1 - Number(art.costo_promedio) / Number(art.precio_venta || 1)) * 100)}%`}</span></div>
        <div className="stat"><b>{st?.punto_reorden ?? "—"}</b><span>Mínimo{st?.stock_maximo ? ` · máximo ${Number(st.stock_maximo)}` : ""}</span></div>
      </div>

      <div className="grid2">
        <section className="panel">
          <h2>Existencia por ubicación</h2>
          {ex.length === 0 ? (
            <div className="empty">Sin existencia en esta sucursal.</div>
          ) : (
            <ul className="list">
              {ex.map((e) => (
                <li key={e.ubicacion_id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    <b className="mono">{e.ubicaciones.codigo}</b>
                    {e.ubicaciones.descripcion && <span className="muted"> · {e.ubicaciones.descripcion}</span>}
                  </span>
                  <Link className="num" href={`/inventario/${id}?ubicacion=${e.ubicacion_id}`} style={{ fontWeight: 600 }}>
                    {Number(e.cantidad).toLocaleString("es-MX")} {art.unidad}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {gestiona && ubic.length > 0 && (
          <section className="panel">
            <h2>Registrar movimiento</h2>
            <RegistroMovimiento
              sucursalId={sucursal.id}
              ubicaciones={ubic}
              proveedores={((proveedores as { nombre: string }[]) ?? []).map((p) => p.nombre)}
              articuloFijo={{
                id,
                sku: art.sku,
                nombre: art.nombre,
                unidad: art.unidad,
                costo_promedio: Number(art.costo_promedio),
                existencias: ex.map((e) => ({ ubicacion_id: e.ubicacion_id, codigo: e.ubicaciones.codigo, cantidad: Number(e.cantidad) })),
              }}
            />
          </section>
        )}
      </div>

      <section className="panel">
        <h2>
          Kardex
          <span className="row">
            <a className="btn small" href={`/kardex/exportar?${exportar.toString()}`}>Exportar a Excel</a>
          </span>
        </h2>
        <FiltrosAuto
          valores={{ ...sp, desde, hasta }}
          campos={[
            { nombre: "desde", etiqueta: "Desde", tipo: "fecha" },
            { nombre: "hasta", etiqueta: "Hasta", tipo: "fecha" },
            { nombre: "tipo", etiqueta: "Movimiento", tipo: "select", opciones: [["", "Todos"], ["entradas", "Solo entradas"], ["salidas", "Solo salidas"], ...Object.entries(TIPOS_MOVIMIENTO)] },
            { nombre: "ubicacion", etiqueta: "Ubicación", tipo: "select", opciones: [["", "Toda la sucursal"], ...ubic.map((u) => [u.id, u.codigo] as [string, string])] },
          ]}
        />
        <TablaKardex filas={filas} modo={modo} tz={tz} unArticulo />
      </section>

      {gestiona && (
        <section className="panel">
          <h2>Datos del artículo</h2>
          <FormArticulo
            accion={actualizarArticulo}
            sucursal={sucursal}
            categorias={((categorias as { nombre: string }[]) ?? []).map((c) => c.nombre)}
            marcas={((marcas as { nombre: string }[]) ?? []).map((c) => c.nombre)}
            inicial={{
              id,
              sku: art.sku,
              codigo_barras: art.codigo_barras,
              nombre: art.nombre,
              descripcion: art.descripcion,
              tipo: art.tipo,
              unidad: art.unidad,
              precio_venta: art.precio_venta,
              categoria: art.categorias_articulo?.nombre ?? null,
              marca: art.marcas?.nombre ?? null,
              activo: art.activo,
              punto_reorden: st?.punto_reorden ?? null,
              cantidad_reorden: st?.cantidad_reorden ?? null,
              stock_maximo: st?.stock_maximo ?? null,
            }}
          />
        </section>
      )}
    </>
  );
}
