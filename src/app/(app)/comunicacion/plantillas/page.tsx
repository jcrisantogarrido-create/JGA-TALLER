import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import FormSimple from "@/components/FormSimple";
import { guardarPlantilla, guardarPrefijo } from "../actions";

export const metadata: Metadata = { title: "Plantillas de mensajes" };

export default async function PlantillasPage() {
  const perfil = await requierePerfil(["admin", "gerente"]);
  const sucursal = await sucursalActiva(perfil);
  const supabase = await createClient();
  const [{ data }, { data: suc }] = await Promise.all([
    supabase.from("plantillas_mensaje").select("clave, titulo, asunto, texto").order("titulo"),
    sucursal ? supabase.from("sucursales").select("id, nombre, prefijo_telefono").eq("id", sucursal.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const plantillas = (data as { clave: string; titulo: string; asunto: string | null; texto: string }[]) ?? [];
  const s = suc as { id: string; nombre: string; prefijo_telefono: string } | null;
  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/comunicacion">Mensajes</Link> /</p>
          <h1>Plantillas</h1>
          <p className="sub">Puedes usar {"{{nombre}}, {{placa}}, {{vehiculo}}, {{servicio}}, {{fecha}}, {{hora}}, {{total}} y {{taller}}"}; se reemplazan al enviar.</p>
        </div>
      </div>
      {s && (
        <section className="panel">
          <h2>Lada del país para WhatsApp</h2>
          <FormSimple accion={guardarPrefijo} textoBoton="Guardar" limpiar={false}>
            <input type="hidden" name="sucursal_id" value={s.id} />
            <div className="field" style={{ maxWidth: 280 }}>
              <label htmlFor="pref">{s.nombre}: lada sin “+”</label>
              <input id="pref" name="prefijo_telefono" inputMode="numeric" defaultValue={s.prefijo_telefono} placeholder="52 México, 51 Perú" />
            </div>
          </FormSimple>
          <p className="muted" style={{ fontSize: 13 }}>Se antepone a los teléfonos de clientes que no la tengan. Los números escritos con “+” se usan tal cual.</p>
        </section>
      )}
      <div className="grid2">
        {plantillas.map((p) => (
          <section key={p.clave} className="panel">
            <h2>{p.titulo}</h2>
            <FormSimple accion={guardarPlantilla} textoBoton="Guardar" limpiar={false}>
              <input type="hidden" name="clave" value={p.clave} />
              <div className="field"><label htmlFor={`as-${p.clave}`}>Asunto (correo)</label><input id={`as-${p.clave}`} name="asunto" defaultValue={p.asunto ?? ""} /></div>
              <div className="field"><label htmlFor={`tx-${p.clave}`}>Mensaje</label><textarea id={`tx-${p.clave}`} name="texto" rows={5} defaultValue={p.texto} required /></div>
            </FormSimple>
          </section>
        ))}
      </div>
    </>
  );
}
