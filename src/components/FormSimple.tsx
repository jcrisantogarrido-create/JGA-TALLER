"use client";

import { useActionState, useEffect, useRef } from "react";

type Estado = { error?: string; ok?: string };

// Formulario genérico para Server Actions: muestra error/ok y se limpia al guardar
export default function FormSimple({
  accion,
  children,
  textoBoton,
  limpiar = true,
}: {
  accion: (e: Estado, f: FormData) => Promise<Estado>;
  children: React.ReactNode;
  textoBoton: string;
  limpiar?: boolean;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok && limpiar) ref.current?.reset();
  }, [estado, limpiar]);
  return (
    <form ref={ref} action={enviar} className="form">
      {estado.error && <div className="alert error" role="alert">{estado.error}</div>}
      {estado.ok && <div className="alert ok" role="status">{estado.ok}</div>}
      {children}
      <div className="row">
        <button className="btn primary" type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : textoBoton}
        </button>
      </div>
    </form>
  );
}
