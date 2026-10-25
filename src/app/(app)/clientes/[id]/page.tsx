import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { CANALES, ESTADOS_CITA, TIPOS_VEHICULO, type EstadoCita } from "@/lib/tipos";
import { dinero, fechaHora } from "@/lib/fechas";
import FormCliente from "@/components/FormCliente";
import FormSimple from "@/components/FormSimple";
import CamposVehiculo from "@/components/CamposVehiculo";
import { actualizarCliente, agregarVehiculo, registrarComunicacion } from "../actions";

export const metadata: Metadata = { title: "Cliente" };

type Vehiculo = {
  id: string; placa: string; marca: string; modelo: string; anio: number; tipo: keyof typeof TIPOS_VEHICULO;
  color: string | null; vin: string | null; kilometraje_actual: number | null; activo: boolean;
};
type Historial = {
  orden_id: string; folio: number; placa: string; recibido_en: string; entregado_en: string | null;
  kilometraje_ingreso: number | null; categoria: string; trabajo: string; tecnico: string | null;
  horas_cobradas: number; horas_reales: number | null; mano_obra: number; piezas: number; piezas_detalle: string | null;
};

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const perfil = await requierePerfil();
  const { id } = await params;
  const { aviso } = await searchParams;
  const supabase = await createClient();
  const tz = (await sucursalActiva(perfil))?.zona_horaria ?? "America/Lima";

  const [{ data: cliente }, { data: vehiculos }, { data: historial }, { data: citas }, { data: comunicaciones }, { data: recordatorios }, { data: metricas }] =
    await Promise.all([
      supabase.from("clientes").select("*").eq("id", id).maybeSingle(),
      supabase.from("vehiculos").select("*").eq("cliente_id", id).order("activo", { ascending: false }).order("created_at"),
      supabase.from("v_historial_servicio").select("*").eq("cliente_id", id).order("recibido_en", { ascending: false }).limit(100),
      supabase
        .from("citas")
        .select("id, inicio, estado, vehiculos(placa), servicios(nombre)")
        .eq("cliente_id", id)
        .gte("inicio", new Date(Date.now() - 86400000).toISOString())
        .order("inicio")
        .limit(10),
      perfil.rol === "tecnico"
        ? Promise.resolve({ data: [] })
        : supabase.from("comunicaciones").select("id, canal, direccion, asunto, contenido, ocurrido_en, perfiles(nombre)").eq("cliente_id", id).order("ocurrido_en", { ascending: false }).limit(30),
      perfil.rol === "tecnico"
        ? Promise.resolve({ data: [] })
        : supabase.from("recordatorios").select("id, titulo, vence_fecha, vence_km, estado, vehiculos(placa)").eq("cliente_id", id).in("estado", ["pendiente", "enviado"]).order("vence_fecha"),
      supabase.from("v_cliente_metricas").select("visitas, gasto_total, ticket_promedio, ultima_visita").eq("cliente_id", id).maybeSingle(),
    ]);

  if (!cliente) notFound();
  const puedeEditar = perfil.rol !== "tecnico";
  const vs = (vehiculos as Vehiculo[]) ?? [];
  const hs = (historial as Historial[]) ?? [];
  const nombre = cliente.tipo === "empresa" && cliente.razon_social ? cliente.razon_social : `${cliente.nombre} ${cliente.apellidos ?? ""}`;

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/clientes">Clientes</Link> /</p>
          <h1>{nombre}</h1>
          <p className="sub num">
            {[cliente.telefono, cliente.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
            {" · prefiere "}{CANALES[cliente.canal_preferido as keyof typeof CANALES] ?? cliente.canal_preferido}
          </p>
        </div>
        {puedeEditar && (
          <Link className="btn primary" href={`/agenda/nueva?cliente=${cliente.id}`}>
            Agendar cita
          </Link>
        )}
      </div>

      {aviso && <div className="alert error">{aviso}</div>}

      <div className="stats">
        <div className="stat"><b>{metricas?.visitas ?? 0}</b><span>Visitas</span></div>
        <div className="stat"><b>{dinero(metricas?.gasto_total)}</b><span>Gasto total</span></div>
        <div className="stat"><b>{dinero(metricas?.ticket_promedio)}</b><span>Ticket promedio</span></div>
        <div className="stat"><b>{metricas?.ultima_visita ? fechaHora(metricas.ultima_visita, tz).split(",")[0] : "—"}</b><span>Última visita</span></div>
      </div>

      <div className="grid2">
        <section className="panel">
          <h2>Vehículos <span className="muted mono" style={{ fontSize: 13 }}>{vs.filter((v) => v.activo).length}</span></h2>
          {vs.length === 0 ? (
            <div className="empty">Este cliente aún no tiene vehículos.</div>
          ) : (
            <ul className="list">
              {vs.map((v) => (
                <li key={v.id} style={{ opacity: v.activo ? 1 : 0.55 }}>
                  <div className="row">
                    <span className="placa">{v.placa}</span>
                    <b>{v.marca} {v.modelo} {v.anio}</b>
                    {!v.activo && <span className="chip">Inactivo</span>}
                    {v.activo && puedeEditar && <Link className="btn small" href={`/ordenes/nueva?vehiculo=${v.id}`}>Recibir</Link>}
                  </div>
                  <div className="meta">
                    <span>{TIPOS_VEHICULO[v.tipo]}</span>
                    {v.color && <span>{v.color}</span>}
                    {v.kilometraje_actual != null && <span className="num">{v.kilometraje_actual.toLocaleString("es-PE")} km</span>}
                    {v.vin && <span className="mono">VIN {v.vin}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {puedeEditar && (
            <details>
              <summary className="btn small">Agregar vehículo</summary>
              <div style={{ marginTop: 14 }}>
                <FormSimple accion={agregarVehiculo} textoBoton="Agregar vehículo">
                  <input type="hidden" name="cliente_id" value={cliente.id} />
                  <CamposVehiculo prefijo="nv" />
                </FormSimple>
              </div>
            </details>
          )}
        </section>

        <section className="panel">
          <h2>Próximas citas</h2>
          {(citas ?? []).length === 0 ? (
            <div className="empty">Sin citas próximas.</div>
          ) : (
            <ul className="list">
              {(citas as unknown as { id: string; inicio: string; estado: EstadoCita; vehiculos: { placa: string } | null; servicios: { nombre: string } | null }[]).map((c) => (
                <li key={c.id}>
                  <div className="row">
                    <Link href={`/agenda/${c.id}`}>{fechaHora(c.inicio, tz)}</Link>
                    <span className={`chip ${c.estado}`}>{ESTADOS_CITA[c.estado]}</span>
                  </div>
                  <div className="meta">
                    {c.vehiculos && <span className="placa">{c.vehiculos.placa}</span>}
                    <span>{c.servicios?.nombre ?? "Servicio por definir"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {perfil.rol !== "tecnico" && (
            <>
              <h3>Recordatorios pendientes</h3>
              {(recordatorios ?? []).length === 0 ? (
                <p className="muted">Ninguno. Se crean solos al entregar un servicio con intervalo (aceite, afinación…).</p>
              ) : (
                <ul className="list">
                  {(recordatorios as unknown as { id: string; titulo: string; vence_fecha: string | null; vence_km: number | null; estado: string; vehiculos: { placa: string } | null }[]).map((r) => (
                    <li key={r.id}>
                      <b>{r.titulo}</b>
                      <div className="meta">
                        {r.vehiculos && <span className="placa">{r.vehiculos.placa}</span>}
                        {r.vence_fecha && <span>vence {r.vence_fecha}</span>}
                        {r.vence_km && <span className="num">o a {r.vence_km.toLocaleString("es-PE")} km</span>}
                        <span>{r.estado}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Historial de servicio</h2>
        {hs.length === 0 ? (
          <div className="empty">Aún no hay servicios registrados para este cliente.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th><th>Placa</th><th>Tipo de trabajo</th><th>Trabajo</th><th>Técnico</th>
                  <th>Horas</th><th>Piezas usadas</th><th>Mano de obra</th><th>Piezas</th>
                </tr>
              </thead>
              <tbody>
                {hs.map((h, i) => (
                  <tr key={`${h.orden_id}-${i}`}>
                    <td className="num">{fechaHora(h.recibido_en, tz)}<div className="muted mono"><Link href={`/ordenes/${h.orden_id}`}>OT {h.folio}</Link>{h.kilometraje_ingreso != null && ` · ${h.kilometraje_ingreso.toLocaleString("es-PE")} km`}</div></td>
                    <td><span className="placa">{h.placa}</span></td>
                    <td><span className="chip">{h.categoria}</span></td>
                    <td>{h.trabajo}</td>
                    <td>{h.tecnico ?? "—"}</td>
                    <td className="num">{h.horas_reales ?? "—"} <span className="muted">/ {h.horas_cobradas}</span></td>
                    <td>{h.piezas_detalle ?? "—"}</td>
                    <td className="num">{dinero(h.mano_obra)}</td>
                    <td className="num">{dinero(h.piezas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 13 }}>Horas: reales / cobradas.</p>
      </section>

      {perfil.rol !== "tecnico" && (
        <div className="grid2">
          <section className="panel">
            <h2>Bitácora de comunicación</h2>
            <FormSimple accion={registrarComunicacion} textoBoton="Registrar">
              <input type="hidden" name="cliente_id" value={cliente.id} />
              <div className="fields">
                <div className="field">
                  <label htmlFor="com-canal">Canal</label>
                  <select id="com-canal" name="canal" defaultValue="llamada">
                    {Object.entries(CANALES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="com-dir">Dirección</label>
                  <select id="com-dir" name="direccion" defaultValue="saliente">
                    <option value="saliente">Nosotros al cliente</option>
                    <option value="entrante">Cliente a nosotros</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="com-veh">Vehículo</label>
                  <select id="com-veh" name="vehiculo_id" defaultValue="">
                    <option value="">General</option>
                    {vs.filter((v) => v.activo).map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
                  </select>
                </div>
                <div className="field wide">
                  <label htmlFor="com-cont">Qué se habló</label>
                  <textarea id="com-cont" name="contenido" required placeholder="Confirmó cita del lunes; pidió cotizar balatas traseras." />
                </div>
              </div>
            </FormSimple>
            <ul className="list">
              {(comunicaciones as unknown as { id: string; canal: keyof typeof CANALES; direccion: string; contenido: string; ocurrido_en: string; perfiles: { nombre: string } | null }[] ?? []).map((m) => (
                <li key={m.id}>
                  <div className="meta">
                    <span className="chip">{CANALES[m.canal]}</span>
                    <span>{m.direccion === "entrante" ? "del cliente" : m.direccion === "saliente" ? "al cliente" : "interna"}</span>
                    <span className="num">{fechaHora(m.ocurrido_en, tz)}</span>
                    {m.perfiles && <span>{m.perfiles.nombre}</span>}
                  </div>
                  <p>{m.contenido}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Datos del cliente</h2>
            <FormCliente accion={actualizarCliente} inicial={cliente} textoBoton="Guardar cambios" />
          </section>
        </div>
      )}
    </>
  );
}
