"use client";

import { useActionState, useState } from "react";
import { CANALES } from "@/lib/tipos";
import CamposVehiculo from "./CamposVehiculo";
import type { Estado } from "@/app/(app)/clientes/actions";

export type ClienteForm = {
  id?: string;
  tipo?: string;
  nombre?: string;
  apellidos?: string | null;
  razon_social?: string | null;
  documento_fiscal?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  canal_preferido?: string;
  acepta_marketing?: boolean;
  origen?: string | null;
  notas?: string | null;
};

export default function FormCliente({
  accion,
  inicial = {},
  conVehiculo = false,
  textoBoton = "Guardar",
}: {
  accion: (e: Estado, f: FormData) => Promise<Estado>;
  inicial?: ClienteForm;
  conVehiculo?: boolean;
  textoBoton?: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [tipo, setTipo] = useState(inicial.tipo ?? "persona");
  const v = (x?: string | null) => x ?? "";

  return (
    <form action={enviar} className="form">
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      {estado.error && <div className="alert error" role="alert">{estado.error}</div>}
      {estado.ok && <div className="alert ok" role="status">{estado.ok}</div>}

      <div className="fields">
        <div className="field">
          <label htmlFor="tipo">Tipo de cliente</label>
          <select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="persona">Persona</option>
            <option value="empresa">Empresa / flotilla</option>
          </select>
        </div>
        {tipo === "empresa" && (
          <div className="field">
            <label htmlFor="razon_social">Razón social</label>
            <input id="razon_social" name="razon_social" defaultValue={v(inicial.razon_social)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="nombre">{tipo === "empresa" ? "Nombre del contacto" : "Nombre"}</label>
          <input id="nombre" name="nombre" required defaultValue={v(inicial.nombre)} />
        </div>
        <div className="field">
          <label htmlFor="apellidos">Apellidos</label>
          <input id="apellidos" name="apellidos" defaultValue={v(inicial.apellidos)} />
        </div>
        <div className="field">
          <label htmlFor="telefono">Teléfono</label>
          <input id="telefono" name="telefono" type="tel" inputMode="tel" defaultValue={v(inicial.telefono)} />
        </div>
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" defaultValue={v(inicial.email)} />
        </div>
        <div className="field">
          <label htmlFor="documento_fiscal">RUC / DNI</label>
          <input id="documento_fiscal" name="documento_fiscal" autoCapitalize="characters" defaultValue={v(inicial.documento_fiscal)} />
        </div>
        <div className="field">
          <label htmlFor="canal_preferido">Canal preferido</label>
          <select id="canal_preferido" name="canal_preferido" defaultValue={inicial.canal_preferido ?? "whatsapp"}>
            {Object.entries(CANALES)
              .filter(([k]) => k !== "nota")
              .map(([k, t]) => (
                <option key={k} value={k}>{t}</option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="origen">¿Cómo nos conoció?</label>
          <input id="origen" name="origen" list="origenes" defaultValue={v(inicial.origen)} />
          <datalist id="origenes">
            {["Recomendación", "Google", "Facebook", "Instagram", "Pasaba por aquí", "Cliente anterior"].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
        <div className="field wide">
          <label htmlFor="direccion">Dirección</label>
          <input id="direccion" name="direccion" defaultValue={v(inicial.direccion)} />
        </div>
        <div className="field wide">
          <label htmlFor="notas">Notas</label>
          <textarea id="notas" name="notas" defaultValue={v(inicial.notas)} />
        </div>
        <label className="check field wide" htmlFor="acepta_marketing">
          <input id="acepta_marketing" name="acepta_marketing" type="checkbox" defaultChecked={inicial.acepta_marketing ?? false} />
          Acepta recibir promociones y campañas
        </label>
      </div>

      {conVehiculo && (
        <>
          <h3>Vehículo <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 400 }}>(opcional, se puede agregar después)</span></h3>
          <CamposVehiculo requerido={false} />
        </>
      )}

      <div className="row">
        <button className="btn primary" type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : textoBoton}
        </button>
      </div>
    </form>
  );
}
