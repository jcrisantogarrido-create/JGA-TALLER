"use client";

import { useActionState } from "react";
import { TIPOS_ARTICULO } from "@/lib/tipos";
import type { Estado } from "@/app/(app)/inventario/actions";

export type ArticuloForm = {
  id?: string;
  sku?: string;
  codigo_barras?: string | null;
  nombre?: string;
  descripcion?: string | null;
  tipo?: string;
  unidad?: string;
  precio_venta?: number;
  categoria?: string | null;
  marca?: string | null;
  activo?: boolean;
  punto_reorden?: number | null;
  cantidad_reorden?: number | null;
  stock_maximo?: number | null;
};

const UNIDADES = ["pieza", "litro", "galón", "juego", "kit", "metro", "kg", "caja", "bote", "par"];

export default function FormArticulo({
  accion,
  inicial = {},
  sucursal,
  ubicaciones,
  categorias,
  marcas,
  nuevo = false,
}: {
  accion: (e: Estado, f: FormData) => Promise<Estado>;
  inicial?: ArticuloForm;
  sucursal: { id: string; nombre: string };
  ubicaciones?: { id: string; codigo: string }[];
  categorias: string[];
  marcas: string[];
  nuevo?: boolean;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const v = (x: unknown) => (x == null ? "" : String(x));
  return (
    <form action={enviar} className="form">
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      <input type="hidden" name="sucursal_id" value={sucursal.id} />
      {estado.error && <div className="alert error" role="alert">{estado.error}</div>}
      {estado.ok && <div className="alert ok" role="status">{estado.ok}</div>}

      <div className="fields">
        <div className="field">
          <label htmlFor="a-sku">SKU / clave interna</label>
          <input id="a-sku" name="sku" required defaultValue={v(inicial.sku)} autoCapitalize="characters" placeholder="ACE-5W30-1L" />
        </div>
        <div className="field">
          <label htmlFor="a-cb">Código de barras</label>
          <input id="a-cb" name="codigo_barras" defaultValue={v(inicial.codigo_barras)} inputMode="numeric" placeholder="Escanéalo aquí" className="mono" />
        </div>
        <div className="field wide">
          <label htmlFor="a-nombre">Nombre</label>
          <input id="a-nombre" name="nombre" required defaultValue={v(inicial.nombre)} placeholder="Aceite sintético 5W-30, 1 litro" />
        </div>
        <div className="field">
          <label htmlFor="a-tipo">Tipo</label>
          <select id="a-tipo" name="tipo" defaultValue={inicial.tipo ?? "pieza"}>
            {Object.entries(TIPOS_ARTICULO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-cat">Categoría</label>
          <input id="a-cat" name="categoria" list="l-cat" defaultValue={v(inicial.categoria)} placeholder="Lubricantes" />
          <datalist id="l-cat">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="a-marca">Marca</label>
          <input id="a-marca" name="marca" list="l-marca" defaultValue={v(inicial.marca)} placeholder="Mobil" />
          <datalist id="l-marca">{marcas.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="a-unidad">Unidad</label>
          <input id="a-unidad" name="unidad" list="l-unidad" defaultValue={inicial.unidad ?? "pieza"} />
          <datalist id="l-unidad">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="a-precio">Precio de venta</label>
          <input id="a-precio" name="precio_venta" inputMode="decimal" defaultValue={v(inicial.precio_venta)} placeholder="180.00" />
        </div>
        <div className="field wide">
          <label htmlFor="a-desc">Descripción / compatibilidad</label>
          <textarea id="a-desc" name="descripcion" defaultValue={v(inicial.descripcion)} placeholder="Versa 2016–2020, March, Sentra…" />
        </div>
      </div>

      <h3>Reabastecimiento en {sucursal.nombre}</h3>
      <div className="fields">
        <div className="field">
          <label htmlFor="a-pr">Punto de reorden (mínimo)</label>
          <input id="a-pr" name="punto_reorden" inputMode="decimal" defaultValue={v(inicial.punto_reorden)} placeholder="6" />
        </div>
        <div className="field">
          <label htmlFor="a-cr">Cantidad a pedir</label>
          <input id="a-cr" name="cantidad_reorden" inputMode="decimal" defaultValue={v(inicial.cantidad_reorden)} placeholder="24" />
        </div>
        <div className="field">
          <label htmlFor="a-max">Stock máximo</label>
          <input id="a-max" name="stock_maximo" inputMode="decimal" defaultValue={v(inicial.stock_maximo)} placeholder="48" />
        </div>
      </div>

      {nuevo && ubicaciones && (
        <>
          <h3>Existencia inicial <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 400 }}>(opcional)</span></h3>
          <div className="fields">
            <div className="field">
              <label htmlFor="a-ic">Cantidad</label>
              <input id="a-ic" name="inicial_cantidad" inputMode="decimal" placeholder="0" />
            </div>
            <div className="field">
              <label htmlFor="a-icosto">Costo unitario</label>
              <input id="a-icosto" name="inicial_costo" inputMode="decimal" placeholder="95.00" />
            </div>
            <div className="field">
              <label htmlFor="a-iu">Ubicación</label>
              <select id="a-iu" name="inicial_ubicacion" defaultValue={ubicaciones[0]?.id ?? ""}>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {!nuevo && (
        <label className="check" htmlFor="a-activo">
          <input id="a-activo" name="activo" type="checkbox" defaultChecked={inicial.activo ?? true} />
          Artículo activo (si lo desactivas deja de aparecer en el inventario, pero su kardex se conserva)
        </label>
      )}

      <div className="row">
        <button className="btn primary" type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : nuevo ? "Dar de alta" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}
