import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { CANALES } from "@/lib/tipos";
import { dinero, fechaHora, fechaLarga, fechaLocal, hora, localAInstante, sumarDias } from "@/lib/fechas";
import { canalDeEnvio, enlaceMensaje, rellenar } from "@/lib/mensajes";
import BotonEnvio from "@/components/BotonEnvio";
import { confirmarCita, estadoRecordatorio, posponerRecordatorio } from "./actions";

export const metadata: Metadata = { title: "Mensajes" };

type Rec = {
  id: string; cliente_id: string; vehiculo_id: string; titulo: string; vence_fecha: string | null; vence_km: number | null; motivo: "fecha" | "km";
  cliente_nombre: string; cliente_apellidos: string | null; telefono: string | null; email: string | null; canal_preferido: string;
  placa: string; marca: string; modelo: string; kilometraje_actual: number | null;
};
type Cita = {
  id: string; inicio: string; cliente_id: string; vehiculo_id: string;
  clientes: { nombre: string; apellidos: string | null; telefono: string | null; email: string | null; canal_preferido: string } | null;
  vehiculos: { placa: string; marca: string; modelo: string } | null; servicios: { nombre: string } | null;
};
type Lista = {
  id: string; folio: number; cliente_id: string; vehiculo_id: string; moneda: string;
  clientes: { nombre: string; telefono: string | null; email: string | null; canal_preferido: string } | null;
  vehiculos: { placa: string; marca: string; modelo: string } | null;
  comunicaciones: { id: string }[];
};

