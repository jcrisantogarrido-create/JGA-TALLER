"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil } from "@/lib/sesion";
import { MOVIMIENTOS_MANUALES, type TipoMovimiento } from "@/lib/tipos";

export type Estado = { error?: string; ok?: string };

const txt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (f: FormData, k: string) => {
  const v = txt(f, k);
  if (v === null) return null;
  const n = Number(v.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

type Supa = Awaited<ReturnType<typeof createClient>>;

// Busca por nombre (sin distinguir mayúsculas) o crea el registro
async function idPorNombre(supabase: Supa, tabla: "categorias_articulo" | "marcas" | "proveedores", nombre: string | null) {
  if (!nombre) return null;
  const { data } = await supabase.from(tabla).select("id").ilike("nombre", nombre).limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: nuevo, error } = await supabase.from(tabla).insert({ nombre }).select("id").single();
  if (error) throw new Error(mensajeError(error));
  return nuevo.id as string;
}

function datosArticulo(f: FormData) {
  return {
    sku: txt(f, "sku")?.toUpperCase() ?? null,
    codigo_barras: txt(f, "codigo_barras"),
    nombre: txt(f, "nombre"),
    descripcion: txt(f, "descripcion"),
    tipo: txt(f, "tipo") ?? "pieza",
    unidad: txt(f, "unidad") ?? "pieza",
    precio_venta: num(f, "precio_venta") ?? 0,
  };
}

async function guardarParametros(supabase: Supa, articuloId: string, f: FormData) {
  const sucursalId = txt(f, "sucursal_id");
  const punto = num(f, "punto_reorden");
  if (!sucursalId || punto === null) return;
  const maximo = num(f, "stock_maximo");
  const { error } = await supabase.from("parametros_stock").upsert({
    articulo_id: articuloId,
    sucursal_id: sucursalId,
    punto_reorden: punto,
    cantidad_reorden: num(f, "cantidad_reorden") ?? 0,
    stock_maximo: maximo,
  });
  if (error) throw new Error(error.code === "23514" ? "El stock máximo no puede ser menor que el punto de reorden." : mensajeError(error));
}

export async function crearArticulo(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const a = datosArticulo(f);
  if (!a.sku || !a.nombre) return { error: "Escribe al menos el SKU y el nombre." };
  if (Number.isNaN(a.precio_venta)) return { error: "Revisa el precio de venta." };

  const supabase = await createClient();
  let id: string;
  try {
    const [categoria_id, marca_id] = await Promise.all([
      idPorNombre(supabase, "categorias_articulo", txt(f, "categoria")),
      idPorNombre(supabase, "marcas", txt(f, "marca")),
    ]);
    const { data, error } = await supabase.from("articulos").insert({ ...a, categoria_id, marca_id }).select("id").single();
    if (error) {
      if (error.code === "23505" && error.message.includes("codigo_barras")) return { error: "Ese código de barras ya pertenece a otro artículo." };
      if (error.code === "23505") return { error: "Ya existe un artículo con ese SKU." };
      return { error: mensajeError(error) };
    }
    id = data.id;
    await guardarParametros(supabase, id, f);

    // Existencia inicial opcional
    const cantidad = num(f, "inicial_cantidad");
    if (cantidad && cantidad > 0) {
      const ubicacion = txt(f, "inicial_ubicacion");
      if (!ubicacion) return { error: "Artículo guardado. Para la existencia inicial elige una ubicación." };
      const { error: e2 } = await supabase.from("movimientos_inventario").insert({
        articulo_id: id,
        ubicacion_id: ubicacion,
        tipo: "ajuste_positivo",
        cantidad,
        costo_unitario: num(f, "inicial_costo"),
        motivo: "Inventario inicial",
        metodo: "manual",
      });
      if (e2) return { error: `Artículo guardado, pero no la existencia inicial: ${mensajeError(e2)}` };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/inventario");
  redirect(`/inventario/${id}`);
}

export async function actualizarArticulo(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  const id = String(f.get("id"));
  const a = datosArticulo(f);
  if (!a.sku || !a.nombre) return { error: "Escribe al menos el SKU y el nombre." };
  const supabase = await createClient();
  try {
    const [categoria_id, marca_id] = await Promise.all([
      idPorNombre(supabase, "categorias_articulo", txt(f, "categoria")),
      idPorNombre(supabase, "marcas", txt(f, "marca")),
    ]);
    const { error } = await supabase
      .from("articulos")
      .update({ ...a, categoria_id, marca_id, activo: f.get("activo") === "on" })
      .eq("id", id);
    if (error) return { error: error.code === "23505" ? "El SKU o el código de barras ya están en otro artículo." : mensajeError(error) };
    await guardarParametros(supabase, id, f);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/inventario/${id}`);
  revalidatePath("/inventario");
  return { ok: "Artículo guardado." };
}

export type Movimiento = {
  articulo_id: string;
  ubicacion_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario?: number | null;
  motivo?: string | null;
  referencia?: string | null;
  proveedor?: string | null;
  metodo?: "escaneo" | "manual";
};

export async function registrarMovimiento(m: Movimiento): Promise<Estado & { saldo?: number }> {
  await requierePerfil(["admin", "gerente"]);
  const def = MOVIMIENTOS_MANUALES.find((x) => x.tipo === m.tipo);
  if (!def) return { error: "Tipo de movimiento no válido." };
  if (!m.articulo_id || !m.ubicacion_id) return { error: "Elige artículo y ubicación." };
  if (!(m.cantidad > 0)) return { error: "La cantidad debe ser mayor que cero." };
  if (m.tipo === "entrada_compra" && !(Number(m.costo_unitario) >= 0 && m.costo_unitario !== null && m.costo_unitario !== undefined)) {
    return { error: "Para una entrada por compra captura el costo unitario." };
  }
  if (m.tipo !== "entrada_compra" && !m.motivo?.trim()) return { error: "Escribe el motivo del ajuste." };

  const supabase = await createClient();
  let proveedor_id: string | null = null;
  try {
    proveedor_id = m.tipo === "entrada_compra" ? await idPorNombre(supabase, "proveedores", m.proveedor?.trim() || null) : null;
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { data, error } = await supabase
    .from("movimientos_inventario")
    .insert({
      articulo_id: m.articulo_id,
      ubicacion_id: m.ubicacion_id,
      tipo: m.tipo,
      cantidad: def.signo * m.cantidad,
      costo_unitario: m.tipo === "entrada_compra" ? m.costo_unitario : null,
      motivo: m.motivo?.trim() || null,
      referencia: m.referencia?.trim() || null,
      proveedor_id,
      metodo: m.metodo ?? "manual",
    })
    .select("saldo_ubicacion")
    .single();
  if (error) {
    if (error.code === "23514" && error.message.includes("existencias")) return { error: "No hay suficiente existencia en esa ubicación para esa salida." };
    return { error: mensajeError(error) };
  }
  revalidatePath("/inventario");
  revalidatePath(`/inventario/${m.articulo_id}`);
  revalidatePath("/kardex");
  return { ok: "Movimiento registrado.", saldo: Number(data.saldo_ubicacion) };
}

export async function transferir(t: { articulo_id: string; origen: string; destino: string; cantidad: number; metodo?: "escaneo" | "manual" }): Promise<Estado> {
  await requierePerfil(["admin", "gerente"]);
  if (t.origen === t.destino) return { error: "El origen y el destino deben ser distintos." };
  if (!(t.cantidad > 0)) return { error: "La cantidad debe ser mayor que cero." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transferir_stock", {
    p_articulo: t.articulo_id,
    p_origen: t.origen,
    p_destino: t.destino,
    p_cantidad: t.cantidad,
    p_metodo: t.metodo ?? "manual",
  });
  if (error) {
    if (error.code === "23514") return { error: "No hay suficiente existencia en la ubicación de origen." };
    return { error: mensajeError(error) };
  }
  revalidatePath(`/inventario/${t.articulo_id}`);
  revalidatePath("/kardex");
  return { ok: "Transferencia registrada." };
}

export type ArticuloEscaneado = {
  id: string;
  sku: string;
  nombre: string;
  unidad: string;
  costo_promedio: number;
  existencias: { ubicacion_id: string; codigo: string; cantidad: number }[];
};

// Lector de código de barras: busca por código, SKU o código del proveedor
export async function buscarPorCodigo(codigo: string, sucursalId: string): Promise<ArticuloEscaneado | null> {
  await requierePerfil();
  const c = codigo.trim();
  if (!c) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("articulo_por_codigo", { p_codigo: c });
  const art = (data as { id: string; sku: string; nombre: string; unidad: string; costo_promedio: number }[] | null)?.[0];
  if (!art) return null;
  const { data: ex } = await supabase
    .from("existencias")
    .select("ubicacion_id, cantidad, ubicaciones!inner(codigo, sucursal_id)")
    .eq("articulo_id", art.id)
    .eq("ubicaciones.sucursal_id", sucursalId);
  return {
    id: art.id,
    sku: art.sku,
    nombre: art.nombre,
    unidad: art.unidad,
    costo_promedio: Number(art.costo_promedio),
    existencias: ((ex as unknown as { ubicacion_id: string; cantidad: number; ubicaciones: { codigo: string } }[]) ?? []).map((e) => ({
      ubicacion_id: e.ubicacion_id,
      codigo: e.ubicaciones.codigo,
      cantidad: Number(e.cantidad),
    })),
  };
}

export async function resolverAlerta(id: string, articuloId: string) {
  await requierePerfil(["admin", "gerente"]);
  const supabase = await createClient();
  await supabase.from("alertas_reabastecimiento").update({ estado: "descartada", resuelta_en: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/inventario/${articuloId}`);
  revalidatePath("/inventario");
}
