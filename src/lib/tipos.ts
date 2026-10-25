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

export type TipoMovimiento =
  | "entrada_compra" | "salida_orden" | "devolucion_orden" | "ajuste_positivo" | "ajuste_negativo"
  | "transferencia_entrada" | "transferencia_salida" | "merma";

export const TIPOS_MOVIMIENTO: Record<TipoMovimiento, string> = {
  entrada_compra: "Entrada por compra",
  salida_orden: "Salida a orden de trabajo",
  devolucion_orden: "Devolución de orden",
  ajuste_positivo: "Ajuste (+)",
  ajuste_negativo: "Ajuste (−)",
  transferencia_entrada: "Transferencia entrada",
  transferencia_salida: "Transferencia salida",
  merma: "Merma",
};

// Movimientos que se registran a mano desde el kardex (los de órdenes los genera el sistema)
export const MOVIMIENTOS_MANUALES: { tipo: TipoMovimiento; texto: string; signo: 1 | -1; ayuda: string }[] = [
  { tipo: "entrada_compra", texto: "Entrada por compra", signo: 1, ayuda: "Mercancía que llega del proveedor. Actualiza el costo promedio." },
  { tipo: "ajuste_positivo", texto: "Ajuste positivo", signo: 1, ayuda: "Sobrante de conteo físico u otra corrección." },
  { tipo: "ajuste_negativo", texto: "Salida / ajuste negativo", signo: -1, ayuda: "Consumo interno, faltante de conteo u otra salida." },
  { tipo: "merma", texto: "Merma", signo: -1, ayuda: "Producto dañado, caducado o derramado." },
];

export const TIPOS_ARTICULO = {
  pieza: "Pieza / refacción",
  insumo: "Insumo",
  consumible: "Consumible",
  quimico_detailing: "Químico de detailing",
  accesorio: "Accesorio",
} as const;

export const ESTADOS_STOCK = {
  agotado: "Agotado",
  bajo: "Bajo mínimo",
  exceso: "Exceso",
  ok: "Suficiente",
} as const;

export const puedeGestionarInventario = (rol: Rol) => rol === "admin" || rol === "gerente";
