import { TIPOS_MOVIMIENTO, type TipoMovimiento } from "@/lib/tipos";
import { dinero } from "@/lib/fechas";
import { saldoDe, type FilaKardex, type ModoSaldo } from "@/lib/kardex";

const n = (x: number | null | undefined, dec = 3) =>
  x == null ? "—" : Number(x).toLocaleString("es-PE", { maximumFractionDigits: dec });

function fechaCorta(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-PE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// Kardex con método de costo promedio ponderado: entradas, salidas y saldo en unidades y en valor
export default function TablaKardex({
  filas,
  modo,
  tz,
  unArticulo,
  mostrarArticulo = !unArticulo,
}: {
  filas: FilaKardex[];
  modo: ModoSaldo;
  tz: string;
  unArticulo: boolean;
  mostrarArticulo?: boolean;
}) {
  if (filas.length === 0) return <div className="empty">No hay movimientos con estos filtros en el periodo.</div>;

  const totEnt = filas.reduce((s, f) => s + Number(f.entrada), 0);
  const totSal = filas.reduce((s, f) => s + Number(f.salida), 0);
  const valEnt = filas.filter((f) => f.cantidad > 0).reduce((s, f) => s + Number(f.valor_movimiento), 0);
  const valSal = filas.filter((f) => f.cantidad < 0).reduce((s, f) => s - Number(f.valor_movimiento), 0);
  const primera = filas[0];
  const saldoInicial = unArticulo ? saldoDe(primera, modo) - Number(primera.cantidad) : null;
  const nombreSaldo = modo === "ubicacion" ? "Saldo ubicación" : modo === "sucursal" ? "Saldo sucursal" : "Saldo total";

  return (
    <div className="table-wrap">
      <table className="kardex">
        <thead>
          <tr>
            <th>Fecha</th>
            {mostrarArticulo && <th>Artículo</th>}
            <th>Movimiento</th>
            <th>Documento</th>
            <th>Ubicación</th>
            <th className="r">Entrada</th>
            <th className="r">Salida</th>
            <th className="r">{nombreSaldo}</th>
            <th className="r">Costo unit.</th>
            <th className="r">Costo prom.</th>
            <th className="r">Valor mov.</th>
            <th className="r">Valor saldo</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {saldoInicial !== null && (
            <tr className="inicial">
              <td colSpan={mostrarArticulo ? 7 : 6}>Saldo inicial del periodo</td>
              <td className="r num">{n(saldoInicial)}</td>
              <td colSpan={2} />
              <td className="r num">{dinero(saldoInicial * Number(primera.costo_promedio ?? 0))}</td>
              <td colSpan={2} />
            </tr>
          )}
          {filas.map((f) => {
            const saldo = saldoDe(f, modo);
            return (
              <tr key={f.id}>
                <td className="num">{fechaCorta(f.fecha, tz)}</td>
                {mostrarArticulo && (
                  <td>
                    <a href={`/inventario/${f.articulo_id}`}>{f.articulo}</a>
                    <div className="muted mono" style={{ fontSize: 12 }}>{f.sku}</div>
                  </td>
                )}
                <td>
                  {TIPOS_MOVIMIENTO[f.tipo as TipoMovimiento] ?? f.tipo}
                  {f.metodo === "escaneo" && <span className="muted" title="Registrado con lector"> ⌁</span>}
                  {(f.motivo || f.proveedor) && <div className="muted" style={{ fontSize: 12, whiteSpace: "normal", maxWidth: 220 }}>{f.proveedor ?? f.motivo}</div>}
                </td>
                <td>{[f.documento, f.referencia].filter(Boolean).join(" · ") || "—"}</td>
                <td className="mono">{f.ubicacion}</td>
                <td className="r num in">{f.entrada > 0 ? n(f.entrada) : ""}</td>
                <td className="r num out">{f.salida > 0 ? n(f.salida) : ""}</td>
                <td className="r num saldo">{n(saldo)}</td>
                <td className="r num">{dinero(f.costo_unitario)}</td>
                <td className="r num">{dinero(f.costo_promedio)}</td>
                <td className={`r num ${f.cantidad > 0 ? "in" : "out"}`}>{dinero(f.valor_movimiento)}</td>
                <td className="r num">{dinero(saldo * Number(f.costo_promedio ?? 0))}</td>
                <td>{f.usuario ?? "Sistema"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={mostrarArticulo ? 5 : 4}>Totales del periodo · {filas.length} movimientos</td>
            <td className="r num in">{n(totEnt)}</td>
            <td className="r num out">{n(totSal)}</td>
            <td className="r num">{unArticulo ? n(saldoDe(filas[filas.length - 1], modo)) : ""}</td>
            <td colSpan={2} />
            <td className="r num" style={{ whiteSpace: "normal" }}>
              <span className="in">{dinero(valEnt)}</span> / <span className="out">{dinero(valSal)}</span>
            </td>
            <td className="r num">{unArticulo ? dinero(saldoDe(filas[filas.length - 1], modo) * Number(filas[filas.length - 1].costo_promedio ?? 0)) : ""}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
