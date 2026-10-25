import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil } from "@/lib/sesion";
import { dinero } from "@/lib/fechas";
import FormSimple from "@/components/FormSimple";
import CamposSegmento, { describirReglas, type Reglas } from "@/components/CamposSegmento";
import { crearCampana, eliminarSegmento, guardarSegmento } from "../../actions";

export const metadata: Metadata = { title: "Segmento" };

type Miembro = { cliente_id: string; nombre: string; apellidos: string | null; visitas: number; gasto_total: number; dias_sin_visita: number | null; marcas: string[] | null; puntos: number };

export default async function SegmentoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requierePerfil(["admin", "gerente"]);
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: seg }, { data: miembros }, { data: categorias }, { data: plantilla }] = await Promise.all([
    supabase.from("segmentos").select("id, nombre, descripcion, reglas").eq("id", id).maybeSingle(),
    supabase.rpc("clientes_en_segmento", { p_segmento: id }),
    supabase.from("categorias_servicio").select("nombre").order("nombre"),
    supabase.from("plantillas_mensaje").select("asunto, texto").eq("clave", "campana").maybeSingle(),
  ]);
  if (!seg) notFound();
  const s = seg as { id: string; nombre: string; descripcion: string | null; reglas: Reglas };
  const ms = ((miembros as Miembro[]) ?? []).sort((a, b) => Number(b.gasto_total) - Number(a.gasto_total));

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/comunicacion">Mensajes</Link> / <Link href="/comunicacion/segmentos">Segmentos</Link> /</p>
          <h1>{s.nombre}</h1>
          <p className="sub">{describirReglas(s.reglas)} · {ms.length} clientes</p>
        </div>
      </div>
      {error === "usado" && <div className="alert error">No se puede borrar: ya tiene campañas. Puedes cambiar sus reglas.</div>}

      <div className="grid2">
        <section className="panel">
          <h2>Clientes <span className="muted mono" style={{ fontSize: 13 }}>{ms.length}</span></h2>
          {ms.length === 0 ? (
            <div className="empty">Ningún cliente cumple estas reglas.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Cliente</th><th>Visitas</th><th>Gasto</th><th>Última visita</th><th>Puntos</th></tr></thead>
                <tbody>
                  {ms.map((m) => (
                    <tr key={m.cliente_id}>
                      <td><Link href={`/clientes/${m.cliente_id}`}>{m.nombre} {m.apellidos ?? ""}</Link>{m.marcas?.length ? <div className="muted" style={{ fontSize: 12 }}>{m.marcas.join(", ")}</div> : null}</td>
                      <td className="num">{m.visitas}</td>
                      <td className="num">{dinero(m.gasto_total)}</td>
                      <td className="num">{m.dias_sin_visita != null ? `hace ${m.dias_sin_visita} días` : "—"}</td>
                      <td className="num">{m.puntos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Mandar campaña</h2>
          {ms.length === 0 ? (
            <p className="muted">Cuando el segmento tenga clientes podrás mandarles una campaña.</p>
          ) : (
            <FormSimple accion={crearCampana} textoBoton={`Preparar envío a ${ms.length} clientes`} limpiar={false}>
              <input type="hidden" name="segmento_id" value={s.id} />
              <div className="fields">
                <div className="field wide"><label htmlFor="cp-n">Nombre de la campaña</label><input id="cp-n" name="nombre" required placeholder="Promo lavado noviembre" /></div>
                <div className="field">
                  <label htmlFor="cp-c">Canal</label>
                  <select id="cp-c" name="canal" defaultValue="whatsapp"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Correo</option></select>
                </div>
                <div className="field"><label htmlFor="cp-a">Asunto (correo)</label><input id="cp-a" name="asunto" defaultValue={plantilla?.asunto ?? ""} /></div>
                <div className="field wide"><label htmlFor="cp-t">Mensaje</label><textarea id="cp-t" name="plantilla" rows={5} required defaultValue={plantilla?.texto ?? ""} /></div>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>{"Usa {{nombre}}, {{vehiculo}} y {{placa}} para personalizar."}</p>
            </FormSimple>
          )}
        </section>
      </div>

      <section className="panel">
        <details>
          <summary className="btn small">Cambiar reglas</summary>
          <div style={{ marginTop: 12 }}>
            <FormSimple accion={guardarSegmento} textoBoton="Guardar segmento" limpiar={false}>
              <CamposSegmento categorias={(categorias ?? []).map((c) => c.nombre)} inicial={s} />
            </FormSimple>
            <form action={eliminarSegmento.bind(null, s.id)} style={{ marginTop: 8 }}>
              <button className="btn small danger" type="submit">Borrar segmento</button>
            </form>
          </div>
        </details>
      </section>
    </>
  );
}
