"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Rol } from "@/lib/tipos";

const ENLACES: { href: string; texto: string; roles: Rol[] }[] = [
  { href: "/", texto: "Inicio", roles: ["admin", "gerente", "recepcion", "tecnico"] },
  { href: "/agenda", texto: "Agenda", roles: ["admin", "gerente", "recepcion", "tecnico"] },
  { href: "/clientes", texto: "Clientes", roles: ["admin", "gerente", "recepcion", "tecnico"] },
];

const PROXIMOS: { texto: string; roles: Rol[] }[] = [
  { texto: "Órdenes de trabajo", roles: ["admin", "gerente", "recepcion", "tecnico"] },
  { texto: "Inventario", roles: ["admin", "gerente", "recepcion", "tecnico"] },
  { texto: "Reportes", roles: ["admin", "gerente"] },
];

export default function Nav({ rol }: { rol: Rol }) {
  const ruta = usePathname();
  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));
  return (
    <nav className="nav" aria-label="Principal">
      {ENLACES.filter((e) => e.roles.includes(rol)).map((e) => (
        <Link key={e.href} href={e.href} aria-current={activo(e.href) ? "page" : undefined}>
          {e.texto}
        </Link>
      ))}
      {PROXIMOS.filter((e) => e.roles.includes(rol)).map((e) => (
        <span key={e.texto} className="soon">
          {e.texto} <small>pronto</small>
        </span>
      ))}
    </nav>
  );
}
