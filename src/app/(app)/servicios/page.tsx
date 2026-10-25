import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { MONEDAS, type Moneda } from "@/lib/tipos";
import { dinero, fechaLocal } from "@/lib/fechas";
import FormSimple from "@/components/FormSimple";
import { guardarServicio, guardarTipoCambio } from "./actions";

export const metadata: Metadata = { title: "Servicios" };

type Serv = {
  id: string; codigo: string | null; nombre: string; descripcion: string | null; precio_base: number; moneda: Moneda; horas_estandar: number;
  tipo_bahia_requerida: string | null; intervalo_recordatorio_dias: number | null; intervalo_recordatorio_km: number | null; activo: boolean;
  categorias_servicio: { nombre: string } | null;
};

export default async function ServiciosPage() {
  const perfil = await requierePerfil(["admin", "gerente", "recepcion"]);
  const edita = perfil.rol !== "recepcion";
  const sucursal = await sucursalActiva(perfil);
  const supabase = await createClient();
  const hoy = fechaLocal(new Date(), sucursal?.zona_horaria ?? "America/Lima");
  const [{ data }, { data: categorias }, { data: bahias }, { data: tcs }] = await Promise.all([
    supabase.from("servicios").select("id, codigo, nombre, descripcion, precio_base, moneda, horas_estandar, tipo_bahia_requerida, intervalo_recordatorio_dias, intervalo_recordatorio_km, activo, categorias_servicio(nombre)").order("activo", { ascending: false }).order("nombre"),
    supabase.from("categorias_servicio").select("nombre").order("nombre"),
    supabase.from("bahias").select("tipo").eq("activa", true),
    supabase.from("tipos_cambio").select("fecha, usd_pen").order("fecha", { ascending: false }).limit(7),
  ]);
  const servicios = (data as unknown as Serv[]) ?? [];
  const tiposBahia = [...new Set((bahias ?? []).map((b) => b.tipo as string))].sort();
  const tc = (tcs as { fecha: string; usd_pen: number }[]) ?? [];
  const vigente = tc[0];

  const campos = (s?: Serv) => {
    const k = s?.id ?? "nuevo";
    return (
      <>
        {s && <input type="hidden" name="id" value={s.id} />}
        <div className="fields">
          <div className="field wide"><label htmlFor={`sv-n-${k}`}>Nombre</label><input id={`sv-n-${k}`} name="nombre" required defaultValue={s?.nombre ?? ""} placeholder="Cambio de aceite y filtro" /></div>
          <div className="field">
            <label htmlFor={`sv-c-${k}`}>Tipo de trabajo</label>
            <input id={`sv-c-${k}`} name="categoria" list="l-cat" required defaultValue={s?.categorias_servicio?.nombre ?? ""} placeholder="Mantenimiento" />
          </div>
          <div className="field"><label htmlFor={`sv-p-${k}`}>Precio</label><input id={`sv-p-${k}`} name="precio_base" inputMode="decimal" required defaultValue={s?.precio_base ?? ""} placeholder="120.00" /></div>
          <div className="field">
            <label htmlFor={`sv-m-${k}`}>Moneda</label>
            <select id={`sv-m-${k}`} name="moneda" defaultValue={s?.moneda ?? "PEN"}>
              {Object.entries(MONEDAS).map(([m, t]) => <option key={m} value={m}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor={`sv-h-${k}`}>Duración (horas)</label><input id={`sv-h-${k}`} name="horas_estandar" inputMode="decimal" required defaultValue={s?.horas_estandar ?? "1"} /></div>
          <div className="field">
            <label htmlFor={`sv-b-${k}`}>Bahía que necesita</label>
            <select id={`sv-b-${k}`} name="tipo_bahia_requerida" defaultValue={s?.tipo_bahia_requerida ?? ""}>
              <option value="">Cualquiera</option>
              {tiposBahia.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor={`sv-d-${k}`}>Recordar a los (días)</label><input id={`sv-d-${k}`} name="intervalo_recordatorio_dias" inputMode="numeric" defaultValue={s?.intervalo_recordatorio_dias ?? ""} placeholder="180" /></div>
          <div className="field"><label htmlFor={`sv-k-${k}`}>o a los (km)</label><input id={`sv-k-${k}`} name="intervalo_recordatorio_km" inputMode="numeric" defaultValue={s?.intervalo_recordatorio_km ?? ""} placeholder="5000" /></div>
          <div className="field"><label htmlFor={`sv-cod-${k}`}>Código</label><input id={`sv-cod-${k}`} name="codigo" defaultValue={s?.codigo ?? ""} placeholder="MNT-ACE" /></div>
          {s && <label className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="activo" defaultChecked={s.activo} /> Activo</label>}
        </div>
      </>
    );
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Servicios y precios</h1>
          <p className="sub">Catálogo que usan la agenda y las órdenes de trabajo. El recordatorio se programa solo al entregar el servicio.</p>
        </div>
      </div>
      <datalist id="l-cat">{(categorias ?? []).map((c) => <option key={c.nombre} value={c.nombre} />)}</datalist>

      <section className="panel">
        <h2>Tipo de cambio</h2>
        <p style={{ margin: 0 }}>
          {vigente ? <>Vigente: <b className="num">1 US$ = S/ {Number(vigente.usd_pen).toFixed(3)}</b> <span className="muted">desde el {vigente.fecha}</span></> : <span style={{ color: "var(--warn)" }}>Aún no hay tipo de cambio. Regístralo para poder abrir órdenes o pedidos en dólares.</span>}
        </p>
        <FormSimple accion={guardarTipoCambio} textoBoton="Guardar tipo de cambio">
          <div className="fields">
            <div className="field"><label htmlFor="tc-f">Fecha</label><input id="tc-f" name="fecha" type="date" defaultValue={hoy} required /></div>
            <div className="field"><label htmlFor="tc-v">Soles por 1 dólar</label><input id="tc-v" name="usd_pen" inputMode="decimal" required placeholder="3.750" /></div>
          </div>
        </FormSimple>
        {tc.length > 1 && <p className="muted" style={{ fontSize: 13 }}>Anteriores: {tc.slice(1).map((t) => `${t.fecha} ${Number(t.usd_pen).toFixed(3)}`).join(" · ")}</p>}
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Catálogo <span className="muted mono" style={{ fontSize: 13 }}>{servicios.filter((s) => s.activo).length}</span></h2>
          <ul className="list">
            {servicios.map((s) => (
              <li key={s.id} style={{ opacity: s.activo ? 1 : 0.55 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="row"><b>{s.nombre}</b>{s.categorias_servicio && <span className="chip">{s.categorias_servicio.nombre}</span>}{!s.activo && <span className="chip cancelada">Inactivo</span>}</span>
                  <b className="num">{dinero(s.precio_base, s.moneda)}</b>
                </div>
                <div className="meta">
                  <span>{Number(s.horas_estandar)} h</span>
                  {s.tipo_bahia_requerida && <span>bahía {s.tipo_bahia_requerida}</span>}
                  {(s.intervalo_recordatorio_dias || s.intervalo_recordatorio_km) && (
                    <span>recordar {[s.intervalo_recordatorio_dias && `a los ${s.intervalo_recordatorio_dias} días`, s.intervalo_recordatorio_km && `a los ${s.intervalo_recordatorio_km.toLocaleString("es-PE")} km`].filter(Boolean).join(" o ")}</span>
                  )}
                  {s.codigo && <span className="mono">{s.codigo}</span>}
                </div>
                {edita && (
                  <details>
                    <summary className="btn small">Editar</summary>
                    <div style={{ marginTop: 10 }}>
                      <FormSimple accion={guardarServicio} textoBoton="Guardar" limpiar={false}>{campos(s)}</FormSimple>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
        {edita && (
          <section className="panel">
            <h2>Nuevo servicio</h2>
            <FormSimple accion={guardarServicio} textoBoton="Agregar servicio">{campos()}</FormSimple>
          </section>
        )}
      </div>
    </>
  );
}
