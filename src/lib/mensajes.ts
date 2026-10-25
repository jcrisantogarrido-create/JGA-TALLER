// Plantillas de mensajes y enlaces para WhatsApp, SMS y correo

export const NOMBRE_TALLER = "Taller JGA";

export type DatosMensaje = Partial<Record<"nombre" | "placa" | "vehiculo" | "servicio" | "fecha" | "hora" | "taller" | "total", string>>;

export function rellenar(plantilla: string, datos: DatosMensaje): string {
  const d: DatosMensaje = { taller: NOMBRE_TALLER, ...datos };
  return plantilla.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: keyof DatosMensaje) => d[k] ?? "");
}

/** Número en formato internacional sin signos. Si ya trae lada de país (más de 10 dígitos) se respeta. */
export function telefonoInternacional(tel: string | null | undefined, prefijo: string): string | null {
  if (!tel) return null;
  const limpio = tel.trim();
  const digitos = limpio.replace(/\D/g, "");
  if (digitos.length < 7) return null;
  if (limpio.startsWith("+") || digitos.length > 10) return digitos;
  return `${prefijo.replace(/\D/g, "")}${digitos}`;
}

export function enlaceMensaje(canal: string, contacto: { telefono?: string | null; email?: string | null }, prefijo: string, texto: string, asunto?: string | null): string | null {
  if (canal === "email") {
    if (!contacto.email) return null;
    return `mailto:${contacto.email}?subject=${encodeURIComponent(asunto ?? NOMBRE_TALLER)}&body=${encodeURIComponent(texto)}`;
  }
  const tel = telefonoInternacional(contacto.telefono, prefijo);
  if (!tel) return null;
  if (canal === "sms") return `sms:+${tel}?body=${encodeURIComponent(texto)}`;
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

// El canal para enviar: el preferido del cliente si es de mensaje, si no WhatsApp o correo según lo que haya
export function canalDeEnvio(preferido: string | null | undefined, contacto: { telefono?: string | null; email?: string | null }): "whatsapp" | "sms" | "email" {
  if (preferido === "email" && contacto.email) return "email";
  if (preferido === "sms" && contacto.telefono) return "sms";
  if (contacto.telefono) return "whatsapp";
  return "email";
}
