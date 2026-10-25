import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_ORDEN, ESTADOS_ORDEN_ACTIVOS, type EstadoOrden } from "@/lib/tipos";
import { dinero, fechaHora } from "@/lib/fechas";
import FiltrosAuto from "@/components/FiltrosAuto";

export const metadata: Metadata = { title: "Órdenes de trabajo" };

type Fila = {
  id: string; folio: number; estado: EstadoOrden; recibido_en: string; entregado_en: string | null;
  clientes: { nombre: string; apellidos: string | null } | null;
  vehiculos: { placa: string; marca: string; modelo: string } | null;
  bahias: { nombre: string } | null;
  orden_servicios: { descripcion: string; tecnico: { nombre: string } | null }[];
};

export default async function OrdenesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; sucursal?: string }>;
}) {
  const perfil = await requierePerfil();
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const vista = sp.estado ?? "activas";
  const q = (sp.q ?? "").trim().replace(/[,()%*\\]/g, " ").slice(0, 40);

  let consulta = supabase
    .from("ordenes_trabajo")
    .select(
      "id, folio, estado, recibido_en, entregado_en, clientes(nombre, apellidos), vehiculos!inner(placa, placa_norm, marca, modelo), bahias(nombre), orden_servicios(descripcion, tecnico:perfiles(nombre))",
    )
    .eq("sucursal_id", sucursal.id)
    .order("recibido_en", { ascending: false })
    .limit(200);
  if (vista === "activas") consulta = consulta.in("estado", ESTADOS_ORDEN_ACTIVOS);
  else if (vista !== "todas") consulta = consulta.eq("estado", vista);
  if (q) {
    const folio = Number(q.replace(/^OT\s*/i, ""));
    if (Number.isInteger(folio) && folio > 0) consulta = consulta.eq("folio", folio);
    else consulta = consulta.ilike("vehiculos.placa_norm", `%${q.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`);
  }

  const { data } = await consulta;
  const filas = (data as unknown as Fila[]) ?? [];
  const { data: totales } = filas.length
    ? await supabase.from("v_orden_totales").select("orden_id, ingreso_total, pagado").in("orden_id", filas.map((f) => f.id))
    : { data: [] };
  const tot = new Map(((totales as { orden_id: string; ingreso_total: number; pagado: number }[]) ?? []).map((t) => [t.orden_id, t]));

  const { data: activas } = await supabase.from("ordenes_trabajo").select("estado").eq("sucursal_id", sucursal.id).in("estado", ESTADOS_ORDEN_ACTIVOS);
  const cuenta = (e: EstadoOrden[]) => ((activas as { estado: EstadoOrden }[]) ?? []).filter((a) => e.includes(a.estado)).length;
  const tz = sucursal.zona_horaria;

  return (
    <>
      <div className="head">
        <div>
          <h1>Órdenes de trabajo</h1>
          <p className="sub">{sucursal.nombre}{perfil.rol === "tecnico" && " · solo las que tienen trabajos asignados a ti"}</p>
        </div>
        {perfil.rol !== "tecnico" && <Link className="btn primary" href="/ordenes/nueva">Recibir vehículo</Link>}
      </div>

      <div className="stats">
        <div className="stat"><b>{cuenta(ESTADOS_ORDEN_ACTIVOS)}</b><span>En el taller</span></div>
        <div className="stat"><b>{cuenta(["en_proceso", "control_calidad"])}</b><span>En proceso</span></div>
        <div className="stat"><b style={{ color: cuenta(["esperando_aprobacion", "esperando_piezas"]) ? "var(--warn)" : undefined }}>{cuenta(["esperando_aprobacion", "esperando_piezas"])}</b><span>Esperando aprobación o piezas</span></div>
        <div className="stat"><b>{cuenta(["terminada"])}</b><span>Listas para entregar</span></div>
      </div>

      <FiltrosAuto
        valores={{ q: sp.q, estado: vista }}
        campos={[
          { nombre: "q", etiqueta: "Placa o folio", tipo: "texto", placeholder: "ABC123 o 1024", grow: true },
          {
            nombre: "estado", etiqueta: "Estado", tipo: "select",
            opciones: [["activas", "En el taller"], ["todas", "Todas"], ...(Object.entries(ESTADOS_ORDEN) as [string, string][])],
          },
        ]}
      />

      {filas.length === 0 ? (
        <div className="empty">No hay órdenes con esos filtros.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Folio</th><th>Vehículo</th><th>Cliente</th><th>Trabajos</th><th>Estado</th><th>Recibido</th><th>Total</th><th>Saldo</th></tr>
            </thead>
            <tbody>
              {filas.map((o) => {
                const t = tot.get(o.id);
                const saldo = t ? Number(t.ingreso_total) - Number(t.pagado) : 0;
                const tecnicos = [...new Set(o.orden_servicios.map((s) => s.tecnico?.nombre).filter(Boolean))];
                return (
                  <tr key={o.id}>
                    <td className="mono"><Link href={`/ordenes/${o.id}`}>OT {o.folio}</Link></td>
                    <td>{o.vehiculos && <span className="placa">{o.vehiculos.placa}</span>} <span className="muted">{o.vehiculos?.marca} {o.vehiculos?.modelo}</span></td>
                    <td>{o.clientes?.nombre} {o.clientes?.apellidos ?? ""}</td>
                    <td>
                      {o.orden_servicios.map((s) => s.descripcion).join(", ") || <span className="muted">Por diagnosticar</span>}
                      {tecnicos.length > 0 && <div className="muted" style={{ fontSize: 12.5 }}>{tecnicos.join(", ")}{o.bahias && ` · ${o.bahias.nombre}`}</div>}
                    </td>
                    <td><span className={`chip ${o.estado}`}>{ESTADOS_ORDEN[o.estado]}</span></td>
                    <td className="num">{fechaHora(o.recibido_en, tz)}</td>
                    <td className="num">{dinero(t?.ingreso_total)}</td>
                    <td className="num" style={{ color: saldo > 0.005 && o.estado !== "cancelada" ? "var(--warn)" : undefined }}>{dinero(saldo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
