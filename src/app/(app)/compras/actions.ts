"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil } from "@/lib/sesion";
import type { EstadoOC } from "@/lib/tipos";

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

const gestion = () => requierePerfil(["admin", "gerente"]);
const refrescar = (ocId?: string) => {
  if (ocId) revalidatePath(`/compras/${ocId}`);
  revalidatePath("/compras");
  revalidatePath("/inventario");
};

// ---------- Proveedores ----------

export async function guardarProveedor(_: Estado, f: FormData): Promise<Estado> {
  await gestion();
  const id = txt(f, "id");
  const nombre = txt(f, "nombre");
  if (!nombre) return { error: "Escribe el nombre del proveedor." };
  const dias = num(f, "dias_entrega");
  if (Number.isNaN(dias) || (dias !== null && dias < 0)) return { error: "Revisa los días de entrega." };
  const datos = {
    nombre,
    documento_fiscal: txt(f, "documento_fiscal"),
    contacto: txt(f, "contacto"),
    telefono: txt(f, "telefono"),
    email: txt(f, "email"),
    direccion: txt(f, "direccion"),
    condiciones_pago: txt(f, "condiciones_pago"),
    dias_entrega: dias,
    activo: id ? f.get("activo") === "on" : true,
  };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("proveedores").update(datos).eq("id", id);
    if (error) return { error: error.code === "23505" ? "Ya hay otro proveedor con ese RUC." : mensajeError(error) };
    revalidatePath(`/compras/proveedores/${id}`);
    revalidatePath("/compras/proveedores");
    return { ok: "Proveedor guardado." };
  }
  // Un proveedor creado desde una entrada rápida del kardex puede existir ya con el mismo nombre
  const { data: mismo } = await supabase.from("proveedores").select("id").ilike("nombre", nombre).limit(1).maybeSingle();
  if (mismo) return { error: `Ya existe “${nombre}”. Ábrelo en la lista para completar sus datos.` };
  const { data, error } = await supabase.from("proveedores").insert(datos).select("id").single();
  if (error) return { error: error.code === "23505" ? "Ya hay otro proveedor con ese RUC." : mensajeError(error) };
  revalidatePath("/compras/proveedores");
  redirect(`/compras/proveedores/${data.id}`);
}

