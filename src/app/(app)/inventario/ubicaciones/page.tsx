import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import FormSimple from "@/components/FormSimple";
import { alternarUbicacion, guardarUbicacion } from "../actions";

export const metadata: Metadata = { title: "Ubicaciones" };

type Ubic = { id: string; codigo: string; descripcion: string | null; bahia_id: string | null; activa: boolean; existencias: { cantidad: number }[] };

export default async function UbicacionesPage({ searchParams }: { searchParams: Promise<{ error?: string; sucursal?: string }> }) {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const [{ data }, { data: bahias }] = await Promise.all([
    supabase.from("ubicaciones").select("id, codigo, descripcion, bahia_id, activa, existencias(cantidad)").eq("sucursal_id", sucursal.id).order("activa", { ascending: false }).order("codigo"),
    supabase.from("bahias").select("id, nombre").eq("sucursal_id", sucursal.id).eq("activa", true).order("nombre"),
  ]);
  const ubicaciones = (data as Ubic[]) ?? [];

  const campos = (u?: Ubic) => (
    <div className="fields">
      <div className="field">
        <label htmlFor={`u-c-${u?.id ?? "n"}`}>Nombre</label>
        <input id={`u-c-${u?.id ?? "n"}`} name="codigo" required defaultValue={u?.codigo ?? ""} placeholder="HUANCHACO" autoCapitalize="characters" />
      </div>
      <div className="field">
        <label htmlFor={`u-d-${u?.id ?? "n"}`}>Descripción</label>
        <input id={`u-d-${u?.id ?? "n"}`} name="descripcion" defaultValue={u?.descripcion ?? ""} placeholder="Estante de aceites" />
      </div>
      <div className="field">
        <label htmlFor={`u-b-${u?.id ?? "n"}`}>Está en la bahía</label>
        <select id={`u-b-${u?.id ?? "n"}`} name="bahia_id" defaultValue={u?.bahia_id ?? ""}>
          <option value="">Almacén (ninguna)</option>
          {(bahias ?? []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/inventario">Inventario</Link> /</p>
          <h1>Ubicaciones</h1>
          <p className="sub">{sucursal.nombre}. Cambiar el nombre no altera el kardex: los movimientos anteriores se muestran con el nombre nuevo.</p>
        </div>
      </div>
      {sp.error === "con-stock" && <div className="alert error">No se puede desactivar: todavía hay existencia ahí. Transfiérela primero a otra ubicación.</div>}

      <div className="grid2">
        <section className="panel">
          <h2>Ubicaciones <span className="muted mono" style={{ fontSize: 13 }}>{ubicaciones.filter((u) => u.activa).length}</span></h2>
          <ul className="list">
            {ubicaciones.map((u) => {
              const stock = u.existencias.reduce((s, e) => s + Number(e.cantidad), 0);
              return (
                <li key={u.id} style={{ opacity: u.activa ? 1 : 0.55 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="row"><b className="mono">{u.codigo}</b>{u.descripcion && <span className="muted">{u.descripcion}</span>}{!u.activa && <span className="chip">Inactiva</span>}</span>
                    <span className="muted num" style={{ fontSize: 13 }}>{stock.toLocaleString("es-PE")} unidades</span>
                  </div>
                  <details>
                    <summary className="btn small">Editar</summary>
                    <div style={{ marginTop: 10 }}>
                      <FormSimple accion={guardarUbicacion} textoBoton="Guardar" limpiar={false}>
                        <input type="hidden" name="id" value={u.id} />
                        {campos(u)}
                      </FormSimple>
                      <form action={alternarUbicacion.bind(null, u.id, !u.activa)} style={{ marginTop: 8 }}>
                        <button className={`btn small ${u.activa ? "danger" : ""}`} type="submit">{u.activa ? "Desactivar" : "Reactivar"}</button>
                      </form>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="panel">
          <h2>Nueva ubicación</h2>
          <FormSimple accion={guardarUbicacion} textoBoton="Crear ubicación">
            <input type="hidden" name="sucursal_id" value={sucursal.id} />
            {campos()}
          </FormSimple>
        </section>
      </div>
    </>
  );
}
