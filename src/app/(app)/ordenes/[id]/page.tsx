import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { CHECKLIST_RECEPCION, ESTADOS_ORDEN, ESTADOS_TECNICO, METODOS_PAGO, TRANSICIONES_ORDEN, type EstadoOrden } from "@/lib/tipos";
import { dinero, fechaHora } from "@/lib/fechas";
import FormSimple from "@/components/FormSimple";
import AgregarPieza from "@/components/AgregarPieza";
import RelojVivo from "@/components/RelojVivo";
import {
  actualizarTrabajo, agregarTrabajo, alternarReloj, cambiarEstadoOrden, eliminarTrabajo,
  guardarRecepcion, marcarTrabajoHecho, registrarPago, retirarPieza,
} from "../actions";

export const metadata: Metadata = { title: "Orden de trabajo" };

const TEXTO_ACCION: Record<EstadoOrden, string> = {
  abierta: "Reabrir",
  diagnostico: "Iniciar diagnóstico",
  esperando_aprobacion: "Pedir aprobación al cliente",
  esperando_piezas: "En espera de piezas",
  en_proceso: "Trabajar",
  control_calidad: "Pasar a control de calidad",
  terminada: "Lista para entregar",
  entregada: "Entregar al cliente",
  cancelada: "Cancelar orden",
};

const MENSAJES: Record<string, string> = {
  transicion: "Ese cambio de estado no es válido desde el estado actual.",
  permiso: "Tu rol no puede hacer ese cambio.",
};

type Trabajo = {
  id: string; descripcion: string; horas_cobradas: number; precio: number; aprobado: boolean; completado_en: string | null;
  tecnico_id: string | null; categorias_servicio: { nombre: string } | null; tecnico: { nombre: string } | null;
  registros_tiempo: { id: string; tecnico_id: string; inicio: string; fin: string | null; horas: number | null }[];
  orden_piezas: { id: string; cantidad: number; precio_unitario: number; costo_unitario: number; metodo: string; articulos: { nombre: string; sku: string; unidad: string } | null; ubicaciones: { codigo: string } | null }[];
};

