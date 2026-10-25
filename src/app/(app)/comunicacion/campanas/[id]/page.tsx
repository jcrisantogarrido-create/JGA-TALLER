import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { enlaceMensaje, rellenar } from "@/lib/mensajes";
import BotonEnvio from "@/components/BotonEnvio";
import { cerrarCampana } from "../../actions";

export const metadata: Metadata = { title: "Campaña" };

type Cli = { id: string; nombre: string; apellidos: string | null; telefono: string | null; email: string | null; vehiculos: { id: string; placa: string; marca: string; modelo: string; activo: boolean }[] };

export default async function CampanaPage({ params }: { params: Promise<{ id: string }> }) {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const { id } = await params;
  const supabase = await createClient();
  const sucursal = await sucursalActiva(perfil);
  const [{ data: camp }, { data: enviados }, { data: suc }] = await Promise.all([
    supabase.from("campanas").select("id, nombre, canal, asunto, plantilla, estado, segmento_id, segmentos(nombre)").eq("id", id).maybeSingle(),
    supabase.from("comunicaciones").select("cliente_id").eq("campana_id", id),
    sucursal ? supabase.from("sucursales").select("prefijo_telefono").eq("id", sucursal.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!camp) notFound();
  const c = camp as unknown as { id: string; nombre: string; canal: "whatsapp" | "sms" | "email"; asunto: string | null; plantilla: string; estado: string; segmento_id: string; segmentos: { nombre: string } | null };
  const { data: miembros } = await supabase.rpc("clientes_en_segmento", { p_segmento: c.segmento_id });
  const ids = ((miembros as { cliente_id: string }[]) ?? []).map((m) => m.cliente_id);
  const { data: clientes } = ids.length
    ? await supabase.from("clientes").select("id, nombre, apellidos, telefono, email, vehiculos(id, placa, marca, modelo, activo)").in("id", ids).order("nombre")
    : { data: [] };
  const cs = (clientes as Cli[]) ?? [];
  const ya = new Set(((enviados as { cliente_id: string }[]) ?? []).map((e) => e.cliente_id));
  const prefijo = (suc as { prefijo_telefono: string } | null)?.prefijo_telefono ?? "52";
  const abierta = c.estado === "enviando" || c.estado === "borrador";
  const correos = cs.filter((x) => x.email).map((x) => x.email).join(", ");

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/comunicacion">Mensajes</Link> / <Link href="/comunicacion/segmentos">Segmentos</Link> /</p>
          <h1>{c.nombre}</h1>
          <p className="sub">{c.segmentos?.nombre} · {c.canal === "email" ? "Correo" : c.canal === "sms" ? "SMS" : "WhatsApp"} · {ya.size} de {cs.length} enviados</p>
        </div>
        {abierta ? (
          <form action={cerrarCampana.bind(null, c.id, "enviada")}><button className="btn" type="submit">Terminar campaña</button></form>
        ) : (
          <span className="chip">{c.estado === "enviada" ? "Terminada" : c.estado}</span>
        )}
      </div>

      <section className="panel">
        <h2>Mensaje</h2>
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.plantilla}</p>
      </section>

      <section className="panel">
        <h2>Destinatarios</h2>
        <p className="muted" style={{ fontSize: 13 }}>Pulsa cada botón: se abre {c.canal === "email" ? "tu correo" : "WhatsApp"} con el mensaje personalizado y queda registrado como enviado.</p>
        <ul className="list">
          {cs.map((x) => {
            const v = x.vehiculos.find((y) => y.activo);
            const texto = rellenar(c.plantilla, { nombre: x.nombre, placa: v?.placa, vehiculo: v ? `${v.marca} ${v.modelo}` : "vehículo" });
            return (
              <li key={x.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="row">
                    <Link href={`/clientes/${x.id}`}><b>{x.nombre} {x.apellidos ?? ""}</b></Link>
                    {v && <span className="placa">{v.placa}</span>}
                    <span className="muted num" style={{ fontSize: 13 }}>{c.canal === "email" ? x.email : x.telefono}</span>
                  </span>
                  {ya.has(x.id) ? (
                    <span className="chip terminada">Enviado</span>
                  ) : abierta ? (
                    <BotonEnvio
                      enlace={enlaceMensaje(c.canal, x, prefijo, texto, c.asunto ? rellenar(c.asunto, {}) : null)}
                      envio={{ cliente_id: x.id, vehiculo_id: v?.id ?? null, campana_id: c.id, canal: c.canal, asunto: c.nombre, contenido: texto }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {c.canal === "email" && correos && (
          <div className="field">
            <label htmlFor="bcc">Todos los correos (para pegar en copia oculta)</label>
            <textarea id="bcc" readOnly rows={3} defaultValue={correos} />
          </div>
        )}
      </section>
    </>
  );
}
