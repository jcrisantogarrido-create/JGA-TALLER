"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mensajeError } from "@/lib/errores";

export type Estado = { error?: string; ok?: string };

const txt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function datosCliente(f: FormData) {
  return {
    tipo: txt(f, "tipo") ?? "persona",
    nombre: txt(f, "nombre"),
    apellidos: txt(f, "apellidos"),
    razon_social: txt(f, "razon_social"),
    documento_fiscal: txt(f, "documento_fiscal")?.toUpperCase() ?? null,
    telefono: txt(f, "telefono"),
    email: txt(f, "email"),
    direccion: txt(f, "direccion"),
    canal_preferido: txt(f, "canal_preferido") ?? "whatsapp",
    acepta_marketing: f.get("acepta_marketing") === "on",
    origen: txt(f, "origen"),
    notas: txt(f, "notas"),
  };
}

function datosVehiculo(f: FormData) {
  const km = txt(f, "kilometraje_actual");
  return {
    placa: txt(f, "placa")?.toUpperCase() ?? null,
    marca: txt(f, "marca"),
    modelo: txt(f, "modelo"),
    anio: Number(txt(f, "anio")),
    tipo: txt(f, "tipo_vehiculo") ?? "sedan",
    color: txt(f, "color"),
    vin: txt(f, "vin")?.toUpperCase() ?? null,
    kilometraje_actual: km ? Number(km.replace(/\D/g, "")) : null,
  };
}

export async function crearCliente(_: Estado, f: FormData): Promise<Estado> {
  const cliente = datosCliente(f);
  if (!cliente.nombre) return { error: "Escribe el nombre del cliente." };

  const vehiculo = datosVehiculo(f);
  const conVehiculo = Boolean(vehiculo.placa);
  if (conVehiculo && (!vehiculo.marca || !vehiculo.modelo || !vehiculo.anio)) {
    return { error: "Para registrar el vehículo completa placa, marca, modelo y año." };
  }

  const supabase = await createClient();
  if (conVehiculo) {
    const placaNorm = vehiculo.placa!.replace(/[^A-Z0-9]/g, "");
    const { data: existente } = await supabase
      .from("vehiculos")
      .select("placa, clientes(nombre, apellidos)")
      .eq("placa_norm", placaNorm)
      .eq("activo", true)
      .maybeSingle();
    if (existente) {
      const propietario = existente.clientes as unknown as { nombre: string; apellidos: string | null } | null;
      return { error: `La placa ${existente.placa} ya está registrada${propietario ? ` a nombre de ${propietario.nombre} ${propietario.apellidos ?? ""}`.trimEnd() : ""}. Búscala en Clientes.` };
    }
  }
  const { data, error } = await supabase.from("clientes").insert(cliente).select("id").single();
  if (error) return { error: mensajeError(error) };

  if (conVehiculo) {
    const { error: errV } = await supabase.from("vehiculos").insert({ ...vehiculo, cliente_id: data.id });
    if (errV) {
      // El cliente ya quedó guardado: se avisa y se manda a su ficha para corregir el vehículo
      redirect(`/clientes/${data.id}?aviso=${encodeURIComponent("Cliente guardado, pero el vehículo no: " + mensajeError(errV))}`);
    }
  }
  revalidatePath("/clientes");
  redirect(`/clientes/${data.id}`);
}

export async function actualizarCliente(_: Estado, f: FormData): Promise<Estado> {
  const id = String(f.get("id"));
  const cliente = datosCliente(f);
  if (!cliente.nombre) return { error: "Escribe el nombre del cliente." };
  const supabase = await createClient();
  const { error } = await supabase.from("clientes").update(cliente).eq("id", id);
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/clientes/${id}`);
  return { ok: "Datos guardados." };
}

export async function agregarVehiculo(_: Estado, f: FormData): Promise<Estado> {
  const clienteId = String(f.get("cliente_id"));
  const vehiculo = datosVehiculo(f);
  if (!vehiculo.placa || !vehiculo.marca || !vehiculo.modelo || !vehiculo.anio) {
    return { error: "Completa placa, marca, modelo y año." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("vehiculos").insert({ ...vehiculo, cliente_id: clienteId });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/clientes/${clienteId}`);
  return { ok: `Vehículo ${vehiculo.placa} agregado.` };
}

export async function registrarComunicacion(_: Estado, f: FormData): Promise<Estado> {
  const clienteId = String(f.get("cliente_id"));
  const contenido = txt(f, "contenido");
  if (!contenido) return { error: "Escribe qué se habló o la nota." };
  const canal = txt(f, "canal") ?? "nota";
  const supabase = await createClient();
  const { error } = await supabase.from("comunicaciones").insert({
    cliente_id: clienteId,
    vehiculo_id: txt(f, "vehiculo_id"),
    canal,
    direccion: canal === "nota" ? "interna" : (txt(f, "direccion") ?? "saliente"),
    asunto: txt(f, "asunto"),
    contenido,
  });
  if (error) return { error: mensajeError(error) };
  revalidatePath(`/clientes/${clienteId}`);
  return { ok: "Registrado en la bitácora." };
}
