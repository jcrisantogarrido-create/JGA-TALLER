import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Perfil, Rol, Sucursal } from "@/lib/tipos";

// Perfil del usuario actual (una consulta por petición gracias a cache)
export const obtenerPerfil = cache(async (): Promise<Perfil | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("perfiles")
    .select("id, nombre, rol, sucursal_id")
    .eq("id", user.id)
    .eq("activo", true)
    .maybeSingle();
  return (data as Perfil) ?? null;
});

export async function requierePerfil(roles?: Rol[]): Promise<Perfil> {
  const perfil = await obtenerPerfil();
  if (!perfil) redirect("/sin-acceso");
  if (roles && !roles.includes(perfil.rol)) redirect("/?error=sin-permiso");
  return perfil;
}

// Sucursales visibles para el usuario; la primera es la activa por defecto
export const obtenerSucursales = cache(async (): Promise<Sucursal[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sucursales")
    .select("id, nombre, zona_horaria")
    .eq("activa", true)
    .order("nombre");
  return (data as Sucursal[]) ?? [];
});

export async function sucursalActiva(perfil: Perfil, solicitada?: string): Promise<Sucursal | null> {
  const sucursales = await obtenerSucursales();
  const permitidas = perfil.sucursal_id ? sucursales.filter((s) => s.id === perfil.sucursal_id) : sucursales;
  return permitidas.find((s) => s.id === solicitada) ?? permitidas[0] ?? null;
}
