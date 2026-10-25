import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { fechaLocal } from "@/lib/fechas";
import NuevaCitaForm from "./NuevaCitaForm";
import type { ClienteBusqueda } from "../actions";

export const metadata: Metadata = { title: "Nueva cita" };

export default async function NuevaCitaPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; fecha?: string; sucursal?: string }>;
}) {
  const perfil = await requierePerfil(["admin", "gerente", "recepcion"]);
  const sp = await searchParams;
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return <div className="empty">No hay sucursales activas.</div>;

  const supabase = await createClient();
  const [{ data: servicios }, { data: bahias }, { data: tecnicos }, clienteInicial] = await Promise.all([
    supabase.from("servicios").select("id, nombre, horas_estandar, tipo_bahia_requerida, precio_base, categorias_servicio(nombre)").eq("activo", true).order("nombre"),
    supabase.from("bahias").select("id, nombre, tipo").eq("sucursal_id", sucursal.id).eq("activa", true).order("nombre"),
    supabase.from("perfiles").select("id, nombre, especialidades").eq("rol", "tecnico").eq("activo", true),
    sp.cliente
      ? supabase.from("clientes").select("id, nombre, apellidos, telefono, vehiculos(id, placa, marca, modelo, anio, activo)").eq("id", sp.cliente).maybeSingle().then((r) => r.data as ClienteBusqueda | null)
      : Promise.resolve(null),
  ]);

  const hoy = fechaLocal(new Date(), sucursal.zona_horaria);
  const fecha = sp.fecha && sp.fecha >= hoy ? sp.fecha : hoy;

  return (
    <>
      <div className="head">
        <div>
          <p className="sub"><Link href="/agenda">Agenda</Link> /</p>
          <h1>Nueva cita</h1>
          <p className="sub">{sucursal.nombre}. Solo se muestran horarios donde hay técnico en turno y bahía libre.</p>
        </div>
      </div>
      <NuevaCitaForm
        sucursal={sucursal}
        fechaInicial={fecha}
        hoy={hoy}
        clienteInicial={clienteInicial}
        servicios={(servicios as unknown as Parameters<typeof NuevaCitaForm>[0]["servicios"]) ?? []}
        bahias={bahias ?? []}
        tecnicos={tecnicos ?? []}
      />
    </>
  );
}
