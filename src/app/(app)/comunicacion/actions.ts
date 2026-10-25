"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil } from "@/lib/sesion";

export type Estado = { error?: string; ok?: string };

const txt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const entero = (f: FormData, k: string) => {
  const v = txt(f, k);
  if (v === null) return null;
  const n = Number(v.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

export type Envio = {
  cliente_id: string;
  vehiculo_id?: string | null;
  orden_id?: string | null;
  cita_id?: string | null;
  recordatorio_id?: string | null;
  campana_id?: string | null;
  canal: "whatsapp" | "sms" | "email";
  asunto?: string | null;
  contenido: string;
};

/** Registra en la bitácora un mensaje enviado desde la app (WhatsApp, SMS o correo). */
export async function registrarEnvio(e: Envio): Promise<Estado> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  const { error } = await supabase.from("comunicaciones").insert({
    cliente_id: e.cliente_id,
    vehiculo_id: e.vehiculo_id ?? null,
    orden_id: e.orden_id ?? null,
    cita_id: e.cita_id ?? null,
    recordatorio_id: e.recordatorio_id ?? null,
    campana_id: e.campana_id ?? null,
    canal: e.canal,
    direccion: "saliente",
    asunto: e.asunto ?? null,
    contenido: e.contenido,
    estado_envio: "abierto",
  });
  if (error) return { error: mensajeError(error) };
  if (e.recordatorio_id) {
    await supabase.from("recordatorios").update({ estado: "enviado", enviado_en: new Date().toISOString() }).eq("id", e.recordatorio_id);
  }
  revalidatePath("/comunicacion");
  revalidatePath(`/clientes/${e.cliente_id}`);
  if (e.campana_id) revalidatePath(`/comunicacion/campanas/${e.campana_id}`);
  return { ok: "Registrado" };
}

export async function estadoRecordatorio(id: string, estado: "pendiente" | "completado" | "cancelado"): Promise<void> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  await supabase.from("recordatorios").update({ estado }).eq("id", id);
  revalidatePath("/comunicacion");
}

export async function posponerRecordatorio(id: string, dias: number): Promise<void> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  const f = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
  await supabase.from("recordatorios").update({ vence_fecha: f, avisar_dias_antes: 0, estado: "pendiente" }).eq("id", id);
  revalidatePath("/comunicacion");
}

export async function confirmarCita(id: string): Promise<void> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  await supabase.from("citas").update({ estado: "confirmada" }).eq("id", id).eq("estado", "programada");
  revalidatePath("/comunicacion");
  revalidatePath("/agenda");
}

export async function guardarPlantilla(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const texto = txt(f, "texto");
  if (!texto) return { error: "El mensaje no puede quedar vacío." };
  const supabase = await createClient();
  const { error } = await supabase.from("plantillas_mensaje").update({ texto, asunto: txt(f, "asunto"), updated_at: new Date().toISOString() }).eq("clave", String(f.get("clave")));
  if (error) return { error: mensajeError(error) };
  revalidatePath("/comunicacion/plantillas");
  return { ok: "Plantilla guardada." };
}

export async function guardarPrefijo(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const prefijo = (txt(f, "prefijo_telefono") ?? "").replace(/\D/g, "");
  if (!prefijo || prefijo.length > 4) return { error: "Escribe solo la lada del país, por ejemplo 51 (Perú)." };
  const supabase = await createClient();
  const { error } = await supabase.from("sucursales").update({ prefijo_telefono: prefijo }).eq("id", String(f.get("sucursal_id")));
  if (error) return { error: mensajeError(error) };
  revalidatePath("/comunicacion");
  return { ok: "Lada guardada." };
}

// ---------- Segmentos y campañas ----------

export async function guardarSegmento(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const nombre = txt(f, "nombre");
  if (!nombre) return { error: "Ponle nombre al segmento." };
  const reglas: Record<string, unknown> = {};
  for (const k of ["dias_sin_visita_min", "dias_sin_visita_max", "gasto_min", "gasto_max", "visitas_min"]) {
    const n = entero(f, k);
    if (Number.isNaN(n)) return { error: "Revisa los números del segmento." };
    if (n !== null) reglas[k] = n;
  }
  const tipos = f.getAll("tipos_vehiculo").map(String).filter(Boolean);
  if (tipos.length) reglas.tipos_vehiculo = tipos;
  const categorias = f.getAll("categorias").map(String).filter(Boolean);
  if (categorias.length) reglas.categorias = categorias;
  const marcas = (txt(f, "marcas") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (marcas.length) reglas.marcas = marcas;
  reglas.solo_marketing = f.get("solo_marketing") === "on";
  const supabase = await createClient();
  const id = txt(f, "id");
  const datos = { nombre, descripcion: txt(f, "descripcion"), reglas };
  const r = id
    ? await supabase.from("segmentos").update(datos).eq("id", id).select("id").single()
    : await supabase.from("segmentos").insert(datos).select("id").single();
  if (r.error) return { error: r.error.code === "23505" ? "Ya existe un segmento con ese nombre." : mensajeError(r.error) };
  revalidatePath("/comunicacion/segmentos");
  redirect(`/comunicacion/segmentos/${r.data.id}`);
}

export async function eliminarSegmento(id: string): Promise<void> {
  await requierePerfil(["admin", "gerente"]);
  const supabase = await createClient();
  const { error } = await supabase.from("segmentos").delete().eq("id", id);
  if (error) redirect(`/comunicacion/segmentos/${id}?error=usado`);
  revalidatePath("/comunicacion/segmentos");
  redirect("/comunicacion/segmentos");
}

export async function crearCampana(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const nombre = txt(f, "nombre");
  const plantilla = txt(f, "plantilla");
  if (!nombre || !plantilla) return { error: "Escribe el nombre de la campaña y el mensaje." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campanas")
    .insert({ nombre, segmento_id: String(f.get("segmento_id")), canal: txt(f, "canal") ?? "whatsapp", asunto: txt(f, "asunto"), plantilla, estado: "enviando" })
    .select("id")
    .single();
  if (error) return { error: mensajeError(error) };
  redirect(`/comunicacion/campanas/${data.id}`);
}

export async function cerrarCampana(id: string, estado: "enviada" | "cancelada" | "enviando"): Promise<void> {
  await requierePerfil(["admin", "gerente"]);
  const supabase = await createClient();
  await supabase.from("campanas").update({ estado }).eq("id", id);
  revalidatePath(`/comunicacion/campanas/${id}`);
  revalidatePath("/comunicacion/segmentos");
}
