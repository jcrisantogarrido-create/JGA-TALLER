export type Rol = "admin" | "gerente" | "recepcion" | "tecnico";

export type Perfil = {
  id: string;
  nombre: string;
  rol: Rol;
  sucursal_id: string | null;
};

export type Sucursal = { id: string; nombre: string; zona_horaria: string };

export type EstadoCita = "programada" | "confirmada" | "en_curso" | "completada" | "cancelada" | "no_asistio";

export const ESTADOS_CITA: Record<EstadoCita, string> = {
  programada: "Programada",
  confirmada: "Confirmada",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
  no_asistio: "No asistió",
};

// Cambios de estado permitidos desde la pantalla de la cita
export const TRANSICIONES_CITA: Record<EstadoCita, EstadoCita[]> = {
  programada: ["confirmada", "en_curso", "cancelada", "no_asistio"],
  confirmada: ["en_curso", "cancelada", "no_asistio"],
  en_curso: ["completada"],
  completada: [],
  cancelada: ["programada"],
  no_asistio: ["programada"],
};

export const ESTADOS_ACTIVOS: EstadoCita[] = ["programada", "confirmada", "en_curso"];

export const TIPOS_VEHICULO = {
  sedan: "Sedán",
  hatchback: "Hatchback",
  suv: "SUV",
  pickup: "Pickup",
  van: "Van",
  moto: "Moto",
  camion: "Camión",
  otro: "Otro",
} as const;

export const CANALES = {
  whatsapp: "WhatsApp",
  llamada: "Llamada",
  sms: "SMS",
  email: "Email",
  visita: "Visita",
  nota: "Nota interna",
} as const;

export const ROLES: Record<Rol, string> = {
  admin: "Administración",
  gerente: "Gerencia",
  recepcion: "Recepción",
  tecnico: "Técnico",
};
