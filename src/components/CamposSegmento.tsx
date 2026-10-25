import { TIPOS_VEHICULO } from "@/lib/tipos";

export type Reglas = {
  dias_sin_visita_min?: number; dias_sin_visita_max?: number; gasto_min?: number; gasto_max?: number; visitas_min?: number;
  tipos_vehiculo?: string[]; marcas?: string[]; categorias?: string[]; solo_marketing?: boolean;
};

export function describirReglas(r: Reglas): string {
  const p: string[] = [];
  if (r.dias_sin_visita_min != null) p.push(`sin venir hace ${r.dias_sin_visita_min}+ días`);
  if (r.dias_sin_visita_max != null) p.push(`vino en los últimos ${r.dias_sin_visita_max} días`);
  if (r.visitas_min != null) p.push(`${r.visitas_min}+ visitas`);
  if (r.gasto_min != null) p.push(`gasto desde $${r.gasto_min.toLocaleString("es-MX")}`);
  if (r.gasto_max != null) p.push(`gasto hasta $${r.gasto_max.toLocaleString("es-MX")}`);
  if (r.tipos_vehiculo?.length) p.push(r.tipos_vehiculo.map((t) => TIPOS_VEHICULO[t as keyof typeof TIPOS_VEHICULO] ?? t).join("/"));
  if (r.marcas?.length) p.push(r.marcas.join("/"));
  if (r.categorias?.length) p.push(`usó ${r.categorias.join("/")}`);
  if (r.solo_marketing) p.push("acepta promociones");
  return p.join(" · ") || "Todos los clientes activos";
}

// Reglas del segmento; todas son opcionales y se combinan (deben cumplirse todas)
export default function CamposSegmento({ categorias, inicial }: { categorias: string[]; inicial?: { id: string; nombre: string; descripcion: string | null; reglas: Reglas } }) {
  const r = inicial?.reglas ?? { solo_marketing: true };
  const n = (v: number | undefined) => (v == null ? "" : String(v));
  return (
    <>
      {inicial && <input type="hidden" name="id" value={inicial.id} />}
      <div className="fields">
        <div className="field wide"><label htmlFor="sg-n">Nombre</label><input id="sg-n" name="nombre" required defaultValue={inicial?.nombre ?? ""} placeholder="No vienen hace 6 meses" /></div>
        <div className="field"><label htmlFor="sg-dmin">Sin venir desde (días)</label><input id="sg-dmin" name="dias_sin_visita_min" inputMode="numeric" defaultValue={n(r.dias_sin_visita_min)} placeholder="180" /></div>
        <div className="field"><label htmlFor="sg-dmax">Vino en los últimos (días)</label><input id="sg-dmax" name="dias_sin_visita_max" inputMode="numeric" defaultValue={n(r.dias_sin_visita_max)} /></div>
        <div className="field"><label htmlFor="sg-vmin">Visitas mínimas</label><input id="sg-vmin" name="visitas_min" inputMode="numeric" defaultValue={n(r.visitas_min)} /></div>
        <div className="field"><label htmlFor="sg-gmin">Gasto mínimo</label><input id="sg-gmin" name="gasto_min" inputMode="decimal" defaultValue={n(r.gasto_min)} /></div>
        <div className="field"><label htmlFor="sg-gmax">Gasto máximo</label><input id="sg-gmax" name="gasto_max" inputMode="decimal" defaultValue={n(r.gasto_max)} /></div>
        <div className="field"><label htmlFor="sg-mar">Marcas (separadas por coma)</label><input id="sg-mar" name="marcas" defaultValue={r.marcas?.join(", ") ?? ""} placeholder="Toyota, Nissan" /></div>
      </div>
      <fieldset className="checks" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Tipo de vehículo</legend>
        {Object.entries(TIPOS_VEHICULO).map(([k, t]) => (
          <label key={k} className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="tipos_vehiculo" value={k} defaultChecked={r.tipos_vehiculo?.includes(k)} /> {t}</label>
        ))}
      </fieldset>
      <fieldset className="checks" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Servicios que ha usado</legend>
        {categorias.map((c) => (
          <label key={c} className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="categorias" value={c} defaultChecked={r.categorias?.includes(c)} /> {c}</label>
        ))}
      </fieldset>
      <label className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="solo_marketing" defaultChecked={r.solo_marketing !== false} /> Solo clientes que aceptan promociones</label>
      <div className="field"><label htmlFor="sg-desc">Notas</label><input id="sg-desc" name="descripcion" defaultValue={inicial?.descripcion ?? ""} /></div>
    </>
  );
}
