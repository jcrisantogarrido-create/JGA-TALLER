import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import RegistroMovimiento from "@/components/RegistroMovimiento";

export const metadata: Metadata = { title: "Registrar movimiento" };

export default async function MovimientoPage() {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const sucursal = await sucursalActiva(perfil);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const [{ data: ubicaciones }, { data: proveedores }] = await Promise.all([
    supabase.from("ubicaciones").select("id, codigo").eq("sucursal_id", sucursal.id).eq("activa", true).order("codigo"),
    supabase.from("proveedores").select("nombre").eq("activo", true).order("nombre"),
  ]);
  const ubic = (ubicaciones as { id: string; codigo: string }[]) ?? [];
  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/inventario">Inventario</Link> /</p>
          <h1>Registrar movimiento</h1>
          <p className="sub">{sucursal.nombre}. Escanea un artículo, captura la cantidad y pulsa Enter; queda listo para el siguiente.</p>
        </div>
        <Link className="btn" href="/kardex">Ver kardex</Link>
      </div>
      {ubic.length === 0 ? (
        <div className="empty">Esta sucursal no tiene ubicaciones de inventario. Administración debe darlas de alta.</div>
      ) : (
        <section className="panel">
          <RegistroMovimiento
            sucursalId={sucursal.id}
            ubicaciones={ubic}
            proveedores={((proveedores as { nombre: string }[]) ?? []).map((p) => p.nombre)}
          />
        </section>
      )}
    </>
  );
}
