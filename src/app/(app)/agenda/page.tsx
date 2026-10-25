import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { obtenerSucursales, requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_CITA, type EstadoCita } from "@/lib/tipos";
import { fechaLarga, fechaLocal, hora, localAInstante, minutosDelDia, sumarDias } from "@/lib/fechas";

export const metadata: Metadata = { title: "Agenda" };

type Cita = {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoCita;
  bahia_id: string | null;
  tecnico_id: string | null;
  clientes: { nombre: string; apellidos: string | null } | null;
  vehiculos: { placa: string; marca: string; modelo: string } | null;
  servicios: { nombre: string } | null;
  tecnico: { nombre: string } | null;
  bahias: { nombre: string } | null;
};

const HORA_PX = 72;

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; sucursal?: string; vista?: string; canceladas?: string; nueva?: string }>;
}) {
  const perfil = await requierePerfil();
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  const sucursales = perfil.sucursal_id ? [] : await obtenerSucursales();

  if (!sucursal) {
    return (
      <div className="empty">
        No hay sucursales activas. Administración debe dar de alta una sucursal con sus bahías.
      </div>
    );
  }

  const tz = sucursal.zona_horaria;
  const hoy = fechaLocal(new Date(), tz);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha ?? "") ? sp.fecha! : hoy;
  const vista = sp.vista === "tecnicos" || perfil.rol === "tecnico" ? "tecnicos" : "bahias";
  const verCanceladas = sp.canceladas === "1";

  const desde = localAInstante(fecha, "00:00", tz).toISOString();
  const hasta = localAInstante(sumarDias(fecha, 1), "00:00", tz).toISOString();

  const supabase = await createClient();
  let consulta = supabase
    .from("citas")
    .select(
      "id, inicio, fin, estado, bahia_id, tecnico_id, clientes(nombre, apellidos), vehiculos(placa, marca, modelo), servicios(nombre), tecnico:perfiles!citas_tecnico_id_fkey(nombre), bahias(nombre)",
    )
    .eq("sucursal_id", sucursal.id)
    .lt("inicio", hasta)
    .gt("fin", desde)
    .order("inicio");
  if (!verCanceladas) consulta = consulta.not("estado", "in", "(cancelada,no_asistio)");

  const [{ data: citasData }, { data: bahiasData }, { data: tecnicosData }, { data: horariosData }] = await Promise.all([
    consulta,
    supabase.from("bahias").select("id, nombre, tipo").eq("sucursal_id", sucursal.id).eq("activa", true).order("nombre"),
    supabase.from("perfiles").select("id, nombre").eq("rol", "tecnico").eq("activo", true).or(`sucursal_id.eq.${sucursal.id},sucursal_id.is.null`).order("nombre"),
    supabase.from("horarios_tecnico").select("tecnico_id, hora_inicio, hora_fin").eq("dia_semana", new Date(`${fecha}T12:00:00Z`).getUTCDay()),
  ]);

  const citas = (citasData as unknown as Cita[]) ?? [];
  const bahias = (bahiasData as { id: string; nombre: string; tipo: string }[]) ?? [];
  let tecnicos = (tecnicosData as { id: string; nombre: string }[]) ?? [];
  if (perfil.rol === "tecnico") tecnicos = tecnicos.filter((t) => t.id === perfil.id);
  const horarios = (horariosData as { tecnico_id: string; hora_inicio: string; hora_fin: string }[]) ?? [];

  // Columnas según la vista
  type Columna = { id: string | null; titulo: string; detalle?: string };
  let columnas: Columna[] =
    vista === "bahias"
      ? bahias.map((b) => ({ id: b.id, titulo: b.nombre, detalle: b.tipo }))
      : tecnicos.map((t) => {
          const turnos = horarios.filter((h) => h.tecnico_id === t.id);
          return { id: t.id, titulo: t.nombre, detalle: turnos.length ? turnos.map((h) => `${h.hora_inicio.slice(0, 5)}–${h.hora_fin.slice(0, 5)}`).join(", ") : "Sin turno" };
        });
  const clave = (c: Cita) => (vista === "bahias" ? c.bahia_id : c.tecnico_id);
  if (citas.some((c) => clave(c) === null)) columnas = [...columnas, { id: null, titulo: vista === "bahias" ? "Sin bahía" : "Sin técnico" }];

  // Rango de horas visible: 7:00–20:00, ampliado si hay citas fuera
  const minsInicio = citas.map((c) => (new Date(c.inicio) < new Date(desde) ? 0 : minutosDelDia(new Date(c.inicio), tz)));
  const minsFin = citas.map((c) => (new Date(c.fin) >= new Date(hasta) ? 1440 : minutosDelDia(new Date(c.fin), tz)));
  const horaIni = Math.min(7, ...minsInicio.map((m) => Math.floor(m / 60)));
  const horaFin = Math.max(20, ...minsFin.map((m) => Math.ceil(m / 60)));
  const alto = (horaFin - horaIni) * HORA_PX;
  const y = (min: number) => ((min - horaIni * 60) / 60) * HORA_PX;
  const ahoraMin = fecha === hoy ? minutosDelDia(new Date(), tz) : null;

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base = { fecha, sucursal: sp.sucursal, vista: sp.vista, canceladas: sp.canceladas, ...extra };
    Object.entries(base).forEach(([k, v]) => v && p.set(k, v));
    return `/agenda?${p.toString()}`;
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>{fechaLarga(fecha)}</h1>
          <p className="sub">
            {sucursal.nombre} · {citas.length} {citas.length === 1 ? "cita" : "citas"}
            {perfil.rol === "tecnico" && " asignadas a ti"}
          </p>
        </div>
        {perfil.rol !== "tecnico" && (
          <Link className="btn primary" href={`/agenda/nueva?fecha=${fecha}${sp.sucursal ? `&sucursal=${sp.sucursal}` : ""}`}>
            Nueva cita
          </Link>
        )}
      </div>

      {sp.nueva && <div className="alert ok" role="status">Cita agendada.</div>}

      <div className="row">
        <Link className="btn small" href={qs({ fecha: sumarDias(fecha, -1) })} aria-label="Día anterior">←</Link>
        <Link className="btn small" href={qs({ fecha: hoy })}>Hoy</Link>
        <Link className="btn small" href={qs({ fecha: sumarDias(fecha, 1) })} aria-label="Día siguiente">→</Link>
        <form className="row" action="/agenda">
          <input type="date" name="fecha" defaultValue={fecha} aria-label="Ir a fecha" style={{ width: "auto" }} />
          {sp.sucursal && <input type="hidden" name="sucursal" value={sp.sucursal} />}
          {sp.vista && <input type="hidden" name="vista" value={sp.vista} />}
          <button className="btn small" type="submit">Ir</button>
        </form>
        {perfil.rol !== "tecnico" && (
          <span className="row" style={{ marginLeft: "auto" }}>
            <Link className="btn small" href={qs({ vista: undefined })} aria-pressed={vista === "bahias"} style={vista === "bahias" ? { borderColor: "var(--accent)" } : undefined}>Por bahía</Link>
            <Link className="btn small" href={qs({ vista: "tecnicos" })} style={vista === "tecnicos" ? { borderColor: "var(--accent)" } : undefined}>Por técnico</Link>
            <Link className="btn small" href={qs({ canceladas: verCanceladas ? undefined : "1" })}>
              {verCanceladas ? "Ocultar canceladas" : "Ver canceladas"}
            </Link>
          </span>
        )}
        {sucursales.length > 1 && (
          <form className="row" action="/agenda">
            <input type="hidden" name="fecha" value={fecha} />
            <select name="sucursal" defaultValue={sucursal.id} aria-label="Sucursal" style={{ width: "auto" }}>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <button className="btn small" type="submit">Cambiar</button>
          </form>
        )}
      </div>

      {columnas.length === 0 ? (
        <div className="empty">
          {vista === "bahias" ? "Esta sucursal no tiene bahías activas." : "No hay técnicos activos en esta sucursal."}
        </div>
      ) : (
        <div className="agenda" style={{ ["--cols" as string]: columnas.length, ["--hora" as string]: `${HORA_PX}px` }}>
          <div className="agenda-inner">
            <div className="colhead corner" />
            {columnas.map((c) => (
              <div key={c.id ?? "ninguna"} className="colhead">
                {c.titulo}
                {c.detalle && <small>{c.detalle}</small>}
              </div>
            ))}

            <div className="hours" style={{ height: alto }}>
              {Array.from({ length: horaFin - horaIni }, (_, i) => (
                <span key={i} style={{ top: i * HORA_PX + (i === 0 ? 8 : 0) }}>{String(horaIni + i).padStart(2, "0")}:00</span>
              ))}
            </div>

            {columnas.map((col) => (
              <div key={col.id ?? "ninguna"} className="col" style={{ height: alto }}>
                {ahoraMin !== null && ahoraMin >= horaIni * 60 && ahoraMin <= horaFin * 60 && (
                  <div className="now" style={{ top: y(ahoraMin) }} aria-hidden />
                )}
                {citas
                  .filter((c) => clave(c) === col.id)
                  .map((c) => {
                    const ini = new Date(c.inicio) < new Date(desde) ? 0 : minutosDelDia(new Date(c.inicio), tz);
                    const fin = new Date(c.fin) >= new Date(hasta) ? 1440 : minutosDelDia(new Date(c.fin), tz);
                    const cliente = c.clientes ? `${c.clientes.nombre} ${c.clientes.apellidos ?? ""}` : "";
                    return (
                      <Link
                        key={c.id}
                        href={`/agenda/${c.id}`}
                        className={`cita ${c.estado}`}
                        style={{ top: y(ini) + 1, height: Math.max(26, y(fin) - y(ini) - 2), outline: sp.nueva === c.id ? "2px solid var(--accent)" : undefined }}
                        title={`${hora(c.inicio, tz)}–${hora(c.fin, tz)} · ${cliente} · ${ESTADOS_CITA[c.estado]}`}
                      >
                        <span className="t">{hora(c.inicio, tz)}–{hora(c.fin, tz)} · {ESTADOS_CITA[c.estado]}</span>
                        <b>{c.vehiculos?.placa} · {c.servicios?.nombre ?? "Servicio"}</b>
                        <span>{cliente}</span>
                        <span className="muted">{vista === "bahias" ? (c.tecnico?.nombre ?? "Sin técnico") : (c.bahias?.nombre ?? "Sin bahía")}</span>
                      </Link>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