export async function vincularArticulo(_: Estado, f: FormData): Promise<Estado> {
  await gestion();
  const proveedorId = String(f.get("proveedor_id"));
  const codigo = txt(f, "codigo");
  const costo = num(f, "costo");
  if (!codigo) return { error: "Escribe o escanea el SKU del artículo." };
  if (costo === null || Number.isNaN(costo) || costo < 0) return { error: "Escribe el costo con el que te lo vende." };
  const supabase = await createClient();
  const { data } = await supabase.rpc("articulo_por_codigo", { p_codigo: codigo });
  const art = (data as { id: string; nombre: string }[] | null)?.[0];
  if (!art) return { error: `No hay ningún artículo con el código “${codigo}”.` };
  const preferido = f.get("preferido") === "on";
  if (preferido) await supabase.from("articulo_proveedores").update({ preferido: false }).eq("articulo_id", art.id);
  const { error } = await supabase.from("articulo_proveedores").upsert({
    articulo_id: art.id,
    proveedor_id: proveedorId,
    costo,
    codigo_proveedor: txt(f, "codigo_proveedor"),
    preferido,
  });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/compras/proveedores/${proveedorId}`);
  return { ok: `${art.nombre} agregado a la lista del proveedor.` };
}

export async function marcarPreferido(articuloId: string, proveedorId: string, preferido: boolean): Promise<void> {
  await gestion();
  const supabase = await createClient();
  if (preferido) await supabase.from("articulo_proveedores").update({ preferido: false }).eq("articulo_id", articuloId);
  await supabase.from("articulo_proveedores").update({ preferido }).eq("articulo_id", articuloId).eq("proveedor_id", proveedorId);
  revalidatePath(`/compras/proveedores/${proveedorId}`);
  revalidatePath("/compras");
}

export async function desvincularArticulo(articuloId: string, proveedorId: string): Promise<void> {
  await gestion();
  const supabase = await createClient();
  await supabase.from("articulo_proveedores").delete().eq("articulo_id", articuloId).eq("proveedor_id", proveedorId);
  revalidatePath(`/compras/proveedores/${proveedorId}`);
}

// ---------- Pedidos ----------

export async function crearPedido(_: Estado, f: FormData): Promise<Estado> {
  const perfil = await gestion();
  const proveedorId = txt(f, "proveedor_id");
  if (!proveedorId) return { error: "Elige el proveedor." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ordenes_compra")
    .insert({ proveedor_id: proveedorId, sucursal_id: String(f.get("sucursal_id")), creada_por: perfil.id })
    .select("id")
    .single();
  if (error) return { error: mensajeError(error) };
  refrescar();
  redirect(`/compras/${data.id}`);
}

export async function generarSugeridos(sucursalId: string): Promise<void> {
  await gestion();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generar_pedidos_sugeridos", { p_sucursal: sucursalId });
  if (error) redirect(`/compras?error=${encodeURIComponent(mensajeError(error))}`);
  refrescar();
  redirect(`/compras?generados=${data ?? 0}`);
}

export async function guardarPedido(_: Estado, f: FormData): Promise<Estado> {
  await gestion();
  const id = String(f.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("ordenes_compra").update({ fecha_esperada: txt(f, "fecha_esperada"), notas: txt(f, "notas") }).eq("id", id);
  if (error) return { error: mensajeError(error) };
  refrescar(id);
  return { ok: "Pedido guardado." };
}

export async function agregarLinea(p: { oc_id: string; articulo_id: string; cantidad: number; costo: number }): Promise<Estado> {
  await gestion();
  if (!(p.cantidad > 0)) return { error: "La cantidad debe ser mayor que cero." };
  if (!(p.costo >= 0)) return { error: "Revisa el costo." };
  const supabase = await createClient();
  // Si el artículo ya está en el pedido, se suma a la misma línea
  const { data: existente } = await supabase
    .from("ordenes_compra_lineas").select("id, cantidad").eq("orden_compra_id", p.oc_id).eq("articulo_id", p.articulo_id).maybeSingle();
  const { error } = existente
    ? await supabase.from("ordenes_compra_lineas").update({ cantidad: Number(existente.cantidad) + p.cantidad, costo_unitario: p.costo }).eq("id", existente.id)
    : await supabase.from("ordenes_compra_lineas").insert({ orden_compra_id: p.oc_id, articulo_id: p.articulo_id, cantidad: p.cantidad, costo_unitario: p.costo });
  if (error) return { error: mensajeError(error) };
  refrescar(p.oc_id);
  return { ok: existente ? "Se sumó a la línea existente." : "Artículo agregado al pedido." };
}

export async function actualizarLinea(_: Estado, f: FormData): Promise<Estado> {
  await gestion();
  const id = String(f.get("id"));
  const ocId = String(f.get("oc_id"));
  const cantidad = num(f, "cantidad");
  const costo = num(f, "costo");
  if (!cantidad || Number.isNaN(cantidad) || cantidad <= 0 || costo === null || Number.isNaN(costo) || costo < 0) return { error: "Revisa cantidad y costo." };
  const supabase = await createClient();
  const { error } = await supabase.from("ordenes_compra_lineas").update({ cantidad, costo_unitario: costo }).eq("id", id);
  if (error) return { error: mensajeError(error) };
  refrescar(ocId);
  return { ok: "Línea actualizada." };
}

export async function quitarLinea(id: string, ocId: string): Promise<void> {
  await gestion();
  const supabase = await createClient();
  await supabase.from("ordenes_compra_lineas").delete().eq("id", id).eq("cantidad_recibida", 0);
  refrescar(ocId);
}

const TRANSICIONES: Record<EstadoOC, EstadoOC[]> = {
  borrador: ["enviada", "cancelada"],
  enviada: ["borrador", "cancelada"],
  parcial: ["cancelada"],
  recibida: [],
  cancelada: [],
};

export async function cambiarEstadoPedido(id: string, actual: EstadoOC, nuevo: EstadoOC): Promise<void> {
  await gestion();
  if (!TRANSICIONES[actual].includes(nuevo)) redirect(`/compras/${id}?error=transicion`);
  const supabase = await createClient();
  if (nuevo === "enviada") {
    const { count } = await supabase.from("ordenes_compra_lineas").select("id", { count: "exact", head: true }).eq("orden_compra_id", id);
    if (!count) redirect(`/compras/${id}?error=vacio`);
  }
  const { error } = await supabase.from("ordenes_compra").update({ estado: nuevo }).eq("id", id).eq("estado", actual);
  if (error) redirect(`/compras/${id}?error=${encodeURIComponent(mensajeError(error))}`);
  refrescar(id);
}

export async function recibirPedido(p: {
  oc_id: string;
  ubicacion_id: string;
  referencia: string;
  metodo: "escaneo" | "manual";
  lineas: { id: string; cantidad: number }[];
}): Promise<Estado> {
  await gestion();
  const lineas = p.lineas.filter((l) => l.cantidad > 0);
  if (lineas.length === 0) return { error: "Escribe cuánto llegó de al menos un artículo." };
  if (!p.referencia.trim()) return { error: "Escribe el número de factura o remisión." };
  const supabase = await createClient();
  let recibidas = 0;
  for (const l of lineas) {
    const { error } = await supabase.rpc("recibir_linea_oc", {
      p_linea: l.id,
      p_cantidad: l.cantidad,
      p_ubicacion: p.ubicacion_id,
      p_metodo: p.metodo,
      p_referencia: p.referencia.trim(),
    });
    if (error) {
      refrescar(p.oc_id);
      const msg = error.message.includes("oc_no_sobre_recepcion") ? "Llegó más de lo pedido en una línea. Ajusta la cantidad o edita el pedido." : mensajeError(error);
      return { error: recibidas ? `Se registraron ${recibidas} líneas; en la siguiente: ${msg}` : msg };
    }
    recibidas++;
  }
  refrescar(p.oc_id);
  revalidatePath("/kardex");
  return { ok: `Entrada registrada: ${recibidas} ${recibidas === 1 ? "artículo" : "artículos"} al inventario.` };
}
