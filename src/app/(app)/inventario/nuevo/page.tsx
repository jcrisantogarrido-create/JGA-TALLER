import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import FormArticulo from "@/components/FormArticulo";
import { crearArticulo } from "../actions";

export const metadata: Metadata = { title: "Nuevo artículo" };

export default async function NuevoArticuloPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const { codigo } = await searchParams;
  const sucursal = await sucursalActiva(perfil);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;
  const supabase = await createClient();
  const [{ data: ubicaciones }, { data: categorias }, { data: marcas }] = await Promise.all([
    supabase.from("ubicaciones").select("id, codigo").eq("sucursal_id", sucursal.id).eq("activa", true).order("codigo"),
    supabase.from("categorias_articulo").select("nombre").order("nombre"),
    supabase.from("marcas").select("nombre").order("nombre"),
  ]);
  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/inventario">Inventario</Link> /</p>
          <h1>Nuevo artículo</h1>
        </div>
      </div>
      <section className="panel">
        <FormArticulo
          accion={crearArticulo}
          nuevo
          inicial={{ codigo_barras: codigo ?? null }}
          sucursal={sucursal}
          ubicaciones={(ubicaciones as { id: string; codigo: string }[]) ?? []}
          categorias={((categorias as { nombre: string }[]) ?? []).map((c) => c.nombre)}
          marcas={((marcas as { nombre: string }[]) ?? []).map((c) => c.nombre)}
        />
      </section>
    </>
  );
}
