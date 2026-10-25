type ErrorPg = { code?: string; message?: string; details?: string | null } | null | undefined;

// Traduce los errores de PostgreSQL / PostgREST a mensajes para el usuario
export function mensajeError(error: ErrorPg): string {
  if (!error) return "Ocurrió un error inesperado.";
  const msg = error.message ?? "";
  switch (error.code) {
    case "23P01":
      if (msg.includes("cita_bahia_sin_traslape")) return "La bahía ya está ocupada en ese horario. Elige otro hueco.";
      if (msg.includes("cita_tecnico_sin_traslape")) return "El técnico ya tiene una cita en ese horario. Elige otro hueco.";
      if (msg.includes("registros_tiempo")) return "Ya tienes otro reloj corriendo. Detenlo antes de iniciar este trabajo.";
      return "Ese horario se cruza con otro registro.";
    case "23505":
      if (msg.includes("vehiculos_placa_uk")) return "Ya existe un vehículo activo con esa placa.";
      if (msg.includes("vin")) return "Ya existe un vehículo con ese VIN.";
      if (msg.includes("documento_fiscal")) return "Ya existe un cliente con ese documento fiscal.";
      return "Ese registro ya existe.";
    case "23514":
      if (msg.includes("cliente_contacto")) return "Captura al menos un teléfono o un correo.";
      if (msg.includes("vin")) return "El VIN debe tener 17 caracteres.";
      if (msg.includes("anio")) return "Revisa el año del vehículo.";
      return "Algún dato no es válido.";
    case "42501":
      return "Tu rol no tiene permiso para esta acción.";
    case "P0001":
      return msg; // mensajes propios de los triggers, ya en español
    default:
      return msg || "Ocurrió un error inesperado.";
  }
}
