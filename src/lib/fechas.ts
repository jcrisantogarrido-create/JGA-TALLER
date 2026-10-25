// Utilidades de fecha en la zona horaria de la sucursal (no la del navegador ni la del servidor)

function offsetMinutos(tz: string, instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return (comoUtc - instante.getTime()) / 60000;
}

/** "2026-10-26" + "10:30" en tz → Date (instante real) */
export function localAInstante(fecha: string, hora: string, tz: string): Date {
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  let instante = new Date(supuesto - offsetMinutos(tz, new Date(supuesto)) * 60000);
  instante = new Date(supuesto - offsetMinutos(tz, instante) * 60000); // corrige cambios de horario
  return instante;
}

/** Fecha local YYYY-MM-DD de un instante en tz */
export function fechaLocal(instante: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}

/** Minutos desde medianoche local */
export function minutosDelDia(instante: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(instante);
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}

export function hora(instante: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("es-PE", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instante));
}

export function fechaLarga(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const texto = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function fechaHora(instante: string | Date, tz: string): string {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instante));
}

export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function dinero(n: number | string | null | undefined, moneda: string = "PEN"): string {
  const f = new Intl.NumberFormat("es-PE", { style: "currency", currency: moneda === "USD" ? "USD" : "PEN" }).format(Number(n ?? 0));
  return moneda === "USD" ? f.replace("USD", "US$") : f;
}
