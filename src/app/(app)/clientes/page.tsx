import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requierePerfil } from "@/lib/sesion";

export const metadata: Metadata = { title: "Clientes" };

type Fila = {
  id: string;
  tipo: string;
  nombre: string;
  apellidos: string | null;
  razon_social: string | null;
  telefono: string | null;
  email: string | null;
  vehiculos: { placa: string; marca: string; modelo: string; anio: number; activo: boolean }[];
};

const COLUMNAS = "id, tipo, nombre, apellidos, razon_social, telefono, email, vehiculos(placa, marca, modelo, anio, activo)";

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const perfil = await requierePerfil();
  const { q = "" } = await searchParams;
  const supabase = await createClient();

  // Se limpian caracteres que PostgREST usa como sintaxis en los filtros
  const termino = q.trim().replace(/[,()%*\\]/g, " ").slice(0, 60);
  let filas: Fila[] = [];

  if (termino) {
    const placa = termino.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const [porDatos, porPlaca] = await Promise.all([
      supabase
        .from("clientes")
        .select(COLUMNAS)
        .eq("activo", true)
        .or(`nombre.ilike.%${termino}%,apellidos.ilike.%${termino}%,razon_social.ilike.%${termino}%,telefono.ilike.%${termino}%,email.ilike.%${termino}%`)
        .order("nombre")
        .limit(50),
      placa
        ? supabase.from("vehiculos").select("cliente_id").eq("activo", true).ilike("placa_norm", `%${placa}%`).limit(50)
        : Promise.resolve({ data: [] as { cliente_id: string }[] }),
    ]);
    filas = (porDatos.data as Fila[]) ?? [];
    const faltan = (porPlaca.data ?? []).map((v) => v.cliente_id).filter((id) => !filas.some((f) => f.id === id));
    if (faltan.length) {
      const { data } = await supabase.from("clientes").select(COLUMNAS).in("id", faltan);
      filas = [...((data as Fila[]) ?? []), ...filas];
    }
  } else {
    const { data } = await supabase
      .from("clientes")
      .select(COLUMNAS)
      .eq("activo", true)
      .order("created_at", { ascending: false })
      .limit(50);
    filas = (data as Fila[]) ?? [];
  }

  const puedeCrear = perfil.rol !== "tecnico";

  return (
    <>
      <div className="head">
        <div>
          <h1>Clientes</h1>
          <p className="sub">{termino ? `Resultados para “${q}”` : "Últimos clientes registrados"}</p>
        </div>
        {puedeCrear && (
          <Link className="btn primary" href="/clientes/nuevo">
            Nuevo cliente
          </Link>
        )}
      </div>

      <form className="row" role="search">
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, teléfono, correo o placa"
          style={{ flex: "1 1 260px" }}
          aria-label="Buscar clientes"
        />
        <button className="btn" type="submit">Buscar</button>
        {termino && (
          <Link className="btn" href="/clientes">
            Limpiar
          </Link>
        )}
      </form>

      {filas.length === 0 ? (
        <div className="empty">
          {termino ? "No hay clientes que coincidan con la búsqueda." : "Aún no hay clientes. Registra el primero con “Nuevo cliente”."}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>Vehículos</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clientes/${c.id}`}>
                      {c.tipo === "empresa" && c.razon_social ? c.razon_social : `${c.nombre} ${c.apellidos ?? ""}`}
                    </Link>
                  </td>
                  <td>
                    <div className="num">{c.telefono ?? "—"}</div>
                    {c.email && <div className="muted">{c.email}</div>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {c.vehiculos.filter((v) => v.activo).map((v) => (
                        <span key={v.placa} title={`${v.marca} ${v.modelo} ${v.anio}`}>
                          <span className="placa">{v.placa}</span>{" "}
                          <span className="muted">{v.marca} {v.modelo}</span>
                        </span>
                      ))}
                      {c.vehiculos.filter((v) => v.activo).length === 0 && <span className="muted">Sin vehículos</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
