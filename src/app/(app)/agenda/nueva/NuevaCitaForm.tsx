"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { buscarClientes, buscarHuecos, crearCita, type ClienteBusqueda, type Hueco } from "../actions";
import { CANALES, type Sucursal } from "@/lib/tipos";

type Servicio = {
  id: string;
  nombre: string;
  horas_estandar: number;
  tipo_bahia_requerida: string | null;
  precio_base: number;
  categorias_servicio: { nombre: string } | null;
};

const fmtHora = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export default function NuevaCitaForm({
  sucursal,
  fechaInicial,
  hoy,
  clienteInicial,
  servicios,
  bahias,
  tecnicos,
}: {
  sucursal: Sucursal;
  fechaInicial: string;
  hoy: string;
  clienteInicial: ClienteBusqueda | null;
  servicios: Servicio[];
  bahias: { id: string; nombre: string; tipo: string }[];
  tecnicos: { id: string; nombre: string; especialidades: string[] }[];
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClienteBusqueda[]>([]);
  const [cliente, setCliente] = useState<ClienteBusqueda | null>(clienteInicial);
  const [vehiculoId, setVehiculoId] = useState<string>(clienteInicial?.vehiculos.find((v) => v.activo)?.id ?? "");
  const [servicioId, setServicioId] = useState<string>("");
  const [duracion, setDuracion] = useState(60);
  const [tipoBahia, setTipoBahia] = useState<string>("");
  const [fecha, setFecha] = useState(fechaInicial);
  const [huecos, setHuecos] = useState<Hueco[] | null>(null);
  const [horaSel, setHoraSel] = useState<string | null>(null);
  const [opcionSel, setOpcionSel] = useState<Hueco | null>(null);
  const [motivo, setMotivo] = useState("");
  const [canal, setCanal] = useState("llamada");
  const [error, setError] = useState<string | null>(null);
  const [buscando, startBuscar] = useTransition();
  const [cargandoHuecos, startHuecos] = useTransition();
  const [guardando, startGuardar] = useTransition();

  const nombreBahia = (id: string) => bahias.find((b) => b.id === id)?.nombre ?? "Bahía";
  const nombreTecnico = (id: string) => tecnicos.find((t) => t.id === id)?.nombre ?? "Técnico";
  const tiposBahia = useMemo(() => [...new Set(bahias.map((b) => b.tipo))], [bahias]);

  // Búsqueda de cliente con pausa al teclear
  useEffect(() => {
    if (cliente || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(() => startBuscar(async () => setResultados(await buscarClientes(q))), 250);
    return () => clearTimeout(t);
  }, [q, cliente]);

  // Al elegir servicio se proponen duración y tipo de bahía
  function elegirServicio(id: string) {
    setServicioId(id);
    const s = servicios.find((x) => x.id === id);
    if (s) {
      setDuracion(Math.round(Number(s.horas_estandar) * 60));
      setTipoBahia(s.tipo_bahia_requerida ?? "");
    }
    setHuecos(null);
  }

  // Cualquier cambio en los criterios invalida los huecos mostrados
  useEffect(() => {
    setHuecos(null);
    setHoraSel(null);
    setOpcionSel(null);
  }, [fecha, duracion, tipoBahia]);

  function verHuecos() {
    setError(null);
    startHuecos(async () => {
      const r = await buscarHuecos({ sucursalId: sucursal.id, fecha, duracionMin: duracion, tipoBahia: tipoBahia || null });
      if (r.error) setError(r.error);
      setHuecos(r.huecos ?? []);
      setHoraSel(null);
      setOpcionSel(null);
    });
  }

  const porHora = useMemo(() => {
    const m = new Map<string, Hueco[]>();
    (huecos ?? []).forEach((h) => m.set(h.inicio, [...(m.get(h.inicio) ?? []), h]));
    return [...m.entries()];
  }, [huecos]);

  function guardar() {
    if (!cliente || !vehiculoId || !opcionSel) return;
    setError(null);
    startGuardar(async () => {
      const r = await crearCita({
        sucursal_id: sucursal.id,
        cliente_id: cliente.id,
        vehiculo_id: vehiculoId,
        servicio_id: servicioId || null,
        bahia_id: opcionSel.bahia_id,
        tecnico_id: opcionSel.tecnico_id,
        inicio: opcionSel.inicio,
        fin: opcionSel.fin,
        motivo_cliente: motivo.trim() || null,
        canal_origen: canal,
        zona_horaria: sucursal.zona_horaria,
      });
      if (r?.error) {
        setError(r.error);
        verHuecos(); // otra persona pudo tomar el hueco: se recargan
      }
    });
  }

  const vehiculosActivos = cliente?.vehiculos.filter((v) => v.activo) ?? [];

  return (
    <div className="grid2">
      <section className="panel">
        <h2>1 · Cliente y vehículo</h2>
        {cliente ? (
          <div className="form">
            <div className="row">
              <b>{cliente.nombre} {cliente.apellidos ?? ""}</b>
              <span className="muted num">{cliente.telefono}</span>
              <button type="button" className="btn small" onClick={() => { setCliente(null); setVehiculoId(""); setQ(""); }}>
                Cambiar
              </button>
            </div>
            {vehiculosActivos.length === 0 ? (
              <div className="alert error">
                Este cliente no tiene vehículos. <a href={`/clientes/${cliente.id}`}>Agrégalo en su ficha</a> y vuelve.
              </div>
            ) : (
              <div className="results" role="group" aria-label="Vehículo">
                {vehiculosActivos.map((v) => (
                  <button key={v.id} type="button" className="result" aria-pressed={vehiculoId === v.id} onClick={() => setVehiculoId(v.id)}>
                    <span className="placa">{v.placa}</span> {v.marca} {v.modelo} {v.anio}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="form">
            <div className="field">
              <label htmlFor="buscar-cliente">Buscar cliente por nombre, teléfono o placa</label>
              <input id="buscar-cliente" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. Luis, 5512345678 o ABC123" autoFocus />
            </div>
            {buscando && <p className="muted">Buscando…</p>}
            <div className="results">
              {resultados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="result"
                  onClick={() => {
                    setCliente(c);
                    setVehiculoId(c.vehiculos.find((v) => v.activo)?.id ?? "");
                  }}
                >
                  <b>{c.nombre} {c.apellidos ?? ""}</b>
                  <span className="muted num">{c.telefono}</span>
                  {c.vehiculos.filter((v) => v.activo).map((v) => <span key={v.id} className="placa">{v.placa}</span>)}
                </button>
              ))}
              {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
                <p className="muted">
                  Sin resultados. <a href="/clientes/nuevo">Registrar cliente nuevo</a>
                </p>
              )}
            </div>
          </div>
        )}

        <h2>2 · Servicio</h2>
        <div className="fields">
          <div className="field wide">
            <label htmlFor="servicio">Servicio principal</label>
            <select id="servicio" value={servicioId} onChange={(e) => elegirServicio(e.target.value)}>
              <option value="">Por diagnosticar / otro</option>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.categorias_servicio?.nombre ? `${s.categorias_servicio.nombre} · ` : ""}{s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="duracion">Duración</label>
            <select id="duracion" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
              {[30, 45, 60, 90, 120, 180, 240, 300, 360, 480].map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>
              ))}
              {![30, 45, 60, 90, 120, 180, 240, 300, 360, 480].includes(duracion) && <option value={duracion}>{duracion} min</option>}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tipo-bahia">Tipo de bahía</label>
            <select id="tipo-bahia" value={tipoBahia} onChange={(e) => setTipoBahia(e.target.value)}>
              <option value="">Cualquiera</option>
              {tiposBahia.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field wide">
            <label htmlFor="motivo">Lo que reporta el cliente</label>
            <textarea id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ruido al frenar, toca servicio de 40 000 km…" />
          </div>
          <div className="field">
            <label htmlFor="canal">Agendó por</label>
            <select id="canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
              {Object.entries(CANALES).filter(([k]) => k !== "nota").map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>3 · Fecha y horario</h2>
        <div className="row">
          <input type="date" id="fecha" aria-label="Fecha" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: "auto" }} />
          <button type="button" className="btn" onClick={verHuecos} disabled={cargandoHuecos}>
            {cargandoHuecos ? "Buscando…" : "Ver horarios libres"}
          </button>
        </div>

        {error && <div className="alert error" role="alert">{error}</div>}

        {huecos !== null && porHora.length === 0 && !error && (
          <div className="empty">No hay horarios libres ese día con esa duración. Prueba otra fecha o una duración menor.</div>
        )}

        {porHora.length > 0 && (
          <div className="slots" role="group" aria-label="Horarios libres">
            {porHora.map(([inicio, opciones]) => (
              <button
                key={inicio}
                type="button"
                className="slot"
                aria-pressed={horaSel === inicio}
                onClick={() => {
                  setHoraSel(inicio);
                  setOpcionSel(opciones[0]);
                }}
              >
                <b>{fmtHora(inicio, sucursal.zona_horaria)}</b>
                <span>{opciones.length} {opciones.length === 1 ? "técnico libre" : "técnicos libres"}</span>
              </button>
            ))}
          </div>
        )}

        {horaSel && (
          <div className="field">
            <label htmlFor="opcion">Técnico y bahía</label>
            <select
              id="opcion"
              value={opcionSel ? `${opcionSel.tecnico_id}|${opcionSel.bahia_id}` : ""}
              onChange={(e) => {
                const [t, b] = e.target.value.split("|");
                setOpcionSel((huecos ?? []).find((h) => h.inicio === horaSel && h.tecnico_id === t && h.bahia_id === b) ?? null);
              }}
            >
              {(huecos ?? []).filter((h) => h.inicio === horaSel).map((h) => (
                <option key={`${h.tecnico_id}|${h.bahia_id}`} value={`${h.tecnico_id}|${h.bahia_id}`}>
                  {nombreTecnico(h.tecnico_id)} · {nombreBahia(h.bahia_id)}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          className="btn primary"
          onClick={guardar}
          disabled={!cliente || !vehiculoId || !opcionSel || guardando}
        >
          {guardando
            ? "Agendando…"
            : opcionSel
              ? `Agendar ${fmtHora(opcionSel.inicio, sucursal.zona_horaria)}–${fmtHora(opcionSel.fin, sucursal.zona_horaria)}`
              : "Agendar cita"}
        </button>
        {(!cliente || !vehiculoId) && <p className="muted" style={{ fontSize: 13 }}>Elige cliente y vehículo para poder agendar.</p>}
      </section>
    </div>
  );
}
