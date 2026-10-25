import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_CITA, ESTADOS_ORDEN_ACTIVOS, type EstadoCita } from "@/lib/tipos";
import { fechaLarga, fechaLocal, hora, localAInstante, sumarDias } from "@/lib/fechas";

export default async function InicioPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const perfil = await requierePerfil();
  const { error } = await searchParams;
  const sucursal = await sucursalActiva(perfil);
  const supabase = await createClient();
  const tz = sucursal?.zona_horaria ?? "America/Lima";
  const hoy = fechaLocal(new Date(), tz);
  const desde = localAInstante(hoy, "00:00", tz).toISOString();
  const hasta = localAInstante(sumarDias(hoy, 1), "00:00", tz).toISOString();

  const esGestion = perfil.rol === "admin" || perfil.rol === "gerente";
  const [{ data: citas }, { count: clientes }, { count: alertas }, { count: recordatorios }, { count: ordenes }] = await Promise.all([
    sucursal
      ? supabase.from("citas")
          .select("id, inicio, fin, estado, vehiculos(placa, marca, modelo), servicios(nombre), clientes(nombre, apellidos), bahias(nombre), tecnico:perfiles!citas_tecnico_id_fkey(nombre)")
          .eq("sucursal_id", sucursal.id).gte("inicio", desde).lt("inicio", hasta)
          .not("estado", "in", "(cancelada,no_asistio)").order("inicio")
      : Promise.resolve({ data: [] }),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("activo", true),
    esGestion
      ? supabase.from("alertas_reabastecimiento").select("id", { count: "exact", head: true }).eq("estado", "abierta")
      : Promise.resolve({ count: null }),
    perfil.rol !== "tecnico"
      ? supabase.from("v_recordatorios_por_enviar").select("id", { count: "exact", head: true })
      : Promise.resolve({ count: null }),
    supabase.from("ordenes_trabajo").select("id", { count: "exact", head: true }).in("estado", ESTADOS_ORDEN_ACTIVOS),
  ]);

  const lista = (citas as unknown as {
    id: string; inicio: string; fin: string; estado: EstadoCita;
    vehiculos: { placa: string; marca: string; modelo: string } | null; servicios: { nombre: string } | null;
    clientes: { nombre: string; apellidos: string | null } | null; bahias: { nombre: string } | null; tecnico: { nombre: string } | null;
  }[]) ?? [];
  const pendientes = lista.filter((c) => c.estado === "programada" || c.estado === "confirmada").length;
  const enCurso = lista.filter((c) => c.estado === "en_curso").length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Hola, {perfil.nombre.split(" ")[0]}</h1>
          <p className="sub">{fechaLarga(hoy)}{sucursal && ` · ${sucursal.nombre}`}</p>
        </div>
      </div>

      {error === "sin-permiso" && <div className="alert error">Tu rol no tiene acceso a esa sección.</div>}

      <div className="stats">
        <div className="stat"><b>{lista.length}</b><span>{perfil.rol === "tecnico" ? "Tus citas de hoy" : "Citas hoy"}</span></div>
        <div className="stat"><b>{pendientes}</b><span>Por llegar</span></div>
        <div className="stat"><b>{enCurso}</b><span>En curso</span></div>
        <Link className="stat" href="/ordenes" style={{ textDecoration: "none", color: "inherit" }}><b>{ordenes ?? 0}</b><span>{perfil.rol === "tecnico" ? "Tus órdenes abiertas" : "Vehículos en el taller"}</span></Link>
        {perfil.rol !== "tecnico" && <Link className="stat" href="/comunicacion" style={{ textDecoration: "none", color: "inherit" }}><b style={{ color: recordatorios ? "var(--warn)" : undefined }}>{recordatorios ?? 0}</b><span>Recordatorios por enviar</span></Link>}
        {esGestion && <Link className="stat" href="/compras" style={{ textDecoration: "none", color: "inherit" }}><b style={{ color: alertas ? "var(--warn)" : undefined }}>{alertas ?? 0}</b><span>Artículos por reabastecer</span></Link>}
        {perfil.rol !== "tecnico" && <div className="stat"><b>{clientes ?? 0}</b><span>Clientes activos</span></div>}
      </div>

      <section className="panel">
        <h2>
          Hoy
          <Link className="btn small" href="/agenda">Ver agenda</Link>
        </h2>
        {lista.length === 0 ? (
          <div className="empty">
            No hay citas para hoy.{" "}
            {perfil.rol !== "tecnico" && <Link href="/agenda/nueva">Agendar una</Link>}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Hora</th><th>Vehículo</th><th>Servicio</th><th>Cliente</th><th>Bahía · técnico</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td className="num"><Link href={`/agenda/${c.id}`}>{hora(c.inicio, tz)}–{hora(c.fin, tz)}</Link></td>
                    <td>{c.vehiculos && <span className="placa">{c.vehiculos.placa}</span>} <span className="muted">{c.vehiculos?.marca} {c.vehiculos?.modelo}</span></td>
                    <td>{c.servicios?.nombre ?? "Por diagnosticar"}</td>
                    <td>{c.clientes?.nombre} {c.clientes?.apellidos ?? ""}</td>
                    <td>{c.bahias?.nombre ?? "—"} · {c.tecnico?.nombre ?? "—"}</td>
                    <td><span className={`chip ${c.estado}`}>{ESTADOS_CITA[c.estado]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
