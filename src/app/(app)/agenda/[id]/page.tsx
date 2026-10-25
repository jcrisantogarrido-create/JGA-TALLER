import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { CANALES, ESTADOS_CITA, TRANSICIONES_CITA, type EstadoCita } from "@/lib/tipos";
import { fechaLarga, fechaLocal, hora, fechaHora } from "@/lib/fechas";
import { cambiarEstadoCita } from "../actions";

export const metadata: Metadata = { title: "Cita" };

const TEXTO_ACCION: Record<EstadoCita, string> = {
  programada: "Reprogramar como pendiente",
  confirmada: "Cliente confirmó",
  en_curso: "Llegó el vehículo / iniciar",
  completada: "Marcar completada",
  cancelada: "Cancelar cita",
  no_asistio: "No asistió",
};

const MENSAJES: Record<string, string> = {
  transicion: "Ese cambio de estado no es válido desde el estado actual.",
  permiso: "Tu rol solo puede iniciar o completar sus propias citas.",
};

export default async function CitaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const perfil = await requierePerfil();
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: cita } = await supabase
    .from("citas")
    .select(
      "id, inicio, fin, estado, motivo_cliente, canal_origen, created_at, sucursal_id, clientes(id, nombre, apellidos, telefono, email), vehiculos(placa, marca, modelo, anio, kilometraje_actual), servicios(nombre, precio_base), tecnico:perfiles!citas_tecnico_id_fkey(nombre), creador:perfiles!citas_creada_por_fkey(nombre), bahias(nombre), sucursales(nombre, zona_horaria)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!cita) notFound();
  const { data: orden } = await supabase.from("ordenes_trabajo").select("id, folio").eq("cita_id", id).maybeSingle();

  const c = cita as unknown as {
    id: string; inicio: string; fin: string; estado: EstadoCita; motivo_cliente: string | null; canal_origen: string | null; created_at: string;
    clientes: { id: string; nombre: string; apellidos: string | null; telefono: string | null; email: string | null } | null;
    vehiculos: { placa: string; marca: string; modelo: string; anio: number; kilometraje_actual: number | null } | null;
    servicios: { nombre: string; precio_base: number } | null;
    tecnico: { nombre: string } | null; creador: { nombre: string } | null; bahias: { nombre: string } | null;
    sucursales: { nombre: string; zona_horaria: string } | null;
  };
  const tz = c.sucursales?.zona_horaria ?? (await sucursalActiva(perfil))?.zona_horaria ?? "America/Mexico_City";
  const fecha = fechaLocal(new Date(c.inicio), tz);

  let acciones = TRANSICIONES_CITA[c.estado];
  if (perfil.rol === "tecnico") acciones = acciones.filter((e) => e === "en_curso" || e === "completada");

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href={`/agenda?fecha=${fecha}`}>Agenda</Link> /</p>
          <h1>
            {fechaLarga(fecha)}, {hora(c.inicio, tz)}–{hora(c.fin, tz)}
          </h1>
          <p className="sub">{c.sucursales?.nombre} · {c.bahias?.nombre ?? "Sin bahía"} · {c.tecnico?.nombre ?? "Sin técnico"}</p>
        </div>
        <span className={`chip ${c.estado}`} style={{ fontSize: 14 }}>{ESTADOS_CITA[c.estado]}</span>
      </div>

      {error && <div className="alert error" role="alert">{MENSAJES[error] ?? error}</div>}

      <div className="grid2">
        <section className="panel">
          <h2>Vehículo y cliente</h2>
          <dl className="kv">
            <dt>Vehículo</dt>
            <dd>
              {c.vehiculos && <span className="placa">{c.vehiculos.placa}</span>} {c.vehiculos?.marca} {c.vehiculos?.modelo} {c.vehiculos?.anio}
            </dd>
            {c.vehiculos?.kilometraje_actual != null && (<><dt>Último km</dt><dd className="num">{c.vehiculos.kilometraje_actual.toLocaleString("es-MX")}</dd></>)}
            <dt>Cliente</dt>
            <dd>{c.clientes && <Link href={`/clientes/${c.clientes.id}`}>{c.clientes.nombre} {c.clientes.apellidos ?? ""}</Link>}</dd>
            <dt>Teléfono</dt>
            <dd className="num">{c.clientes?.telefono ?? "—"}</dd>
            <dt>Servicio</dt>
            <dd>{c.servicios?.nombre ?? "Por diagnosticar"}</dd>
            <dt>Reporta</dt>
            <dd>{c.motivo_cliente ?? "—"}</dd>
            <dt>Agendó</dt>
            <dd>
              {c.creador?.nombre ?? "—"}{c.canal_origen && ` por ${CANALES[c.canal_origen as keyof typeof CANALES] ?? c.canal_origen}`}, {fechaHora(c.created_at, tz)}
            </dd>
          </dl>
        </section>

        <section className="panel">
          <h2>Estado</h2>
          {acciones.length === 0 ? (
            <p className="muted">No hay más cambios posibles para esta cita.</p>
          ) : (
            <div className="row">
              {acciones.map((nuevo) => (
                <form key={nuevo} action={cambiarEstadoCita.bind(null, c.id, c.estado, nuevo)}>
                  <button
                    className={`btn ${nuevo === "cancelada" || nuevo === "no_asistio" ? "danger" : nuevo === "en_curso" || nuevo === "confirmada" ? "primary" : ""}`}
                    type="submit"
                  >
                    {TEXTO_ACCION[nuevo]}
                  </button>
                </form>
              ))}
            </div>
          )}
          {orden ? (
            <Link className="btn" href={`/ordenes/${orden.id}`}>Ver orden de trabajo OT {orden.folio}</Link>
          ) : (
            perfil.rol !== "tecnico" && ["programada", "confirmada", "en_curso"].includes(c.estado) && (
              <Link className="btn primary" href={`/ordenes/nueva?cita=${c.id}`}>Recibir vehículo y abrir orden</Link>
            )
          )}
          <p className="muted" style={{ fontSize: 13 }}>
            Al cancelar o marcar “No asistió” la bahía y el técnico quedan libres para otra cita.
          </p>
        </section>
      </div>
    </>
  );
}
