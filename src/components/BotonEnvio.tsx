"use client";

import { useState, useTransition } from "react";
import { registrarEnvio, type Envio } from "@/app/(app)/comunicacion/actions";

const TEXTO = { whatsapp: "WhatsApp", sms: "SMS", email: "Correo" } as const;

// Abre WhatsApp/SMS/correo con el mensaje listo y lo deja registrado en la bitácora del cliente
export default function BotonEnvio({ enlace, envio, etiqueta, principal = true }: { enlace: string | null; envio: Envio; etiqueta?: string; principal?: boolean }) {
  const [hecho, setHecho] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  if (!enlace) return <span className="muted" style={{ fontSize: 13 }}>Sin {envio.canal === "email" ? "correo" : "teléfono"}</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <a
        className={`btn small ${principal && !hecho ? "primary" : ""}`}
        href={enlace}
        target={envio.canal === "whatsapp" ? "_blank" : undefined}
        rel="noreferrer"
        onClick={() =>
          start(async () => {
            const r = await registrarEnvio(envio);
            if (r.error) setError(r.error);
            else setHecho(true);
          })
        }
        aria-disabled={pendiente}
      >
        {hecho ? "Enviado ✓" : etiqueta ?? TEXTO[envio.canal]}
      </a>
      {error && <span className="muted" style={{ fontSize: 12 }}>{error}</span>}
    </span>
  );
}