export default async function ComunicacionPage() {
  const perfil = await requierePerfil(["admin", "gerente", "recepcion"]);
  const sucursal = await sucursalActiva(perfil);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const tz = sucursal.zona_horaria;
  const manana = sumarDias(fechaLocal(new Date(), tz), 1);
  const gestion = perfil.rol !== "recepcion";

  const [{ data: recs }, { data: citas }, { data: listas }, { data: plantillas }, { data: suc }, { data: bitacora }] = await Promise.all([
    supabase.from("v_recordatorios_por_enviar").select("*").order("vence_fecha", { nullsFirst: false }).limit(200),
    supabase
      .from("citas")
      .select("id, inicio, cliente_id, vehiculo_id, clientes(nombre, apellidos, telefono, email, canal_preferido), vehiculos(placa, marca, modelo), servicios(nombre)")
      .eq("sucursal_id", sucursal.id).eq("estado", "programada")
      .gte("inicio", localAInstante(manana, "00:00", tz).toISOString()).lt("inicio", localAInstante(sumarDias(manana, 1), "00:00", tz).toISOString())
      .order("inicio"),
    supabase
      .from("ordenes_trabajo")
      .select("id, folio, cliente_id, vehiculo_id, moneda, clientes(nombre, telefono, email, canal_preferido), vehiculos(placa, marca, modelo), comunicaciones(id)")
      .eq("sucursal_id", sucursal.id).eq("estado", "terminada").eq("comunicaciones.asunto", "Vehículo listo"),
    supabase.from("plantillas_mensaje").select("clave, asunto, texto"),
    supabase.from("sucursales").select("prefijo_telefono").eq("id", sucursal.id).maybeSingle(),
    supabase.from("comunicaciones").select("id, canal, direccion, asunto, contenido, ocurrido_en, cliente_id, clientes(nombre, apellidos), perfiles(nombre)").order("ocurrido_en", { ascending: false }).limit(30),
  ]);
  const P = new Map(((plantillas as { clave: string; asunto: string | null; texto: string }[]) ?? []).map((p) => [p.clave, p]));
  const prefijo = (suc as { prefijo_telefono: string } | null)?.prefijo_telefono ?? "51";
  const rs = (recs as Rec[]) ?? [];
  const cs = (citas as unknown as Cita[]) ?? [];
  const ls = ((listas as unknown as Lista[]) ?? []).filter((o) => o.comunicaciones.length === 0);
  const ids = ls.map((o) => o.id);
  const { data: totales } = ids.length ? await supabase.from("v_orden_totales").select("orden_id, ingreso_total, pagado").in("orden_id", ids) : { data: [] };
  const tot = new Map(((totales as { orden_id: string; ingreso_total: number; pagado: number }[]) ?? []).map((t) => [t.orden_id, t]));

  return (
    <>
      <div className="head">
        <div>
          <h1>Mensajes</h1>
          <p className="sub">Recordatorios de servicio, confirmación de citas y avisos. Cada envío queda en la bitácora del cliente.</p>
        </div>
        {gestion && (
          <div className="row">
            <Link className="btn" href="/comunicacion/segmentos">Segmentos y campañas</Link>
            <Link className="btn" href="/comunicacion/plantillas">Plantillas</Link>
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat"><b style={{ color: rs.length ? "var(--warn)" : undefined }}>{rs.length}</b><span>Recordatorios por enviar</span></div>
        <div className="stat"><b>{cs.length}</b><span>Citas de mañana sin confirmar</span></div>
        <div className="stat"><b>{ls.length}</b><span>Vehículos listos sin avisar</span></div>
      </div>

      <section className="panel">
        <h2>Recordatorios de servicio</h2>
        {rs.length === 0 ? (
          <div className="empty">No hay recordatorios por enviar hoy. Se crean solos al entregar servicios con intervalo (aceite, afinación, lavado…).</div>
        ) : (
          <ul className="list">
            {rs.map((r) => {
              const canal = canalDeEnvio(r.canal_preferido, r);
              const pl = P.get("recordatorio");
              const texto = rellenar(pl?.texto ?? "", {
                nombre: r.cliente_nombre, placa: r.placa, vehiculo: `${r.marca} ${r.modelo}`, servicio: r.titulo.toLowerCase(),
                fecha: r.motivo === "km" && r.vence_km ? `a los ${r.vence_km.toLocaleString("es-PE")} km` : r.vence_fecha ? fechaLarga(r.vence_fecha).toLowerCase() : "",
              });
              return (
                <li key={r.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="row">
                      <Link href={`/clientes/${r.cliente_id}`}><b>{r.cliente_nombre} {r.cliente_apellidos ?? ""}</b></Link>
                      <span className="placa">{r.placa}</span>
                      <span>{r.titulo}</span>
                    </span>
                    <span className="row">
                      <BotonEnvio enlace={enlaceMensaje(canal, r, prefijo, texto, pl?.asunto ? rellenar(pl.asunto, { servicio: r.titulo.toLowerCase() }) : null)} envio={{ cliente_id: r.cliente_id, vehiculo_id: r.vehiculo_id, recordatorio_id: r.id, canal, asunto: "Recordatorio de servicio", contenido: texto }} />
                      <form action={posponerRecordatorio.bind(null, r.id, 30)}><button className="btn small" type="submit">Posponer 30 días</button></form>
                      <form action={estadoRecordatorio.bind(null, r.id, "cancelado")}><button className="btn small danger" type="submit">Descartar</button></form>
                    </span>
                  </div>
                  <div className="meta">
                    <span>{r.motivo === "km" ? `toca a los ${r.vence_km?.toLocaleString("es-PE")} km (último registro ${r.kilometraje_actual?.toLocaleString("es-PE")} km)` : `vence ${r.vence_fecha}`}</span>
                    <span>{CANALES[canal]}</span>
                    {r.telefono && <span className="num">{r.telefono}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Citas de mañana por confirmar</h2>
          {cs.length === 0 ? (
            <div className="empty">No hay citas sin confirmar para mañana.</div>
          ) : (
            <ul className="list">
              {cs.map((c) => {
                const cli = c.clientes!;
                const canal = canalDeEnvio(cli.canal_preferido, cli);
                const pl = P.get("confirmar_cita");
                const texto = rellenar(pl?.texto ?? "", {
                  nombre: cli.nombre, placa: c.vehiculos?.placa, vehiculo: `${c.vehiculos?.marca} ${c.vehiculos?.modelo}`,
                  servicio: c.servicios?.nombre?.toLowerCase() ?? "revisión", fecha: fechaLarga(manana).toLowerCase(), hora: hora(c.inicio, tz),
                });
                return (
                  <li key={c.id}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="row"><Link href={`/agenda/${c.id}`}>{hora(c.inicio, tz)}</Link><b>{cli.nombre} {cli.apellidos ?? ""}</b>{c.vehiculos && <span className="placa">{c.vehiculos.placa}</span>}</span>
                      <span className="row">
                        <BotonEnvio enlace={enlaceMensaje(canal, cli, prefijo, texto, pl?.asunto ? rellenar(pl.asunto, {}) : null)} envio={{ cliente_id: c.cliente_id, vehiculo_id: c.vehiculo_id, cita_id: c.id, canal, asunto: "Confirmar cita", contenido: texto }} />
                        <form action={confirmarCita.bind(null, c.id)}><button className="btn small" type="submit">Confirmó</button></form>
                      </span>
                    </div>
                    <div className="meta"><span>{c.servicios?.nombre ?? "Por diagnosticar"}</span></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Vehículos listos para avisar</h2>
          {ls.length === 0 ? (
            <div className="empty">No hay vehículos terminados pendientes de aviso.</div>
          ) : (
            <ul className="list">
              {ls.map((o) => {
                const cli = o.clientes!;
                const canal = canalDeEnvio(cli.canal_preferido, cli);
                const t = tot.get(o.id);
                const pl = P.get("vehiculo_listo");
                const texto = rellenar(pl?.texto ?? "", { nombre: cli.nombre, placa: o.vehiculos?.placa, vehiculo: `${o.vehiculos?.marca} ${o.vehiculos?.modelo}`, total: dinero(Number(t?.ingreso_total ?? 0) - Number(t?.pagado ?? 0), o.moneda) });
                return (
                  <li key={o.id}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="row"><Link className="mono" href={`/ordenes/${o.id}`}>OT {o.folio}</Link><b>{cli.nombre}</b>{o.vehiculos && <span className="placa">{o.vehiculos.placa}</span>}</span>
                      <BotonEnvio enlace={enlaceMensaje(canal, cli, prefijo, texto, pl?.asunto ?? null)} envio={{ cliente_id: o.cliente_id, vehiculo_id: o.vehiculo_id, orden_id: o.id, canal, asunto: "Vehículo listo", contenido: texto }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Bitácora reciente</h2>
        {(bitacora ?? []).length === 0 ? (
          <div className="empty">Aún no hay comunicaciones registradas.</div>
        ) : (
          <ul className="list">
            {(bitacora as unknown as { id: string; canal: keyof typeof CANALES; direccion: string; asunto: string | null; contenido: string; ocurrido_en: string; cliente_id: string; clientes: { nombre: string; apellidos: string | null } | null; perfiles: { nombre: string } | null }[]).map((m) => (
              <li key={m.id}>
                <div className="meta">
                  <span className="chip">{CANALES[m.canal]}</span>
                  <Link href={`/clientes/${m.cliente_id}`}>{m.clientes?.nombre} {m.clientes?.apellidos ?? ""}</Link>
                  {m.asunto && <b>{m.asunto}</b>}
                  <span className="num">{fechaHora(m.ocurrido_en, tz)}</span>
                  {m.perfiles && <span>{m.perfiles.nombre}</span>}
                </div>
                <p style={{ margin: 0, fontSize: 14 }}>{m.contenido}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted" style={{ fontSize: 13 }}>
        Los botones abren WhatsApp, SMS o el correo con el mensaje listo; tú solo pulsas enviar. Si más adelante quieres que salgan solos, se conecta una cuenta de WhatsApp Business (Twilio) o de correo (Resend).
      </p>
    </>
  );
}
