"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil } from "@/lib/sesion";
import { fechaLocal } from "@/lib/fechas";
import { TRANSICIONES_CITA, type EstadoCita } from "@/lib/tipos";

export type ClienteBusqueda = {
  id: string;
  nombre: string;
  apellidos: string | null;
  telefono: string | null;
  vehiculos: { id: string; placa: string; marca: string; modelo: string; anio: number; activo: boolean }[];
};

export async function buscarClientes(q: string): Promise<ClienteBusqueda[]> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const termino = q.trim().replace(/[,()%*\\]/g, " ").slice(0, 60);
  if (termino.length < 2) return [];
  const supabase = await createClient();
  const cols = "id, nombre, apellidos, telefono, vehiculos(id, placa, marca, modelo, anio, activo)";
  const placa = termino.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [a, b] = await Promise.all([
    supabase.from("clientes").select(cols).eq("activo", true)
      .or(`nombre.ilike.%${termino}%,apellidos.ilike.%${termino}%,telefono.ilike.%${termino}%`).limit(10),
    placa ? supabase.from("vehiculos").select("cliente_id").eq("activo", true).ilike("placa_norm", `%${placa}%`).limit(10)
          : Promise.resolve({ data: [] as { cliente_id: string }[] }),
  ]);
  let lista = (a.data as ClienteBusqueda[]) ?? [];
  const extra = (b.data ?? []).map((v) => v.cliente_id).filter((id) => !lista.some((c) => c.id === id));
  if (extra.length) {
    const { data } = await supabase.from("clientes").select(cols).in("id", extra);
    lista = [...((data as ClienteBusqueda[]) ?? []), ...lista];
  }
  return lista.slice(0, 10);
}

export type Hueco = { inicio: string; fin: string; tecnico_id: string; bahia_id: string };

export async function buscarHuecos(params: {
  sucursalId: string;
  fecha: string;
  duracionMin: number;
  tipoBahia: string | null;
}): Promise<{ huecos?: Hueco[]; error?: string }> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fecha)) return { error: "Elige una fecha." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("huecos_disponibles", {
    p_sucursal: params.sucursalId,
    p_dia: params.fecha,
    p_duracion: `${Math.max(15, Math.round(params.duracionMin))} minutes`,
    p_tipo_bahia: params.tipoBahia || null,
  });
  if (error) return { error: mensajeError(error) };
  const ahora = Date.now();
  return { huecos: ((data as Hueco[]) ?? []).filter((h) => new Date(h.inicio).getTime() > ahora) };
}

export type NuevaCita = {
  sucursal_id: string;
  cliente_id: string;
  vehiculo_id: string;
  servicio_id: string | null;
  bahia_id: string;
  tecnico_id: string;
  inicio: string;
  fin: string;
  motivo_cliente: string | null;
  canal_origen: string | null;
  zona_horaria: string;
};

export async function crearCita(c: NuevaCita): Promise<{ error?: string }> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  const { zona_horaria, ...fila } = c;
  const { data, error } = await supabase.from("citas").insert(fila).select("id").single();
  if (error) return { error: mensajeError(error) };
  revalidatePath("/agenda");
  revalidatePath(`/clientes/${c.cliente_id}`);
  redirect(`/agenda?fecha=${fechaLocal(new Date(c.inicio), zona_horaria)}&nueva=${data.id}`);
}

export async function cambiarEstadoCita(id: string, actual: EstadoCita, nuevo: EstadoCita): Promise<void> {
  const perfil = await requierePerfil();
  if (!TRANSICIONES_CITA[actual].includes(nuevo)) redirect(`/agenda/${id}?error=transicion`);
  // El técnico solo puede marcar inicio y término de sus propias citas (RLS hace cumplir el resto)
  if (perfil.rol === "tecnico" && !["en_curso", "completada"].includes(nuevo)) redirect(`/agenda/${id}?error=permiso`);
  const supabase = await createClient();
  const { error } = await supabase.from("citas").update({ estado: nuevo }).eq("id", id);
  if (error) redirect(`/agenda/${id}?error=${encodeURIComponent(mensajeError(error))}`);
  revalidatePath("/agenda");
  revalidatePath(`/agenda/${id}`);
}
