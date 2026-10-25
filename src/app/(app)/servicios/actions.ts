"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil } from "@/lib/sesion";

export type Estado = { error?: string; ok?: string };

const txt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (f: FormData, k: string) => {
  const v = txt(f, k);
  if (v === null) return null;
  const n = Number(v.replace(/[,\s$S/]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

export async function guardarServicio(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const id = txt(f, "id");
  const nombre = txt(f, "nombre");
  const categoria = txt(f, "categoria");
  const precio = num(f, "precio_base");
  const horas = num(f, "horas_estandar");
  const dias = num(f, "intervalo_recordatorio_dias");
  const km = num(f, "intervalo_recordatorio_km");
  if (!nombre || !categoria) return { error: "Escribe el nombre y el tipo de trabajo." };
  if (precio === null || Number.isNaN(precio) || precio < 0) return { error: "Revisa el precio." };
  if (!horas || Number.isNaN(horas) || horas <= 0) return { error: "La duración debe ser mayor que cero." };
  if (Number.isNaN(dias) || Number.isNaN(km) || (dias !== null && dias <= 0) || (km !== null && km <= 0)) return { error: "Revisa el recordatorio (días o km)." };
  const supabase = await createClient();
  // El tipo de trabajo se crea si no existe
  let { data: cat } = await supabase.from("categorias_servicio").select("id").ilike("nombre", categoria).limit(1).maybeSingle();
  if (!cat) {
    const r = await supabase.from("categorias_servicio").insert({ nombre: categoria }).select("id").single();
    if (r.error) return { error: mensajeError(r.error) };
    cat = r.data;
  }
  const datos = {
    nombre,
    codigo: txt(f, "codigo"),
    categoria_id: cat!.id,
    precio_base: precio,
    moneda: txt(f, "moneda") ?? "PEN",
    horas_estandar: horas,
    tipo_bahia_requerida: txt(f, "tipo_bahia_requerida"),
    intervalo_recordatorio_dias: dias,
    intervalo_recordatorio_km: km,
    descripcion: txt(f, "descripcion"),
    activo: id ? f.get("activo") === "on" : true,
  };
  const { error } = id ? await supabase.from("servicios").update(datos).eq("id", id) : await supabase.from("servicios").insert(datos);
  if (error) return { error: error.code === "23505" ? "Ya existe un servicio con ese código." : mensajeError(error) };
  revalidatePath("/servicios");
  return { ok: id ? `${nombre} actualizado.` : `${nombre} agregado al catálogo.` };
}

export async function guardarTipoCambio(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const tc = num(f, "usd_pen");
  const fecha = txt(f, "fecha");
  if (!tc || Number.isNaN(tc) || tc <= 0 || tc > 20) return { error: "Escribe cuántos soles vale 1 dólar, por ejemplo 3.75." };
  if (!fecha) return { error: "Falta la fecha." };
  const supabase = await createClient();
  const { error } = await supabase.from("tipos_cambio").upsert({ fecha, usd_pen: tc });
  if (error) return { error: mensajeError(error) };
  revalidatePath("/servicios");
  return { ok: `Tipo de cambio del ${fecha}: 1 US$ = S/ ${tc.toFixed(3)}. Las órdenes y pedidos nuevos en dólares lo usarán.` };
}
