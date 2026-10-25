"use client";

import { useActionState } from "react";
import { iniciarSesion, type EstadoLogin } from "./actions";

export default function FormLogin({ siguiente }: { siguiente: string }) {
  const [estado, accion, enviando] = useActionState<EstadoLogin, FormData>(iniciarSesion, {});
  return (
    <form action={accion} className="form">
      <input type="hidden" name="siguiente" value={siguiente} />
      {estado.error && <div className="alert error">{estado.error}</div>}
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn primary" type="submit" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