export default async function OrdenPage({
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

  const { data: orden } = await supabase
    .from("ordenes_trabajo")
    .select(
      "*, clientes(id, nombre, apellidos, telefono), vehiculos(id, placa, marca, modelo, anio, kilometraje_actual), bahias(nombre), sucursales(nombre, zona_horaria), asesor:perfiles!ordenes_trabajo_asesor_id_fkey(nombre)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!orden) notFound();
  const o = orden as unknown as {
    id: string; folio: number; sucursal_id: string; cita_id: string | null; estado: EstadoOrden;
    kilometraje_ingreso: number | null; nivel_combustible: number | null; diagnostico: string | null; descuento: number;
    recibido_en: string; iniciado_en: string | null; terminado_en: string | null; entregado_en: string | null;
    clientes: { id: string; nombre: string; apellidos: string | null; telefono: string | null } | null;
    vehiculos: { id: string; placa: string; marca: string; modelo: string; anio: number; kilometraje_actual: number | null } | null;
    bahias: { nombre: string } | null; sucursales: { nombre: string; zona_horaria: string } | null; asesor: { nombre: string } | null;
    inventario_vehiculo: { checklist?: Record<string, boolean>; observaciones?: string | null };
  };

  const gestiona = perfil.rol !== "tecnico";
  const finanzas = perfil.rol === "admin" || perfil.rol === "gerente";
  const [{ data: trabajosData }, { data: totales }, { data: pagos }, { data: servicios }, { data: categorias }, { data: tecnicos }, { data: ubicaciones }] = await Promise.all([
    supabase
      .from("orden_servicios")
      .select(
        "id, descripcion, horas_cobradas, precio, aprobado, completado_en, tecnico_id, categorias_servicio(nombre), tecnico:perfiles(nombre), registros_tiempo(id, tecnico_id, inicio, fin, horas), orden_piezas(id, cantidad, precio_unitario, costo_unitario, metodo, articulos(nombre, sku, unidad), ubicaciones(codigo))",
      )
      .eq("orden_id", id)
      .order("created_at"),
    supabase.from("v_orden_totales").select("*").eq("orden_id", id).maybeSingle(),
    gestiona ? supabase.from("pagos").select("id, monto, metodo, referencia, created_at, perfiles(nombre)").eq("orden_id", id).order("created_at") : Promise.resolve({ data: [] }),
    gestiona ? supabase.from("servicios").select("id, nombre, precio_base").eq("activo", true).order("nombre") : Promise.resolve({ data: [] }),
    gestiona ? supabase.from("categorias_servicio").select("id, nombre").order("nombre") : Promise.resolve({ data: [] }),
    gestiona ? supabase.from("perfiles").select("id, nombre").eq("rol", "tecnico").eq("activo", true).order("nombre") : Promise.resolve({ data: [] }),
    supabase.from("ubicaciones").select("id, codigo").eq("sucursal_id", o.sucursal_id).eq("activa", true).order("codigo"),
  ]);
  const trabajos = (trabajosData as unknown as Trabajo[]) ?? [];
  const t = totales as { ingreso_mano_obra: number; ingreso_piezas: number; ingreso_total: number; costo_mano_obra: number; costo_piezas: number; horas_reales: number; pagado: number } | null;
  const tz = o.sucursales?.zona_horaria ?? (await sucursalActiva(perfil))?.zona_horaria ?? "America/Mexico_City";
  const cerrada = o.estado === "entregada" || o.estado === "cancelada";
  const saldo = Number(t?.ingreso_total ?? 0) - Number(t?.pagado ?? 0);
  const costo = Number(t?.costo_mano_obra ?? 0) + Number(t?.costo_piezas ?? 0);

  let acciones = TRANSICIONES_ORDEN[o.estado];
  if (!gestiona) acciones = acciones.filter((e) => ESTADOS_TECNICO.includes(e));
  const misTrabajos = trabajos.filter((tr) => gestiona || tr.tecnico_id === perfil.id);
  // El reloj lo usa el técnico asignado; gerencia también puede registrar su propio tiempo
  const usaReloj = (tr: Trabajo) => !cerrada && (perfil.rol === "tecnico" ? tr.tecnico_id === perfil.id : finanzas);
  const checklist = o.inventario_vehiculo?.checklist ?? {};

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/ordenes">Órdenes</Link> /</p>
          <h1>OT {o.folio} · {o.vehiculos && <span className="placa" style={{ fontSize: "0.8em" }}>{o.vehiculos.placa}</span>}</h1>
          <p className="sub">
            {o.vehiculos?.marca} {o.vehiculos?.modelo} {o.vehiculos?.anio} ·{" "}
            {o.clientes && (gestiona ? <Link href={`/clientes/${o.clientes.id}`}>{o.clientes.nombre} {o.clientes.apellidos ?? ""}</Link> : `${o.clientes.nombre} ${o.clientes.apellidos ?? ""}`)}
            {gestiona && o.clientes?.telefono && <span className="num"> · {o.clientes.telefono}</span>}
          </p>
        </div>
        <span className={`chip ${o.estado}`} style={{ fontSize: 14 }}>{ESTADOS_ORDEN[o.estado]}</span>
      </div>

      {error && <div className="alert error" role="alert">{MENSAJES[error] ?? error}</div>}

      <div className="timeline">
        <span>Recibido <b>{fechaHora(o.recibido_en, tz)}</b>{o.asesor && ` por ${o.asesor.nombre}`}</span>
        {o.iniciado_en && <span>Iniciado <b>{fechaHora(o.iniciado_en, tz)}</b></span>}
        {o.terminado_en && <span>Terminado <b>{fechaHora(o.terminado_en, tz)}</b></span>}
        {o.entregado_en && <span>Entregado <b>{fechaHora(o.entregado_en, tz)}</b></span>}
        {o.bahias && <span>Bahía <b>{o.bahias.nombre}</b></span>}
        {o.cita_id && gestiona && <Link href={`/agenda/${o.cita_id}`}>Ver cita</Link>}
      </div>

      {acciones.length > 0 && (
        <div className="row">
          {acciones.map((nuevo) => (
            <form key={nuevo} action={cambiarEstadoOrden.bind(null, o.id, o.estado, nuevo)}>
              <button className={`btn ${nuevo === "cancelada" ? "danger" : nuevo === "entregada" || nuevo === "terminada" ? "primary" : ""}`} type="submit">
                {TEXTO_ACCION[nuevo]}
              </button>
            </form>
          ))}
        </div>
      )}
      {o.estado === "terminada" && saldo > 0.005 && gestiona && (
        <div className="alert error">Falta cobrar {dinero(saldo)} antes de entregar.</div>
      )}

      <section className="panel">
        <h2>Trabajos <span className="muted mono" style={{ fontSize: 13 }}>{trabajos.length}</span></h2>
        {trabajos.length === 0 && <div className="empty">Aún no hay trabajos. {gestiona ? "Agrega el primero abajo." : ""}</div>}
        {trabajos.map((tr) => {
          const corriendo = tr.registros_tiempo.find((r) => !r.fin && r.tecnico_id === perfil.id);
          const horasReales = tr.registros_tiempo.reduce((s, r) => s + Number(r.horas ?? 0), 0);
          const otroCorriendo = tr.registros_tiempo.some((r) => !r.fin && r.tecnico_id !== perfil.id);
          const piezas = tr.orden_piezas.reduce((s, p) => s + Number(p.cantidad) * Number(p.precio_unitario ?? 0), 0);
          const puedeMarcar = !cerrada && (gestiona || tr.tecnico_id === perfil.id);
          return (
            <article key={tr.id} className={`trabajo${tr.completado_en ? " hecho" : ""}`}>
              <header>
                <div className="row">
                  <b>{tr.descripcion}</b>
                  {tr.categorias_servicio && <span className="chip">{tr.categorias_servicio.nombre}</span>}
                  {tr.completado_en && <span className="chip terminada">Hecho</span>}
                  {gestiona && !tr.aprobado && <span className="chip esperando_aprobacion">Sin aprobar</span>}
                </div>
                {gestiona && <span className="num">{dinero(Number(tr.precio) + piezas)}</span>}
              </header>
              <div className="meta muted row" style={{ fontSize: 13 }}>
                <span>{tr.tecnico?.nombre ?? "Sin técnico"}</span>
                <span className="num">Horas reales {horasReales.toFixed(2)} / cobradas {Number(tr.horas_cobradas).toFixed(2)}</span>
                {gestiona && <span className="num">Mano de obra {dinero(tr.precio)}</span>}
                {otroCorriendo && <span className="reloj corriendo">Reloj encendido</span>}
              </div>
              <div className="row">
                {usaReloj(tr) && (
                  <form action={alternarReloj.bind(null, tr.id, o.id)}>
                    <button className={`btn ${corriendo ? "" : "primary"}`} type="submit">
                      {corriendo ? <>Detener <RelojVivo desde={corriendo.inicio} /></> : "Iniciar reloj"}
                    </button>
                  </form>
                )}
                {puedeMarcar && (
                  <form action={marcarTrabajoHecho.bind(null, tr.id, o.id, !tr.completado_en)}>
                    <button className="btn small" type="submit">{tr.completado_en ? "Desmarcar hecho" : "Marcar hecho"}</button>
                  </form>
                )}
                {gestiona && !cerrada && tr.orden_piezas.length === 0 && tr.registros_tiempo.length === 0 && (
                  <form action={eliminarTrabajo.bind(null, tr.id, o.id)}>
                    <button className="btn small danger" type="submit">Quitar</button>
                  </form>
                )}
              </div>
              {tr.orden_piezas.length > 0 && (
                <ul className="list">
                  {tr.orden_piezas.map((p) => (
                    <li key={p.id}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span>{p.articulos?.nombre} <span className="muted mono">×{Number(p.cantidad)} {p.articulos?.unidad} · {p.ubicaciones?.codigo}</span></span>
                        <span className="row">
                          {gestiona && <span className="num">{dinero(Number(p.cantidad) * Number(p.precio_unitario ?? 0))}</span>}
                          {finanzas && !cerrada && (
                            <form action={retirarPieza.bind(null, p.id, o.id)}>
                              <button className="btn small" type="submit" title="Devuelve la pieza al inventario">Devolver</button>
                            </form>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {gestiona && !cerrada && (
                <details>
                  <summary className="btn small">Editar</summary>
                  <div style={{ marginTop: 12 }}>
                    <FormSimple accion={actualizarTrabajo} textoBoton="Guardar" limpiar={false}>
                      <input type="hidden" name="id" value={tr.id} />
                      <input type="hidden" name="orden_id" value={o.id} />
                      <div className="fields">
                        <div className="field wide">
                          <label htmlFor={`d-${tr.id}`}>Descripción</label>
                          <input id={`d-${tr.id}`} name="descripcion" defaultValue={tr.descripcion} required />
                        </div>
                        <div className="field">
                          <label htmlFor={`t-${tr.id}`}>Técnico</label>
                          <select id={`t-${tr.id}`} name="tecnico_id" defaultValue={tr.tecnico_id ?? ""}>
                            <option value="">Sin asignar</option>
                            {(tecnicos ?? []).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`h-${tr.id}`}>Horas cobradas</label>
                          <input id={`h-${tr.id}`} name="horas_cobradas" inputMode="decimal" defaultValue={tr.horas_cobradas} />
                        </div>
                        <div className="field">
                          <label htmlFor={`p-${tr.id}`}>Mano de obra</label>
                          <input id={`p-${tr.id}`} name="precio" inputMode="decimal" defaultValue={tr.precio} />
                        </div>
                        <label className="row" style={{ gap: 6, fontWeight: 400 }}>
                          <input type="checkbox" name="aprobado" defaultChecked={tr.aprobado} /> Aprobado por el cliente
                        </label>
                      </div>
                    </FormSimple>
                  </div>
                </details>
              )}
            </article>
          );
        })}

        {gestiona && !cerrada && (
          <details>
            <summary className="btn">Agregar trabajo</summary>
            <div style={{ marginTop: 12 }}>
              <FormSimple accion={agregarTrabajo} textoBoton="Agregar trabajo">
                <input type="hidden" name="orden_id" value={o.id} />
                <div className="fields">
                  <div className="field">
                    <label htmlFor="n-serv">Del catálogo</label>
                    <select id="n-serv" name="servicio_id" defaultValue="">
                      <option value="">Otro (descríbelo)</option>
                      {(servicios as { id: string; nombre: string; precio_base: number }[] ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre} · {dinero(s.precio_base)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="n-cat">Tipo de trabajo</label>
                    <select id="n-cat" name="categoria_id" defaultValue="">
                      <option value="">El del servicio</option>
                      {(categorias ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="field wide">
                    <label htmlFor="n-desc">Descripción</label>
                    <input id="n-desc" name="descripcion" placeholder="Solo si no es del catálogo o quieres detallarlo" />
                  </div>
                  <div className="field">
                    <label htmlFor="n-tec">Técnico</label>
                    <select id="n-tec" name="tecnico_id" defaultValue="">
                      <option value="">Sin asignar</option>
                      {(tecnicos ?? []).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="n-h">Horas cobradas</label>
                    <input id="n-h" name="horas_cobradas" inputMode="decimal" placeholder="Las del catálogo" />
                  </div>
                  <div className="field">
                    <label htmlFor="n-p">Mano de obra</label>
                    <input id="n-p" name="precio" inputMode="decimal" placeholder="La del catálogo" />
                  </div>
                  <label className="row" style={{ gap: 6, fontWeight: 400 }}>
                    <input type="checkbox" name="aprobado" /> Ya lo aprobó el cliente
                  </label>
                </div>
              </FormSimple>
            </div>
          </details>
        )}
      </section>

      <div className="grid2">
        {!cerrada && (
          <section className="panel">
            <h2>Piezas e insumos</h2>
            <AgregarPieza
              ordenId={o.id}
              sucursalId={o.sucursal_id}
              trabajos={misTrabajos.map((tr) => ({ id: tr.id, descripcion: tr.descripcion }))}
              ubicaciones={ubicaciones ?? []}
            />
            <p className="muted" style={{ fontSize: 13 }}>Cada pieza se descuenta del inventario y queda en el kardex con el folio de esta orden.</p>
          </section>
        )}

        {gestiona && (
          <section className="panel">
            <h2>Cuenta</h2>
            <dl className="totales">
              <dt>Mano de obra</dt><dd>{dinero(t?.ingreso_mano_obra)}</dd>
              <dt>Piezas</dt><dd>{dinero(t?.ingreso_piezas)}</dd>
              {Number(o.descuento) > 0 && (<><dt>Descuento</dt><dd>−{dinero(o.descuento)}</dd></>)}
              <dt>Total</dt><dd className="grande">{dinero(t?.ingreso_total)}</dd>
              <dt>Pagado</dt><dd>{dinero(t?.pagado)}</dd>
              <dt>Saldo</dt><dd style={{ color: saldo > 0.005 ? "var(--warn)" : "var(--ok)", fontWeight: 600 }}>{dinero(saldo)}</dd>
            </dl>
            {finanzas && (
              <dl className="totales" style={{ fontSize: 13.5, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <dt>Costo de piezas</dt><dd>{dinero(t?.costo_piezas)}</dd>
                <dt>Costo de mano de obra ({Number(t?.horas_reales ?? 0).toFixed(2)} h)</dt><dd>{dinero(t?.costo_mano_obra)}</dd>
                <dt>Utilidad</dt>
                <dd>{dinero(Number(t?.ingreso_total ?? 0) - costo)}{Number(t?.ingreso_total) > 0 && <span className="muted"> · {Math.round(((Number(t?.ingreso_total) - costo) / Number(t?.ingreso_total)) * 100)}%</span>}</dd>
              </dl>
            )}
            {(pagos ?? []).length > 0 && (
              <ul className="list">
                {(pagos as unknown as { id: string; monto: number; metodo: keyof typeof METODOS_PAGO; referencia: string | null; created_at: string; perfiles: { nombre: string } | null }[]).map((p) => (
                  <li key={p.id}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>{METODOS_PAGO[p.metodo]}{p.referencia && <span className="muted"> · {p.referencia}</span>}</span>
                      <b className="num">{dinero(p.monto)}</b>
                    </div>
                    <div className="meta"><span className="num">{fechaHora(p.created_at, tz)}</span>{p.perfiles && <span>{p.perfiles.nombre}</span>}</div>
                  </li>
                ))}
              </ul>
            )}
            {o.estado !== "cancelada" && (
              <FormSimple accion={registrarPago} textoBoton="Registrar pago">
                <input type="hidden" name="orden_id" value={o.id} />
                <div className="fields">
                  <div className="field">
                    <label htmlFor="pg-monto">Monto</label>
                    <input id="pg-monto" name="monto" inputMode="decimal" required defaultValue={saldo > 0.005 ? saldo.toFixed(2) : ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="pg-met">Método</label>
                    <select id="pg-met" name="metodo" defaultValue="efectivo">
                      {Object.entries(METODOS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="pg-ref">Referencia</label>
                    <input id="pg-ref" name="referencia" placeholder="Últimos 4 de la tarjeta, folio…" />
                  </div>
                </div>
              </FormSimple>
            )}
            <p className="muted" style={{ fontSize: 13 }}>Para un reembolso escribe el monto en negativo.</p>
          </section>
        )}
      </div>

      <section className="panel">
        <h2>Recepción del vehículo</h2>
        {gestiona && !cerrada ? (
          <FormSimple accion={guardarRecepcion} textoBoton="Guardar recepción" limpiar={false}>
            <input type="hidden" name="id" value={o.id} />
            <div className="fields">
              <div className="field">
                <label htmlFor="r-km">Kilometraje</label>
                <input id="r-km" name="kilometraje_ingreso" inputMode="numeric" defaultValue={o.kilometraje_ingreso ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="r-comb">Combustible</label>
                <select id="r-comb" name="nivel_combustible" defaultValue={o.nivel_combustible ?? ""}>
                  <option value="">Sin registrar</option>
                  <option value="0">Reserva</option><option value="25">1/4</option><option value="50">1/2</option><option value="75">3/4</option><option value="100">Lleno</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="r-desc">Descuento</label>
                <input id="r-desc" name="descuento" inputMode="decimal" defaultValue={o.descuento ?? 0} />
              </div>
              <div className="field wide">
                <label htmlFor="r-diag">Reporte y diagnóstico</label>
                <textarea id="r-diag" name="diagnostico" defaultValue={o.diagnostico ?? ""} />
              </div>
            </div>
            <div className="checks">
              {CHECKLIST_RECEPCION.map((c) => (
                <label key={c} className="row" style={{ gap: 6, fontWeight: 400 }}>
                  <input type="checkbox" name="checklist" value={c} defaultChecked={!!checklist[c]} /> {c}
                </label>
              ))}
            </div>
            <div className="field">
              <label htmlFor="r-obs">Observaciones de la carrocería</label>
              <textarea id="r-obs" name="observaciones" defaultValue={o.inventario_vehiculo?.observaciones ?? ""} />
            </div>
          </FormSimple>
        ) : (
          <dl className="kv">
            <dt>Kilometraje</dt><dd className="num">{o.kilometraje_ingreso?.toLocaleString("es-MX") ?? "—"}</dd>
            <dt>Combustible</dt><dd>{o.nivel_combustible != null ? `${o.nivel_combustible}%` : "—"}</dd>
            <dt>Reporte</dt><dd>{o.diagnostico ?? "—"}</dd>
            <dt>Revisado</dt><dd>{Object.keys(checklist).join(", ") || "—"}</dd>
            <dt>Carrocería</dt><dd>{o.inventario_vehiculo?.observaciones ?? "—"}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
