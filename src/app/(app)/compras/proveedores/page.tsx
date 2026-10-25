import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil } from "@/lib/sesion";
import FormSimple from "@/components/FormSimple";
import CamposProveedor from "@/components/CamposProveedor";
import { guardarProveedor } from "../actions";

export const metadata: Metadata = { title: "Proveedores" };

type Prov = { id: string; nombre: string; contacto: string | null; telefono: string | null; email: string | null; dias_entrega: number | null; activo: boolean; articulo_proveedores: { preferido: boolean }[] };

export default async function ProveedoresPage() {
  await requierePerfil(["admin", "gerente"]);
  const supabase = await createClient();
  const { data } = await supabase.from("proveedores").select("id, nombre, contacto, telefono, email, dias_entrega, activo, articulo_proveedores(preferido)").order("activo", { ascending: false }).order("nombre");
  const provs = (data as Prov[]) ?? [];
  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/compras">Compras</Link> /</p>
          <h1>Proveedores</h1>
          <p className="sub">Asigna a cada proveedor los artículos que te vende para que los pedidos sugeridos se armen solos.</p>
        </div>
      </div>
      <div className="grid2">
        <section className="panel">
          <h2>Lista <span className="muted mono" style={{ fontSize: 13 }}>{provs.filter((p) => p.activo).length}</span></h2>
          {provs.length === 0 ? (
            <div className="empty">Aún no hay proveedores.</div>
          ) : (
            <ul className="list">
              {provs.map((p) => (
                <li key={p.id} style={{ opacity: p.activo ? 1 : 0.55 }}>
                  <div className="row"><Link href={`/compras/proveedores/${p.id}`}><b>{p.nombre}</b></Link>{!p.activo && <span className="chip">Inactivo</span>}</div>
                  <div className="meta">
                    {p.contacto && <span>{p.contacto}</span>}
                    {p.telefono && <span className="num">{p.telefono}</span>}
                    {p.email && <span>{p.email}</span>}
                    <span>{p.articulo_proveedores.length} artículos · preferido en {p.articulo_proveedores.filter((x) => x.preferido).length}</span>
                    {p.dias_entrega != null && <span>entrega en {p.dias_entrega} días</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Nuevo proveedor</h2>
          <FormSimple accion={guardarProveedor} textoBoton="Guardar proveedor" limpiar={false}>
            <CamposProveedor />
          </FormSimple>
        </section>
      </div>
    </>
  );
}
