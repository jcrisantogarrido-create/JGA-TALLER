"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";
import { requierePerfil, sucursalActiva } from "@/lib/sesion";
import { ESTADOS_TECNICO, TRANSICIONES_ORDEN, type EstadoOrden } from "@/lib/tipos";

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

const refrescar = (ordenId: string) => {
  revalidatePath(`/ordenes/${ordenId}`);
  revalidatePath("/ordenes");
};

/** Abre la orden con los datos de recepción. Si viene de una cita, copia servicio, técnico y bahía. */
export async function abrirOrden(_: Estado, f: FormData): Promise<Estado> {
  const perfil = await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  const citaId = txt(f, "cita_id");
  const vehiculoId = txt(f, "vehiculo_id");
  if (!vehiculoId) return { error: "Falta el vehículo." };

  const { data: veh } = await supabase.from("vehiculos").select("id, cliente_id").eq("id", vehiculoId).maybeSingle();
  if (!veh) return { error: "No se encontró el vehículo." };

  let cita: { id: string; sucursal_id: string; bahia_id: string | null; tecnico_id: string | null; servicio_id: string | null; estado: string; motivo_cliente: string | null } | null = null;
  if (citaId) {
    const { data } = await supabase.from("citas").select("id, sucursal_id, bahia_id, tecnico_id, servicio_id, estado, motivo_cliente").eq("id", citaId).maybeSingle();
    cita = data;
    const { data: existente } = await supabase.from("ordenes_trabajo").select("id").eq("cita_id", citaId).maybeSingle();
    if (existente) redirect(`/ordenes/${existente.id}`);
  }
  const sucursal = cita?.sucursal_id ?? (await sucursalActiva(perfil))?.id;
  if (!sucursal) return { error: "No hay sucursal activa." };

  const km = num(f, "kilometraje_ingreso");
  if (km !== null && (Number.isNaN(km) || km < 0)) return { error: "Revisa el kilometraje." };
  const checklist: Record<string, boolean> = {};
  f.getAll("checklist").forEach((c) => (checklist[String(c)] = true));

  const moneda = txt(f, "moneda") === "USD" ? "USD" : "PEN";
  const { data: tc } = await supabase.rpc("tipo_cambio_vigente");
  if (moneda === "USD" && !tc) return { error: "Para abrir una orden en dólares registra primero el tipo de cambio de hoy (menú Servicios)." };

  const { data: orden, error } = await supabase
    .from("ordenes_trabajo")
    .insert({
      sucursal_id: sucursal,
      cita_id: cita?.id ?? null,
      cliente_id: veh.cliente_id,
      vehiculo_id: veh.id,
      bahia_id: txt(f, "bahia_id") ?? cita?.bahia_id ?? null,
      asesor_id: perfil.id,
      kilometraje_ingreso: km,
      nivel_combustible: num(f, "nivel_combustible"),
      inventario_vehiculo: { checklist, observaciones: txt(f, "observaciones") },
      diagnostico: txt(f, "diagnostico") ?? cita?.motivo_cliente ?? null,
      moneda,
      tipo_cambio: tc ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: mensajeError(error) };

  // Primer trabajo: el servicio de la cita o el elegido en la recepción
  const servicioId = txt(f, "servicio_id") ?? cita?.servicio_id ?? null;
  const tecnicoId = txt(f, "tecnico_id") ?? cita?.tecnico_id ?? null;
  if (servicioId) {
    await supabase.from("orden_servicios").insert({ orden_id: orden.id, servicio_id: servicioId, tecnico_id: tecnicoId, descripcion: null, categoria_id: null });
  }
  if (cita && ["programada", "confirmada"].includes(cita.estado)) {
    await supabase.from("citas").update({ estado: "en_curso" }).eq("id", cita.id); // si falla (fuera de turno) la orden sigue
  }
  revalidatePath("/ordenes");
  revalidatePath("/agenda");
  redirect(`/ordenes/${orden.id}`);
}

export async function cambiarEstadoOrden(id: string, actual: EstadoOrden, nuevo: EstadoOrden): Promise<void> {
  const perfil = await requierePerfil();
  if (!TRANSICIONES_ORDEN[actual].includes(nuevo)) redirect(`/ordenes/${id}?error=transicion`);
  if (perfil.rol === "tecnico" && !ESTADOS_TECNICO.includes(nuevo)) redirect(`/ordenes/${id}?error=permiso`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("ordenes_trabajo").update({ estado: nuevo }).eq("id", id).select("cita_id").maybeSingle();
  if (error) redirect(`/ordenes/${id}?error=${encodeURIComponent(mensajeError(error))}`);
  if (nuevo === "entregada" && data?.cita_id) {
    await supabase.from("citas").update({ estado: "completada" }).eq("id", data.cita_id).in("estado", ["en_curso", "confirmada", "programada"]);
  }
  refrescar(id);
  revalidatePath("/agenda");
}

export async function guardarRecepcion(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const id = String(f.get("id"));
  const km = num(f, "kilometraje_ingreso");
  const descuento = num(f, "descuento") ?? 0;
  if (Number.isNaN(km) || Number.isNaN(descuento) || descuento < 0) return { error: "Revisa kilometraje y descuento." };
  const tc = num(f, "tipo_cambio");
  if (Number.isNaN(tc) || (tc !== null && tc <= 0)) return { error: "Revisa el tipo de cambio." };
  const checklist: Record<string, boolean> = {};
  f.getAll("checklist").forEach((c) => (checklist[String(c)] = true));
  const supabase = await createClient();
  const { error } = await supabase
    .from("ordenes_trabajo")
    .update({
      kilometraje_ingreso: km,
      nivel_combustible: num(f, "nivel_combustible"),
      diagnostico: txt(f, "diagnostico"),
      descuento,
      inventario_vehiculo: { checklist, observaciones: txt(f, "observaciones") },
      ...(tc !== null ? { tipo_cambio: tc } : {}),
    })
    .eq("id", id);
  if (error) return { error: mensajeError(error) };
  refrescar(id);
  return { ok: "Datos de recepción guardados." };
}

export async function agregarTrabajo(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const ordenId = String(f.get("orden_id"));
  const servicioId = txt(f, "servicio_id");
  const descripcion = txt(f, "descripcion");
  const categoriaId = txt(f, "categoria_id");
  if (!servicioId && (!descripcion || !categoriaId)) return { error: "Elige un servicio del catálogo, o escribe la descripción y el tipo de trabajo." };
  const precio = num(f, "precio");
  const horas = num(f, "horas_cobradas");
  if (Number.isNaN(precio) || Number.isNaN(horas)) return { error: "Revisa precio y horas." };
  const supabase = await createClient();
  const { error } = await supabase.from("orden_servicios").insert({
    orden_id: ordenId,
    servicio_id: servicioId,
    categoria_id: categoriaId,
    descripcion,
    tecnico_id: txt(f, "tecnico_id"),
    precio: precio ?? 0,
    horas_cobradas: horas ?? 0,
    aprobado: f.get("aprobado") === "on",
  });
  if (error) return { error: mensajeError(error) };
  refrescar(ordenId);
  return { ok: "Trabajo agregado." };
}

export async function actualizarTrabajo(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const id = String(f.get("id"));
  const ordenId = String(f.get("orden_id"));
  const precio = num(f, "precio");
  const horas = num(f, "horas_cobradas");
  if (precio === null || horas === null || Number.isNaN(precio) || Number.isNaN(horas)) return { error: "Revisa precio y horas." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("orden_servicios")
    .update({ descripcion: txt(f, "descripcion"), tecnico_id: txt(f, "tecnico_id"), precio, horas_cobradas: horas, aprobado: f.get("aprobado") === "on" })
    .eq("id", id);
  if (error) return { error: mensajeError(error) };
  refrescar(ordenId);
  return { ok: "Trabajo actualizado." };
}

export async function eliminarTrabajo(id: string, ordenId: string): Promise<void> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const supabase = await createClient();
  const { error } = await supabase.from("orden_servicios").delete().eq("id", id);
  if (error) redirect(`/ordenes/${ordenId}?error=${encodeURIComponent(mensajeError(error))}`);
  refrescar(ordenId);
}

export async function marcarTrabajoHecho(id: string, ordenId: string, hecho: boolean): Promise<void> {
  await requierePerfil();
  const supabase = await createClient();
  await supabase.from("orden_servicios").update({ completado_en: hecho ? new Date().toISOString() : null }).eq("id", id);
  refrescar(ordenId);
}

/** Reloj del técnico: inicia o detiene el registro de horas reales del trabajo */
export async function alternarReloj(trabajoId: string, ordenId: string): Promise<void> {
  const perfil = await requierePerfil();
  const supabase = await createClient();
  const { data: abierto } = await supabase
    .from("registros_tiempo")
    .select("id")
    .eq("orden_servicio_id", trabajoId)
    .eq("tecnico_id", perfil.id)
    .is("fin", null)
    .maybeSingle();
  const { error } = abierto
    ? await supabase.from("registros_tiempo").update({ fin: new Date().toISOString() }).eq("id", abierto.id)
    : await supabase.from("registros_tiempo").insert({ orden_servicio_id: trabajoId, tecnico_id: perfil.id, inicio: new Date().toISOString() });
  if (error) redirect(`/ordenes/${ordenId}?error=${encodeURIComponent(mensajeError(error))}`);
  // Al iniciar el primer reloj la orden pasa a "En proceso"
  if (!abierto) {
    await supabase.from("ordenes_trabajo").update({ estado: "en_proceso" }).eq("id", ordenId).in("estado", ["abierta", "diagnostico", "esperando_aprobacion", "esperando_piezas"]);
  }
  refrescar(ordenId);
}

export async function agregarPieza(p: {
  orden_id: string;
  orden_servicio_id: string;
  articulo_id: string;
  ubicacion_id: string;
  cantidad: number;
  metodo: "escaneo" | "manual";
}): Promise<Estado> {
  await requierePerfil();
  if (!(p.cantidad > 0)) return { error: "La cantidad debe ser mayor que cero." };
  const supabase = await createClient();
  const { error } = await supabase.from("orden_piezas").insert({
    orden_servicio_id: p.orden_servicio_id,
    articulo_id: p.articulo_id,
    ubicacion_id: p.ubicacion_id,
    cantidad: p.cantidad,
    metodo: p.metodo,
  });
  if (error) {
    if (error.code === "23514") return { error: "No hay suficiente existencia en esa ubicación." };
    if (error.code === "42501") return { error: "Solo puedes agregar piezas a los trabajos asignados a ti." };
    return { error: mensajeError(error) };
  }
  refrescar(p.orden_id);
  revalidatePath("/inventario");
  revalidatePath("/kardex");
  return { ok: "Pieza agregada; se descontó del inventario." };
}

export async function retirarPieza(id: string, ordenId: string): Promise<void> {
  await requierePerfil(["admin", "gerente"]);
  const supabase = await createClient();
  const { error } = await supabase.from("orden_piezas").delete().eq("id", id);
  if (error) redirect(`/ordenes/${ordenId}?error=${encodeURIComponent(mensajeError(error))}`);
  refrescar(ordenId);
  revalidatePath("/kardex");
}

export async function registrarPago(_: Estado, f: FormData): Promise<Estado> {
  await requierePerfil(["admin", "gerente", "recepcion"]);
  const ordenId = String(f.get("orden_id"));
  const montoPagado = num(f, "monto");
  if (!montoPagado || Number.isNaN(montoPagado)) return { error: "Escribe el monto." };
  const supabase = await createClient();
  const { data: o } = await supabase.from("ordenes_trabajo").select("moneda, tipo_cambio").eq("id", ordenId).maybeSingle();
  if (!o) return { error: "No se encontró la orden." };
  // Si pagan en la otra moneda, se convierte a la de la orden con su tipo de cambio
  const monedaPago = txt(f, "moneda_pago") ?? o.moneda;
  let monto = montoPagado;
  if (monedaPago !== o.moneda) {
    const tc = Number(o.tipo_cambio ?? (await supabase.rpc("tipo_cambio_vigente")).data ?? 0);
    if (!tc) return { error: "Registra el tipo de cambio (menú Servicios) para cobrar en otra moneda." };
    monto = Math.round((monedaPago === "USD" ? montoPagado * tc : montoPagado / tc) * 100) / 100;
  }
  const { error } = await supabase.from("pagos").insert({
    orden_id: ordenId,
    monto,
    metodo: txt(f, "metodo") ?? "efectivo",
    referencia: txt(f, "referencia"),
    moneda_original: monedaPago !== o.moneda ? monedaPago : null,
    monto_original: monedaPago !== o.moneda ? montoPagado : null,
  });
  if (error) return { error: mensajeError(error) };
  refrescar(ordenId);
  return { ok: monto > 0 ? "Pago registrado." : "Reembolso registrado." };
}
