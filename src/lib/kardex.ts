import type { createClient } from "@/lib/supabase/server";
import { localAInstante, sumarDias, fechaLocal } from "@/lib/fechas";

export type FilaKardex = {
  id: number;
  fecha: string;
  articulo_id: string;
  sku: string;
  articulo: string;
  unidad: string;
  sucursal: string | null;
  ubicacion_id: string;
  ubicacion: string;
  tipo: string;
  entrada: number;
  salida: number;
  cantidad: number;
  costo_unitario: number | null;
  valor_movimiento: number;
  saldo_ubicacion: number | null;
  saldo_sucursal: number | null;
  saldo_total: number | null;
  costo_promedio: number | null;
  documento: string | null;
  referencia: string | null;
  motivo: string | null;
  proveedor: string | null;
  usuario: string | null;
  metodo: string;
};

export type FiltrosKardex = {
  desde?: string;
  hasta?: string;
  q?: string;
  articulo?: string;
  tipo?: string;
  ubicacion?: string;
  sucursal?: string;
};

/** Saldo que corresponde mostrar según el filtro: ubicación, sucursal o total */
export type ModoSaldo = "ubicacion" | "sucursal" | "total";

export function rangoPorDefecto(tz: string) {
  const hoy = fechaLocal(new Date(), tz);
  return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
}

export function consultaKardex(
  supabase: Awaited<ReturnType<typeof createClient>>,
  f: FiltrosKardex,
  tz: string,
  limite: number,
) {
  const def = rangoPorDefecto(tz);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(f.desde ?? "") ? f.desde! : def.desde;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(f.hasta ?? "") ? f.hasta! : def.hasta;
  let c = supabase
    .from("v_kardex")
    .select("*")
    .gte("fecha", localAInstante(desde, "00:00", tz).toISOString())
    .lt("fecha", localAInstante(sumarDias(hasta, 1), "00:00", tz).toISOString())
    .order("fecha", { ascending: true })
    .order("id", { ascending: true })
    .limit(limite);
  if (f.sucursal) c = c.eq("sucursal_id", f.sucursal);
  if (f.articulo) c = c.eq("articulo_id", f.articulo);
  if (f.ubicacion) c = c.eq("ubicacion_id", f.ubicacion);
  if (f.tipo === "entradas") c = c.gt("cantidad", 0);
  else if (f.tipo === "salidas") c = c.lt("cantidad", 0);
  else if (f.tipo) c = c.eq("tipo", f.tipo);
  const q = (f.q ?? "").trim().replace(/[,()%*\\]/g, " ").slice(0, 60);
  if (q) c = c.or(`articulo.ilike.%${q}%,sku.ilike.%${q}%,codigo_barras.ilike.%${q}%,referencia.ilike.%${q}%,documento.ilike.%${q}%`);
  return { consulta: c, desde, hasta };
}

export function saldoDe(f: FilaKardex, modo: ModoSaldo) {
  return Number(modo === "ubicacion" ? f.saldo_ubicacion : modo === "sucursal" ? f.saldo_sucursal : f.saldo_total);
}
