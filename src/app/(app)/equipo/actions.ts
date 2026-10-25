"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil } from "@/lib/sesion";
import { ROLES, type Rol } from "@/lib/tipos";

export type Estado = { error?: string; ok?: string };

const txt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

// Turno con el que nace un técnico: lunes a sábado de 8 a 18 (se ajusta después)
const TURNO_INICIAL = [1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, hora_inicio: "08:00", hora_fin: "18:00" }));

export async function guardarPerfil(_: Estado, f: FormData): Promise<Estado> {
  const yo = await requierePerfil(["admin"]);
  const id = String(f.get("id"));
  const nombre = txt(f, "nombre");
  const rol = txt(f, "rol") as Rol | null;
  if (!nombre) return { error: "Escribe el nombre." };
  if (!rol || !(rol in ROLES)) return { error: "Elige el rol." };
  const activo = f.get("nuevo") === "1" ? true : f.get("activo") === "on";
  if (id === yo.id && (rol !== "admin" || !activo)) return { error: "No puedes quitar tu propio rol de administración." };
  const costo = Number(String(f.get("costo_hora") ?? "0").replace(/[,$\s]/g, "") || 0);
  if (!Number.isFinite(costo) || costo < 0) return { error: "Revisa el costo por hora." };
  const supabase = await createClient();
  const { error } = await supabase.from("perfiles").upsert({
    id,
    nombre,
    rol,
    sucursal_id: txt(f, "sucursal_id"),
    telefono: txt(f, "telefono"),
    costo_hora: costo,
    activo,
  });
  if (error) return { error: mensajeError(error) };
  let extra = "";
  if (rol === "tecnico") {
    const { count } = await supabase.from("horarios_tecnico").select("id", { count: "exact", head: true }).eq("tecnico_id", id);
    if (!count) {
      await supabase.from("horarios_tecnico").insert(TURNO_INICIAL.map((t) => ({ ...t, tecnico_id: id })));
      extra = " Se le asignó turno de lunes a sábado, 8:00 a 18:00; ajústalo abajo si es distinto.";
    }
  }
  revalidatePath("/equipo");
  // Una cuenta nueva sale de la lista "sin rol": el aviso se muestra arriba de la página
  if (f.get("nuevo") === "1") redirect(`/equipo?alta=${encodeURIComponent(`${nombre} ya tiene acceso como ${ROLES[rol]}.${extra}`)}`);
  return { ok: `${nombre} guardado.${extra}` };
}

export async function guardarHorario(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const tecnicoId = String(f.get("tecnico_id"));
  const filas: { tecnico_id: string; dia_semana: number; hora_inicio: string; hora_fin: string }[] = [];
  for (let d = 0; d < 7; d++) {
    if (f.get(`on_${d}`) !== "on") continue;
    const ini = txt(f, `ini_${d}`);
    const fin = txt(f, `fin_${d}`);
    if (!ini || !fin || fin <= ini) return { error: "Revisa los horarios: la salida debe ser después de la entrada." };
    filas.push({ tecnico_id: tecnicoId, dia_semana: d, hora_inicio: ini, hora_fin: fin });
  }
  const supabase = await createClient();
  const { error: e1 } = await supabase.from("horarios_tecnico").delete().eq("tecnico_id", tecnicoId);
  if (e1) return { error: mensajeError(e1) };
  if (filas.length) {
    const { error } = await supabase.from("horarios_tecnico").insert(filas);
    if (error) return { error: mensajeError(error) };
  }
  revalidatePath("/equipo");
  return { ok: filas.length ? "Turno guardado. La agenda ya lo usa." : "Turno borrado: no aparecerá en la agenda." };
}
