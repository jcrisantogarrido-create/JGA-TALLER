import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil } from "@/lib/sesion";
import FormSimple from "@/components/FormSimple";
import CamposSegmento, { describirReglas, type Reglas } from "@/components/CamposSegmento";
import { guardarSegmento } from "../actions";

export const metadata: Metadata = { title: "Segmentos" };

export default async function SegmentosPage() {
  await requierePerfil(["admin", "gerente"]);
  const supabase = await createClient();
  const [{ data }, { data: categorias }, { data: campanas }] = await Promise.all([
    supabase.from("segmentos").select("id, nombre, descripcion, reglas").order("nombre"),
    supabase.from("categorias_servicio").select("nombre").order("nombre"),
    supabase.from("campanas").select("id, nombre, canal, estado, created_at, segmentos(nombre), comunicaciones(count)").order("created_at", { ascending: false }).limit(20),
  ]);
  const segs = (data as { id: string; nombre: string; descripcion: string | null; reglas: Reglas }[]) ?? [];
  const conteos = await Promise.all(segs.map((s) => supabase.rpc("contar_segmento", { p_segmento: s.id }).then((r) => Number(r.data ?? 0))));
  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/comunicacion">Mensajes</Link> /</p>
          <h1>Segmentos y campañas</h1>
          <p className="sub">Agrupa clientes por visitas, gasto, vehículo o servicios para mandarles una campaña.</p>
        </div>
      </div>
      <div className="grid2">
        <section className="panel">
          <h2>Segmentos</h2>
          {segs.length === 0 ? (
            <div className="empty">Aún no hay segmentos. Crea el primero a la derecha (por ejemplo, “Clientes que no vienen hace 6 meses”).</div>
          ) : (
            <ul className="list">
              {segs.map((s, i) => (
                <li key={s.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Link href={`/comunicacion/segmentos/${s.id}`}><b>{s.nombre}</b></Link>
                    <span className="num">{conteos[i]} clientes</span>
                  </div>
                  <div className="meta"><span>{describirReglas(s.reglas)}</span></div>
                </li>
              ))}
            </ul>
          )}
          <h3>Campañas recientes</h3>
          {(campanas ?? []).length === 0 ? (
            <p className="muted">Ninguna todavía.</p>
          ) : (
            <ul className="list">
              {(campanas as unknown as { id: string; nombre: string; canal: string; estado: string; segmentos: { nombre: string } | null; comunicaciones: { count: number }[] }[]).map((c) => (
                <li key={c.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Link href={`/comunicacion/campanas/${c.id}`}>{c.nombre}</Link>
                    <span className="muted" style={{ fontSize: 13 }}>{c.segmentos?.nombre} · {c.comunicaciones[0]?.count ?? 0} enviados · {c.estado}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Nuevo segmento</h2>
          <FormSimple accion={guardarSegmento} textoBoton="Crear segmento" limpiar={false}>
            <CamposSegmento categorias={(categorias ?? []).map((c) => c.nombre)} />
          </FormSimple>
        </section>
      </div>
    </>
  );
}
