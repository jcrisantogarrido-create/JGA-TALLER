import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { obtenerPerfil, sucursalActiva } from "@/lib/sesion";
import { TIPOS_MOVIMIENTO, type TipoMovimiento } from "@/lib/tipos";
import { consultaKardex, saldoDe, type FilaKardex, type ModoSaldo } from "@/lib/kardex";

// Descarga del kardex filtrado como CSV (abre directo en Excel)
export async function GET(req: NextRequest) {
  const perfil = await obtenerPerfil();
  if (!perfil) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const sucursal = await sucursalActiva(perfil, sp.sucursal);
  if (!sucursal) return NextResponse.json({ error: "Sin sucursal" }, { status: 400 });
  const todas = !perfil.sucursal_id && sp.sucursal === "todas";
  const tz = sucursal.zona_horaria;

  const supabase = await createClient();
  const { consulta, desde, hasta } = consultaKardex(supabase, { ...sp, sucursal: todas ? undefined : sucursal.id }, tz, 50000);
  const { data, error } = await consulta;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const modo: ModoSaldo = sp.ubicacion ? "ubicacion" : todas ? "total" : "sucursal";

  const fecha = new Intl.DateTimeFormat("es-MX", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const celda = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const encabezado = ["Fecha", "SKU", "Artículo", "Unidad", "Sucursal", "Ubicación", "Movimiento", "Documento", "Referencia", "Proveedor / motivo",
    "Entrada", "Salida", "Saldo", "Costo unitario", "Costo promedio", "Valor movimiento", "Valor saldo", "Usuario", "Captura"];
  const lineas = ((data as FilaKardex[]) ?? []).map((f) => {
    const saldo = saldoDe(f, modo);
    return [
      fecha.format(new Date(f.fecha)), f.sku, f.articulo, f.unidad, f.sucursal, f.ubicacion,
      TIPOS_MOVIMIENTO[f.tipo as TipoMovimiento] ?? f.tipo, f.documento, f.referencia, f.proveedor ?? f.motivo,
      f.entrada || "", f.salida || "", saldo, f.costo_unitario, f.costo_promedio, f.valor_movimiento,
      (saldo * Number(f.costo_promedio ?? 0)).toFixed(2), f.usuario ?? "Sistema", f.metodo,
    ].map(celda).join(",");
  });
  const csv = "﻿" + [encabezado.join(","), ...lineas].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kardex_${desde}_a_${hasta}.csv"`,
    },
  });
}
