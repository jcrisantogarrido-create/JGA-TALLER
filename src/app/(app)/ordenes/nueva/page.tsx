import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { CHECKLIST_RECEPCION, MONEDAS } from "@/lib/tipos";
import { dinero } from "@/lib/fechas";
import FormSimple from "@/components/FormSimple";
import { abrirOrden } from "../actions";

export const metadata: Metadata = { title: "Recibir vehículo" };

type Veh = { id: string; placa: string; marca: string; modelo: string; anio: number; kilometraje_actual: number | null; clientes: { nombre: string; apellidos: string | null; telefono: string | null } | null };

export default async function NuevaOrdenPage({
  searchParams,
}: {
  searchParams: Promise<{ cita?: string; vehiculo?: string; placa?: string; sucursal?: string }>;
}) {
  const perfil = await requierePerfil(["admin", "gerente", "recepcion"]);
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();

  type Cita = { id: string; vehiculo_id: string; servicio_id: string | null; tecnico_id: string | null; bahia_id: string | null; motivo_cliente: string | null };
  let cita: Cita | null = null;
  if (sp.cita) {
    const { data: existente } = await supabase.from("ordenes_trabajo").select("id").eq("cita_id", sp.cita).maybeSingle();
    if (existente) redirect(`/ordenes/${existente.id}`);
    const { data } = await supabase.from("citas").select("id, vehiculo_id, servicio_id, tecnico_id, bahia_id, motivo_cliente").eq("id", sp.cita).maybeSingle();
    cita = data as Cita | null;
  }
  const vehiculoId = cita?.vehiculo_id ?? sp.vehiculo;
  const selVeh = "id, placa, marca, modelo, anio, kilometraje_actual, clientes(nombre, apellidos, telefono)";

  // Paso 1: buscar el vehículo por placa
  if (!vehiculoId) {
    const placa = (sp.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const { data } = placa
      ? await supabase.from("vehiculos").select(selVeh).eq("activo", true).ilike("placa_norm", `%${placa}%`).limit(20)
      : { data: [] };
    const encontrados = (data as unknown as Veh[]) ?? [];
    return (
      <>
        <div className="head">
          <div>
            <p className="sub"><Link href="/ordenes">Órdenes</Link> /</p>
            <h1>Recibir vehículo</h1>
            <p className="sub">Busca la placa. Si el vehículo llegó con cita, ábrelo desde la cita en la agenda.</p>
          </div>
        </div>
        <form className="scan" method="get">
          <input name="placa" defaultValue={sp.placa ?? ""} placeholder="Placa" aria-label="Placa" autoFocus autoComplete="off" />
          <button className="btn primary" type="submit">Buscar</button>
        </form>
        {placa && (encontrados.length === 0 ? (
          <div className="empty">
            No hay vehículos con la placa “{sp.placa}”. <Link href="/clientes/nuevo">Registra al cliente y su vehículo</Link> y vuelve aquí.
          </div>
        ) : (
          <ul className="list panel">
            {encontrados.map((v) => (
              <li key={v.id}>
                <div className="row">
                  <span className="placa">{v.placa}</span>
                  <b>{v.marca} {v.modelo} {v.anio}</b>
                  <Link className="btn small primary" href={`/ordenes/nueva?vehiculo=${v.id}`}>Recibir este</Link>
                </div>
                <div className="meta"><span>{v.clientes?.nombre} {v.clientes?.apellidos ?? ""}</span>{v.clientes?.telefono && <span className="num">{v.clientes.telefono}</span>}</div>
              </li>
            ))}
          </ul>
        ))}
      </>
    );
  }

  // Paso 2: datos de recepción
  const [{ data: veh }, { data: servicios }, { data: tecnicos }, { data: bahias }, { data: abierta }] = await Promise.all([
    supabase.from("vehiculos").select(selVeh).eq("id", vehiculoId).maybeSingle(),
    supabase.from("servicios").select("id, nombre, precio_base, moneda").eq("activo", true).order("nombre"),
    supabase.from("perfiles").select("id, nombre").eq("rol", "tecnico").eq("activo", true).order("nombre"),
    supabase.from("bahias").select("id, nombre").eq("sucursal_id", sucursal.id).eq("activa", true).order("nombre"),
    supabase.from("ordenes_trabajo").select("id, folio").eq("vehiculo_id", vehiculoId).not("estado", "in", "(entregada,cancelada)").limit(1).maybeSingle(),
  ]);
  const v = veh as unknown as Veh | null;
  if (!v) return <div className="empty">No se encontró el vehículo.</div>;

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/ordenes">Órdenes</Link> /</p>
          <h1>Recibir <span className="placa" style={{ fontSize: "0.8em" }}>{v.placa}</span></h1>
          <p className="sub">{v.marca} {v.modelo} {v.anio} · {v.clientes?.nombre} {v.clientes?.apellidos ?? ""}</p>
        </div>
      </div>
      {abierta && (
        <div className="alert error">
          Este vehículo ya tiene abierta la <Link href={`/ordenes/${abierta.id}`}>OT {abierta.folio}</Link>. Revisa que no estés duplicando la orden.
        </div>
      )}
      <section className="panel">
        <FormSimple accion={abrirOrden} textoBoton="Abrir orden de trabajo" limpiar={false}>
          <input type="hidden" name="vehiculo_id" value={v.id} />
          {cita && <input type="hidden" name="cita_id" value={cita.id} />}
          <div className="fields">
            <div className="field">
              <label htmlFor="o-km">Kilometraje</label>
              <input id="o-km" name="kilometraje_ingreso" inputMode="numeric" placeholder={v.kilometraje_actual != null ? `Último: ${v.kilometraje_actual.toLocaleString("es-PE")}` : "Ej. 45200"} />
            </div>
            <div className="field">
              <label htmlFor="o-comb">Combustible</label>
              <select id="o-comb" name="nivel_combustible" defaultValue="">
                <option value="">Sin registrar</option>
                <option value="0">Reserva</option>
                <option value="25">1/4</option>
                <option value="50">1/2</option>
                <option value="75">3/4</option>
                <option value="100">Lleno</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="o-serv">Servicio</label>
              <select id="o-serv" name="servicio_id" defaultValue={cita?.servicio_id ?? ""}>
                <option value="">Por diagnosticar</option>
                {(servicios ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre} · {dinero(s.precio_base, s.moneda)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="o-mon">Se cobra en</label>
              <select id="o-mon" name="moneda" defaultValue="PEN">
                {Object.entries(MONEDAS).map(([m, t]) => <option key={m} value={m}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="o-tec">Técnico</label>
              <select id="o-tec" name="tecnico_id" defaultValue={cita?.tecnico_id ?? ""}>
                <option value="">Sin asignar</option>
                {(tecnicos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="o-bahia">Bahía</label>
              <select id="o-bahia" name="bahia_id" defaultValue={cita?.bahia_id ?? ""}>
                <option value="">Sin asignar</option>
                {(bahias ?? []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </div>
            <div className="field wide">
              <label htmlFor="o-diag">Lo que reporta el cliente</label>
              <textarea id="o-diag" name="diagnostico" defaultValue={cita?.motivo_cliente ?? ""} placeholder="Ruido al frenar, testigo de check engine…" />
            </div>
          </div>
          <fieldset className="checks" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Inventario de recepción (marca lo que se revisó o trae)</legend>
            {CHECKLIST_RECEPCION.map((c) => (
              <label key={c} className="row" style={{ gap: 6, fontWeight: 400 }}>
                <input type="checkbox" name="checklist" value={c} /> {c}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="o-obs">Observaciones de la carrocería</label>
            <textarea id="o-obs" name="observaciones" placeholder="Rayón en puerta trasera derecha" />
          </div>
        </FormSimple>
      </section>
    </>
  );
}
