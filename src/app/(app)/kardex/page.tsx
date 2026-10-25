import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { obtenerSucursales, requierePerfil, sucursalActiva } from "@/lib/sesion";
import { TIPOS_MOVIMIENTO, puedeGestionarInventario } from "@/lib/tipos";
import { consultaKardex, type FilaKardex, type FiltrosKardex, type ModoSaldo } from "@/lib/kardex";
import FiltrosAuto from "@/components/FiltrosAuto";
import TablaKardex from "@/components/TablaKardex";

export const metadata: Metadata = { title: "Kardex" };

const LIMITE = 1000;

export default async function KardexPage({ searchParams }: { searchParams: Promise<FiltrosKardex> }) {
  const perfil = await requierePerfil();
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const tz = sucursal.zona_horaria;
  const supabase = await createClient();
  const sucursales = perfil.sucursal_id ? [] : await obtenerSucursales();
  const todas = !perfil.sucursal_id && sp.sucursal === "todas";

  const filtros: FiltrosKardex = { ...sp, sucursal: todas ? undefined : sucursal.id };
  const { consulta, desde, hasta } = consultaKardex(supabase, filtros, tz, LIMITE + 1);
  const [{ data, error }, { data: ubicaciones }, articulo] = await Promise.all([
    consulta,
    supabase.from("ubicaciones").select("id, codigo").eq("sucursal_id", sucursal.id).eq("activa", true).order("codigo"),
    sp.articulo
      ? supabase.from("articulos").select("id, sku, nombre").eq("id", sp.articulo).maybeSingle().then((r) => r.data as { id: string; sku: string; nombre: string } | null)
      : Promise.resolve(null),
  ]);
  const filas = ((data as FilaKardex[]) ?? []).slice(0, LIMITE);
  const recortado = (data?.length ?? 0) > LIMITE;
  const modo: ModoSaldo = sp.ubicacion ? "ubicacion" : todas ? "total" : "sucursal";
  const articulosDistintos = new Set(filas.map((f) => f.articulo_id)).size;
  const unArticulo = Boolean(sp.articulo) || articulosDistintos === 1;

  const exportar = new URLSearchParams();
  Object.entries({ ...sp, desde, hasta }).forEach(([k, v]) => v && exportar.set(k, v));

  return (
    <>
      <div className="head">
        <div>
          <h1>Kardex {articulo && <>· {articulo.nombre}</>}</h1>
          <p className="sub">
            {todas ? "Todas las sucursales" : sucursal.nombre} · método de costo promedio ponderado · {filas.length}
            {recortado ? "+" : ""} movimientos
          </p>
        </div>
        <div className="row">
          {articulo && <Link className="btn" href={`/inventario/${articulo.id}`}>Ficha del artículo</Link>}
          <a className="btn" href={`/kardex/exportar?${exportar.toString()}`}>Exportar a Excel</a>
          {puedeGestionarInventario(perfil.rol) && <Link className="btn primary" href="/inventario/movimiento">Registrar movimiento</Link>}
        </div>
      </div>

      <FiltrosAuto
        valores={{ ...sp, desde, hasta }}
        campos={[
          { nombre: "q", etiqueta: "Artículo, SKU, código o documento", tipo: "texto", placeholder: "Ej. aceite, ACE-5W30, FAC-881", grow: true },
          { nombre: "desde", etiqueta: "Desde", tipo: "fecha" },
          { nombre: "hasta", etiqueta: "Hasta", tipo: "fecha" },
          {
            nombre: "tipo",
            etiqueta: "Movimiento",
            tipo: "select",
            opciones: [["", "Todos"], ["entradas", "Solo entradas"], ["salidas", "Solo salidas"], ...Object.entries(TIPOS_MOVIMIENTO)],
          },
          {
            nombre: "ubicacion",
            etiqueta: "Ubicación",
            tipo: "select",
            opciones: [["", "Todas"], ...((ubicaciones as { id: string; codigo: string }[]) ?? []).map((u) => [u.id, u.codigo] as [string, string])],
          },
          ...(sucursales.length > 1
            ? [{
                nombre: "sucursal",
                etiqueta: "Sucursal",
                tipo: "select" as const,
                opciones: [...sucursales.map((s) => [s.id, s.nombre] as [string, string]), ["todas", "Todas"] as [string, string]],
              }]
            : []),
        ]}
      />

      {sp.articulo && (
        <p className="muted" style={{ fontSize: 13 }}>
          Filtrado por un artículo. <Link href={`/kardex?${new URLSearchParams(Object.entries({ ...sp, articulo: "" }).filter(([, v]) => v) as [string, string][]).toString()}`}>Ver todos los artículos</Link>
        </p>
      )}
      {error && <div className="alert error">No se pudo cargar el kardex: {error.message}</div>}
      {recortado && (
        <div className="alert error">Se muestran los primeros {LIMITE} movimientos. Acorta el periodo o exporta a Excel para verlos todos.</div>
      )}

      <TablaKardex filas={filas} modo={modo} tz={tz} unArticulo={unArticulo} mostrarArticulo={!sp.articulo} />

      {!unArticulo && filas.length > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          El saldo de cada renglón es el del artículo de ese renglón. Para ver saldo inicial y final, filtra un solo artículo.
        </p>
      )}
    </>
  );
}
