import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { dinero, fechaLocal, localAInstante, sumarDias } from "@/lib/fechas";
import FiltrosAuto from "@/components/FiltrosAuto";

export const metadata: Metadata = { title: "Reportes" };

const PERIODOS: [string, string][] = [["mes", "Este mes"], ["mes_ant", "Mes pasado"], ["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["anio", "Este año"]];

type OT = {
  orden_id: string; cliente_id: string; ingreso_total: number; ingreso_mano_obra: number; ingreso_piezas: number; costo_mano_obra: number; costo_piezas: number;
  horas_reales: number; recibido_en: string; iniciado_en: string | null; terminado_en: string | null; entregado_en: string;
};
type Trabajo = {
  precio: number; horas_cobradas: number; tecnico_id: string | null;
  categorias_servicio: { nombre: string } | null; tecnico: { nombre: string } | null;
  registros_tiempo: { horas: number | null; costo_hora: number }[];
  orden_piezas: { cantidad: number; precio_unitario: number; costo_unitario: number }[];
};

function rango(periodo: string, hoy: string): [string, string] {
  const [y, m] = hoy.split("-").map(Number);
  const iniMes = (yy: number, mm: number) => `${yy + Math.floor((mm - 1) / 12)}-${String(((mm - 1) % 12 + 12) % 12 + 1).padStart(2, "0")}-01`;
  switch (periodo) {
    case "mes_ant": return [iniMes(y, m - 1), iniMes(y, m)];
    case "30": return [sumarDias(hoy, -29), sumarDias(hoy, 1)];
    case "90": return [sumarDias(hoy, -89), sumarDias(hoy, 1)];
    case "anio": return [`${y}-01-01`, sumarDias(hoy, 1)];
    default: return [iniMes(y, m), sumarDias(hoy, 1)];
  }
}
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const horasEntre = (a: string | null, b: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 3600000 : null);
const prom = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pct = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);

function Delta({ actual, anterior, inverso = false }: { actual: number; anterior: number; inverso?: boolean }) {
  if (!anterior) return <small className="muted">sin datos del periodo anterior</small>;
  const d = ((actual - anterior) / Math.abs(anterior)) * 100;
  const bueno = inverso ? d < 0 : d > 0;
  return <small style={{ color: Math.abs(d) < 0.5 ? "var(--muted)" : bueno ? "var(--ok)" : "var(--bad)" }}>{d > 0 ? "▲" : d < 0 ? "▼" : "="} {Math.abs(d).toFixed(0)}% vs periodo anterior</small>;
}

// Barras horizontales de una sola serie (magnitud): un tono, valor escrito al lado
function Barras({ filas, formato }: { filas: { etiqueta: string; valor: number; detalle?: string }[]; formato: (n: number) => string }) {
  const max = Math.max(...filas.map((f) => f.valor), 0) || 1;
  return (
    <div className="barras">
      {filas.map((f) => (
        <div key={f.etiqueta} className="barra" title={`${f.etiqueta}: ${formato(f.valor)}${f.detalle ? ` · ${f.detalle}` : ""}`}>
          <span className="et">{f.etiqueta}</span>
          <span className="pista"><span style={{ width: `${Math.max(0, (f.valor / max) * 100)}%` }} /></span>
          <span className="val num">{formato(f.valor)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ periodo?: string; sucursal?: string }> }) {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const tz = sucursal.zona_horaria;
  const periodo = PERIODOS.some(([k]) => k === sp.periodo) ? sp.periodo! : "mes";
  const hoy = fechaLocal(new Date(), tz);
  const [desde, hasta] = rango(periodo, hoy);
  const largo = dias(desde, hasta);
  const [antDesde, antHasta] = [sumarDias(desde, -largo), desde];
  const I = (f: string) => localAInstante(f, "00:00", tz).toISOString();
  const supabase = await createClient();

  const selOT = "orden_id, cliente_id, ingreso_total, ingreso_mano_obra, ingreso_piezas, costo_mano_obra, costo_piezas, horas_reales, recibido_en, iniciado_en, terminado_en, entregado_en";
  const [{ data: otData }, { data: antData }, { data: retencion }, { data: rotacion }, { data: citas }, { count: abiertas }] = await Promise.all([
    supabase.from("v_orden_totales").select(selOT).eq("sucursal_id", sucursal.id).eq("estado", "entregada").gte("entregado_en", I(desde)).lt("entregado_en", I(hasta)).limit(5000),
    supabase.from("v_orden_totales").select("ingreso_total, costo_mano_obra, costo_piezas").eq("sucursal_id", sucursal.id).eq("estado", "entregada").gte("entregado_en", I(antDesde)).lt("entregado_en", I(antHasta)).limit(5000),
    supabase.from("v_retencion_clientes").select("*").maybeSingle(),
    supabase.from("v_rotacion_inventario").select("articulo_id, sku, nombre, stock_actual, valor_inventario, unidades_consumidas_12m, rotacion, dias_de_inventario"),
    supabase.from("citas").select("estado").eq("sucursal_id", sucursal.id).gte("inicio", I(desde)).lt("inicio", I(hasta)).lt("inicio", new Date().toISOString()),
    supabase.from("ordenes_trabajo").select("id", { count: "exact", head: true }).eq("sucursal_id", sucursal.id).not("estado", "in", "(entregada,cancelada)"),
  ]);
  const ots = (otData as OT[]) ?? [];
  const ants = (antData as { ingreso_total: number; costo_mano_obra: number; costo_piezas: number }[]) ?? [];
  const n = (x: unknown) => Number(x ?? 0);
  const ingreso = ots.reduce((s, o) => s + n(o.ingreso_total), 0);
  const costo = ots.reduce((s, o) => s + n(o.costo_mano_obra) + n(o.costo_piezas), 0);
  const ingresoAnt = ants.reduce((s, o) => s + n(o.ingreso_total), 0);
  const utilAnt = ingresoAnt - ants.reduce((s, o) => s + n(o.costo_mano_obra) + n(o.costo_piezas), 0);
  const ticket = ots.length ? ingreso / ots.length : 0;
  const ticketAnt = ants.length ? ingresoAnt / ants.length : 0;

  // Trabajos de las órdenes del periodo: rentabilidad por tipo y productividad por técnico
  const ids = ots.map((o) => o.orden_id);
  const trabajos: Trabajo[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from("orden_servicios")
      .select("precio, horas_cobradas, tecnico_id, categorias_servicio(nombre), tecnico:perfiles(nombre), registros_tiempo(horas, costo_hora), orden_piezas(cantidad, precio_unitario, costo_unitario)")
      .in("orden_id", ids.slice(i, i + 300));
    trabajos.push(...((data as unknown as Trabajo[]) ?? []));
  }
  const porCat = new Map<string, { ingreso: number; costo: number; trabajos: number }>();
  const porTec = new Map<string, { nombre: string; cobradas: number; reales: number; ingreso: number; trabajos: number }>();
  for (const t of trabajos) {
    const piezasV = t.orden_piezas.reduce((s, p) => s + n(p.cantidad) * n(p.precio_unitario), 0);
    const piezasC = t.orden_piezas.reduce((s, p) => s + n(p.cantidad) * n(p.costo_unitario), 0);
    const horas = t.registros_tiempo.reduce((s, r) => s + n(r.horas), 0);
    const moC = t.registros_tiempo.reduce((s, r) => s + n(r.horas) * n(r.costo_hora), 0);
    const cat = t.categorias_servicio?.nombre ?? "Otro";
    const c = porCat.get(cat) ?? { ingreso: 0, costo: 0, trabajos: 0 };
    c.ingreso += n(t.precio) + piezasV; c.costo += moC + piezasC; c.trabajos++;
    porCat.set(cat, c);
    if (t.tecnico_id) {
      const k = porTec.get(t.tecnico_id) ?? { nombre: t.tecnico?.nombre ?? "—", cobradas: 0, reales: 0, ingreso: 0, trabajos: 0 };
      k.cobradas += n(t.horas_cobradas); k.reales += horas; k.ingreso += n(t.precio); k.trabajos++;
      porTec.set(t.tecnico_id, k);
    }
  }
  const categorias = [...porCat.entries()].map(([nombre, v]) => ({ nombre, ...v, margen: v.ingreso - v.costo })).sort((a, b) => b.margen - a.margen);
  const tecnicos = [...porTec.values()].sort((a, b) => b.ingreso - a.ingreso);

  // Ingreso por día (o por mes si el periodo es el año)
  const porMes = periodo === "anio";
  const cubetas = new Map<string, number>();
  if (porMes) for (let m = 1; m <= Number(hoy.slice(5, 7)); m++) cubetas.set(`${hoy.slice(0, 4)}-${String(m).padStart(2, "0")}`, 0);
  else for (let d = desde; d < hasta; d = sumarDias(d, 1)) cubetas.set(d, 0);
  for (const o of ots) {
    const f = fechaLocal(new Date(o.entregado_en), tz);
    const k = porMes ? f.slice(0, 7) : f;
    cubetas.set(k, (cubetas.get(k) ?? 0) + n(o.ingreso_total));
  }
  const serie = [...cubetas.entries()];
  const maxSerie = Math.max(...serie.map(([, v]) => v), 1);

  // Clientes con más gasto en el periodo
  const gastoCli = new Map<string, { total: number; visitas: number }>();
  for (const o of ots) {
    const g = gastoCli.get(o.cliente_id) ?? { total: 0, visitas: 0 };
    g.total += n(o.ingreso_total); g.visitas++;
    gastoCli.set(o.cliente_id, g);
  }
  const top = [...gastoCli.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const { data: nombres } = top.length ? await supabase.from("clientes").select("id, nombre, apellidos").in("id", top.map(([id]) => id)) : { data: [] };
  const nombre = new Map(((nombres as { id: string; nombre: string; apellidos: string | null }[]) ?? []).map((c) => [c.id, `${c.nombre} ${c.apellidos ?? ""}`.trim()]));

  const estadia = prom(ots.map((o) => horasEntre(o.recibido_en, o.entregado_en)));
  const proceso = prom(ots.map((o) => horasEntre(o.iniciado_en, o.terminado_en)));
  const cs = (citas as { estado: string }[]) ?? [];
  const noAsistio = cs.filter((c) => c.estado === "no_asistio").length;
  const ret = retencion as { clientes_periodo_anterior: number; retenidos: number; tasa_retencion_pct: number | null; clientes_nuevos_o_recuperados: number } | null;
  const rot = ((rotacion as { articulo_id: string; sku: string; nombre: string; stock_actual: number; valor_inventario: number; unidades_consumidas_12m: number; rotacion: number | null; dias_de_inventario: number | null }[]) ?? []);
  const valorInv = rot.reduce((s, r) => s + n(r.valor_inventario), 0);
  const parados = rot.filter((r) => n(r.stock_actual) > 0 && n(r.unidades_consumidas_12m) === 0).sort((a, b) => n(b.valor_inventario) - n(a.valor_inventario));
  const masRotan = rot.filter((r) => n(r.unidades_consumidas_12m) > 0).sort((a, b) => n(b.unidades_consumidas_12m) - n(a.unidades_consumidas_12m)).slice(0, 8);
  const etiquetaPeriodo = PERIODOS.find(([k]) => k === periodo)?.[1];

  return (
    <>
      <div className="head">
        <div>
          <h1>Reportes</h1>
          <p className="sub">{sucursal.nombre} · {etiquetaPeriodo} ({desde} a {sumarDias(hasta, -1)}) · órdenes entregadas</p>
        </div>
      </div>

      <FiltrosAuto valores={{ periodo }} campos={[{ nombre: "periodo", etiqueta: "Periodo", tipo: "select", opciones: PERIODOS }]} />

      <div className="stats">
        <div className="stat"><b>{dinero(ingreso)}</b><span>Ingresos</span><Delta actual={ingreso} anterior={ingresoAnt} /></div>
        <div className="stat"><b>{dinero(ingreso - costo)}</b><span>Utilidad bruta · margen {pct(ingreso ? ((ingreso - costo) / ingreso) * 100 : null)}</span><Delta actual={ingreso - costo} anterior={utilAnt} /></div>
        <div className="stat"><b>{ots.length}</b><span>Órdenes entregadas · {abiertas ?? 0} en el taller ahora</span><Delta actual={ots.length} anterior={ants.length} /></div>
        <div className="stat"><b>{dinero(ticket)}</b><span>Ticket promedio</span><Delta actual={ticket} anterior={ticketAnt} /></div>
      </div>

      <section className="panel">
        <h2>Ingresos por {porMes ? "mes" : "día"}</h2>
        {ingreso === 0 ? (
          <div className="empty">No hay órdenes entregadas en este periodo.</div>
        ) : (
          <div className="columnas" role="img" aria-label={`Ingresos por ${porMes ? "mes" : "día"}`}>
            {serie.map(([k, v], i) => (
              <div key={k} className="col" title={`${k}: ${dinero(v)}`}>
                <span className="area"><span className="barra-v" style={{ height: `${(v / maxSerie) * 100}%` }} /></span>
                <span className="et">{serie.length <= 16 || i % 5 === 0 ? (porMes ? k.slice(5) : k.slice(8)) : "\u00a0"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Utilidad por tipo de servicio</h2>
          {categorias.length === 0 ? <div className="empty">Sin trabajos en el periodo.</div> : (
            <>
              <Barras formato={dinero} filas={categorias.map((c) => ({ etiqueta: c.nombre, valor: c.margen, detalle: `${c.trabajos} trabajos, ingreso ${dinero(c.ingreso)}` }))} />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Tipo</th><th>Trabajos</th><th>Ingreso</th><th>Costo</th><th>Margen</th></tr></thead>
                  <tbody>
                    {categorias.map((c) => (
                      <tr key={c.nombre}><td>{c.nombre}</td><td className="num">{c.trabajos}</td><td className="num">{dinero(c.ingreso)}</td><td className="num">{dinero(c.costo)}</td><td className="num">{pct(c.ingreso ? (c.margen / c.ingreso) * 100 : null)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="muted" style={{ fontSize: 13 }}>Costo = piezas a costo promedio + horas reales × costo por hora del técnico.</p>
        </section>

        <section className="panel">
          <h2>Tiempos y agenda</h2>
          <dl className="totales">
            <dt>Estadía promedio en el taller</dt><dd>{estadia == null ? "—" : estadia < 48 ? `${estadia.toFixed(1)} h` : `${(estadia / 24).toFixed(1)} días`}</dd>
            <dt>Tiempo en proceso promedio</dt><dd>{proceso == null ? "—" : `${proceso.toFixed(1)} h`}</dd>
            <dt>Citas en el periodo</dt><dd>{cs.length}</dd>
            <dt>No asistieron</dt><dd>{noAsistio} · {pct(cs.length ? (noAsistio / cs.length) * 100 : null)}</dd>
          </dl>
          <h3>Técnicos</h3>
          {tecnicos.length === 0 ? <p className="muted">Sin trabajos asignados en el periodo.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Técnico</th><th>Trabajos</th><th>Horas cobradas</th><th>Horas reales</th><th>Eficiencia</th></tr></thead>
                <tbody>
                  {tecnicos.map((t) => (
                    <tr key={t.nombre}><td>{t.nombre}</td><td className="num">{t.trabajos}</td><td className="num">{t.cobradas.toFixed(1)}</td><td className="num">{t.reales.toFixed(1)}</td><td className="num">{t.reales ? pct((t.cobradas / t.reales) * 100) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: 13 }}>Eficiencia = horas cobradas ÷ horas reales del reloj. Arriba de 100% el técnico termina antes del tiempo estándar.</p>
        </section>
      </div>

      <div className="grid2">
        <section className="panel">
          <h2>Clientes</h2>
          <dl className="totales">
            <dt>Retención (vinieron el año anterior y volvieron)</dt><dd>{ret?.clientes_periodo_anterior ? `${pct(ret.tasa_retencion_pct)} · ${ret.retenidos} de ${ret.clientes_periodo_anterior}` : "Aún sin historia suficiente"}</dd>
            <dt>Nuevos o recuperados (12 meses)</dt><dd>{ret?.clientes_nuevos_o_recuperados ?? 0}</dd>
            <dt>Clientes atendidos en el periodo</dt><dd>{gastoCli.size}</dd>
            <dt>Ingreso por cliente</dt><dd>{dinero(gastoCli.size ? ingreso / gastoCli.size : 0)}</dd>
          </dl>
          {top.length > 0 && (
            <>
              <h3>Los que más gastaron</h3>
              <Barras formato={dinero} filas={top.map(([id, g]) => ({ etiqueta: nombre.get(id) ?? "Cliente", valor: g.total, detalle: `${g.visitas} visitas` }))} />
            </>
          )}
        </section>

        <section className="panel">
          <h2>Inventario</h2>
          <dl className="totales">
            <dt>Valor del inventario (a costo)</dt><dd>{dinero(valorInv)}</dd>
            <dt>Artículos sin consumo en 12 meses</dt><dd>{parados.length} · {dinero(parados.reduce((s, r) => s + n(r.valor_inventario), 0))}</dd>
          </dl>
          <h3>Los que más rotan (12 meses)</h3>
          {masRotan.length === 0 ? <p className="muted">Aún no hay consumo registrado en órdenes.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Artículo</th><th>Consumo</th><th>Existencia</th><th>Rotación</th><th>Días de inventario</th></tr></thead>
                <tbody>
                  {masRotan.map((r) => (
                    <tr key={r.articulo_id}><td><Link href={`/inventario/${r.articulo_id}`}>{r.nombre}</Link></td><td className="num">{n(r.unidades_consumidas_12m)}</td><td className="num">{n(r.stock_actual)}</td><td className="num">{r.rotacion ?? "—"}</td><td className="num">{r.dias_de_inventario ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {parados.length > 0 && (
            <>
              <h3>Inventario parado</h3>
              <ul className="list">
                {parados.slice(0, 6).map((r) => (
                  <li key={r.articulo_id}><div className="row" style={{ justifyContent: "space-between" }}><Link href={`/inventario/${r.articulo_id}`}>{r.nombre}</Link><span className="num">{dinero(r.valor_inventario)}</span></div></li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
