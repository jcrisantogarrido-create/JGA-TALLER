import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { obtenerSucursales, requierePerfil } from "@/lib/sesion";
import { ROLES, type Rol } from "@/lib/tipos";
import FormSimple from "@/components/FormSimple";
import { guardarHorario, guardarPerfil } from "./actions";

export const metadata: Metadata = { title: "Equipo" };

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type Persona = {
  id: string; nombre: string; rol: Rol; sucursal_id: string | null; telefono: string | null; costo_hora: number; activo: boolean;
  horarios_tecnico: { dia_semana: number; hora_inicio: string; hora_fin: string }[];
};
type Cuenta = { id: string; email: string; creado: string; ultimo_acceso: string | null; tiene_perfil: boolean };

export default async function EquipoPage({ searchParams }: { searchParams: Promise<{ alta?: string }> }) {
  const { alta } = await searchParams;
  const yo = await requierePerfil(["admin", "gerente"]);
  const admin = yo.rol === "admin";
  const supabase = await createClient();
  const [{ data: personasData }, cuentasRes, sucursales] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, rol, sucursal_id, telefono, costo_hora, activo, horarios_tecnico(dia_semana, hora_inicio, hora_fin)").order("activo", { ascending: false }).order("nombre"),
    admin ? supabase.rpc("usuarios_equipo") : Promise.resolve({ data: [] }),
    obtenerSucursales(),
  ]);
  const personas = (personasData as Persona[]) ?? [];
  const cuentas = (cuentasRes.data as Cuenta[]) ?? [];
  const correo = new Map(cuentas.map((c) => [c.id, c.email]));
  const sinPerfil = cuentas.filter((c) => !c.tiene_perfil);
  const tecnicos = personas.filter((p) => p.rol === "tecnico" && p.activo);

  const camposPerfil = (p: Partial<Persona> & { id: string }, nuevo: boolean) => (
    <>
      <input type="hidden" name="id" value={p.id} />
      {nuevo && <input type="hidden" name="nuevo" value="1" />}
      <div className="fields">
        <div className="field"><label htmlFor={`pf-n-${p.id}`}>Nombre</label><input id={`pf-n-${p.id}`} name="nombre" required defaultValue={p.nombre ?? ""} placeholder="Nombre y apellido" /></div>
        <div className="field">
          <label htmlFor={`pf-r-${p.id}`}>Rol</label>
          <select id={`pf-r-${p.id}`} name="rol" required defaultValue={p.rol ?? ""}>
            <option value="" disabled>Elige…</option>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`pf-s-${p.id}`}>Sucursal</label>
          <select id={`pf-s-${p.id}`} name="sucursal_id" defaultValue={p.sucursal_id ?? (nuevo ? sucursales[0]?.id ?? "" : "")}>
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor={`pf-t-${p.id}`}>Teléfono</label><input id={`pf-t-${p.id}`} name="telefono" type="tel" defaultValue={p.telefono ?? ""} /></div>
        <div className="field"><label htmlFor={`pf-c-${p.id}`}>Costo por hora (técnicos)</label><input id={`pf-c-${p.id}`} name="costo_hora" inputMode="decimal" defaultValue={p.costo_hora ?? 0} /></div>
        {!nuevo && <label className="row" style={{ gap: 6, fontWeight: 400 }}><input type="checkbox" name="activo" defaultChecked={p.activo} /> Activo</label>}
      </div>
    </>
  );

  return (
    <>
      <div className="head">
        <div>
          <h1>Equipo</h1>
          <p className="sub">Roles, sucursal y turnos. La agenda solo ofrece horarios de técnicos activos con turno ese día.</p>
        </div>
      </div>

      {alta && <div className="alert ok" role="status">{alta}</div>}

      {admin && (
        <section className="panel">
          <h2>Cuentas sin rol <span className="muted mono" style={{ fontSize: 13 }}>{sinPerfil.length}</span></h2>
          {sinPerfil.length === 0 ? (
            <p className="muted">Todas las cuentas tienen rol.</p>
          ) : (
            sinPerfil.map((c) => (
              <div key={c.id} className="trabajo">
                <b>{c.email}</b>
                <FormSimple accion={guardarPerfil} textoBoton="Dar acceso" limpiar={false}>{camposPerfil({ id: c.id }, true)}</FormSimple>
              </div>
            ))
          )}
          <p className="muted" style={{ fontSize: 13 }}>
            Para sumar a alguien: en Supabase → Authentication → Users pulsa “Add user”, escribe su correo y una contraseña, y marca “Auto Confirm User”. Al volver aquí aparecerá en esta lista para darle rol.
          </p>
        </section>
      )}

      <section className="panel">
        <h2>Personas <span className="muted mono" style={{ fontSize: 13 }}>{personas.filter((p) => p.activo).length}</span></h2>
        <ul className="list">
          {personas.map((p) => (
            <li key={p.id} style={{ opacity: p.activo ? 1 : 0.55 }}>
              <div className="row">
                <b>{p.nombre}</b>
                <span className="chip">{ROLES[p.rol]}</span>
                {!p.activo && <span className="chip cancelada">Inactivo</span>}
                {p.rol === "tecnico" && p.horarios_tecnico.length === 0 && p.activo && <span className="chip bajo">Sin turno: no aparece en la agenda</span>}
              </div>
              <div className="meta">
                {correo.get(p.id) && <span>{correo.get(p.id)}</span>}
                <span>{sucursales.find((s) => s.id === p.sucursal_id)?.nombre ?? "Todas las sucursales"}</span>
                {p.rol === "tecnico" && p.horarios_tecnico.length > 0 && (
                  <span>{[...p.horarios_tecnico].sort((a, b) => ((a.dia_semana + 6) % 7) - ((b.dia_semana + 6) % 7)).map((h) => `${DIAS[h.dia_semana].slice(0, 3)} ${h.hora_inicio.slice(0, 5)}–${h.hora_fin.slice(0, 5)}`).join(" · ")}</span>
                )}
              </div>
              {admin && (
                <details>
                  <summary className="btn small">Editar</summary>
                  <div style={{ marginTop: 10 }}>
                    <FormSimple accion={guardarPerfil} textoBoton="Guardar" limpiar={false}>{camposPerfil(p, false)}</FormSimple>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Turnos de los técnicos</h2>
        {tecnicos.length === 0 ? (
          <div className="empty">No hay técnicos activos. {admin ? "Da el rol “Técnico” a alguien arriba." : "Pide a administración que registre a los técnicos."}</div>
        ) : (
          tecnicos.map((t) => {
            const por = new Map(t.horarios_tecnico.map((h) => [h.dia_semana, h]));
            return (
              <div key={t.id} className="trabajo">
                <b>{t.nombre}</b>
                <FormSimple accion={guardarHorario} textoBoton="Guardar turno" limpiar={false}>
                  <input type="hidden" name="tecnico_id" value={t.id} />
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Día</th><th>Trabaja</th><th>Entrada</th><th>Salida</th></tr></thead>
                      <tbody>
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                          const h = por.get(d);
                          return (
                            <tr key={d}>
                              <td>{DIAS[d]}</td>
                              <td><input type="checkbox" name={`on_${d}`} aria-label={`Trabaja el ${DIAS[d]}`} defaultChecked={!!h} /></td>
                              <td><input type="time" name={`ini_${d}`} aria-label={`Entrada ${DIAS[d]}`} defaultValue={h?.hora_inicio.slice(0, 5) ?? "08:00"} /></td>
                              <td><input type="time" name={`fin_${d}`} aria-label={`Salida ${DIAS[d]}`} defaultValue={h?.hora_fin.slice(0, 5) ?? "18:00"} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </FormSimple>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
