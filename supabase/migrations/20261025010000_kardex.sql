-- Kardex: cada movimiento guarda el saldo y el costo promedio que dejó, para poder
-- consultar el kardex de cualquier fecha sin recalcular la historia.

alter table movimientos_inventario
  add column sucursal_id      uuid references sucursales(id),
  add column proveedor_id     uuid references proveedores(id),
  add column referencia       text,                 -- factura, remisión, folio externo
  add column saldo_ubicacion  numeric(12,3),        -- existencia en la ubicación tras el movimiento
  add column saldo_sucursal   numeric(12,3),        -- existencia en la sucursal tras el movimiento
  add column saldo_total      numeric(12,3),        -- existencia en todas las sucursales
  add column costo_promedio   numeric(12,4);        -- costo promedio ponderado tras el movimiento

create index mov_sucursal_fecha_idx on movimientos_inventario (sucursal_id, created_at);
create index mov_ubicacion_idx on movimientos_inventario (ubicacion_id, created_at);

-- El cálculo pasa de AFTER a BEFORE para poder guardar los saldos en la misma fila.
drop trigger trg_movimiento_aplicar on movimientos_inventario;

create or replace function fn_aplicar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_costo   numeric;
  v_total   numeric;
  v_stock   numeric;
  v_param   parametros_stock%rowtype;
  v_recalcula boolean;
begin
  select sucursal_id into new.sucursal_id from ubicaciones where id = new.ubicacion_id;

  -- Bloquea el artículo: movimientos simultáneos del mismo artículo se aplican en fila,
  -- así cada saldo guardado es exacto.
  select costo_promedio into v_costo from articulos where id = new.articulo_id for update;
  select coalesce(sum(cantidad), 0) into v_total from existencias where articulo_id = new.articulo_id;

  -- Costo promedio ponderado: entradas por compra y ajustes positivos con costo explícito
  -- (por ejemplo, el inventario inicial). Lo demás se valora al costo promedio vigente.
  v_recalcula := new.cantidad > 0 and new.costo_unitario is not null
                 and new.tipo in ('entrada_compra', 'ajuste_positivo');
  if new.costo_unitario is null then
    new.costo_unitario := v_costo;
  end if;

  if v_recalcula then
    v_costo := case when v_total + new.cantidad > 0 and v_total > 0
                    then (v_total * v_costo + new.cantidad * new.costo_unitario) / (v_total + new.cantidad)
                    else new.costo_unitario end;
    update articulos set costo_promedio = v_costo,
           ultimo_costo = case when new.tipo = 'entrada_compra' then new.costo_unitario else ultimo_costo end
     where id = new.articulo_id;
  end if;

  -- Saldo por ubicación (el CHECK cantidad >= 0 impide stock negativo y aborta la transacción).
  update existencias set cantidad = cantidad + new.cantidad, updated_at = now()
   where articulo_id = new.articulo_id and ubicacion_id = new.ubicacion_id
  returning cantidad into new.saldo_ubicacion;
  if not found then
    insert into existencias (articulo_id, ubicacion_id, cantidad)
    values (new.articulo_id, new.ubicacion_id, new.cantidad)
    returning cantidad into new.saldo_ubicacion;
  end if;

  new.saldo_total    := v_total + new.cantidad;
  new.saldo_sucursal := stock_sucursal(new.articulo_id, new.sucursal_id);
  new.costo_promedio := v_costo;

  -- Alerta de reabastecimiento
  select * into v_param from parametros_stock
   where articulo_id = new.articulo_id and sucursal_id = new.sucursal_id;
  if found then
    v_stock := new.saldo_sucursal;
    if v_stock <= v_param.punto_reorden then
      insert into alertas_reabastecimiento (articulo_id, sucursal_id, stock_detectado, punto_reorden)
      values (new.articulo_id, new.sucursal_id, v_stock, v_param.punto_reorden)
      on conflict (articulo_id, sucursal_id) where estado in ('abierta','en_compra') do nothing;
      perform pg_notify('reabastecimiento', json_build_object(
        'articulo_id', new.articulo_id, 'sucursal_id', new.sucursal_id, 'stock', v_stock)::text);
    else
      update alertas_reabastecimiento set estado = 'resuelta', resuelta_en = now()
       where articulo_id = new.articulo_id and sucursal_id = new.sucursal_id and estado in ('abierta','en_compra');
    end if;
  end if;
  return new;
end $$;

create trigger trg_movimiento_aplicar before insert on movimientos_inventario
  for each row execute function fn_aplicar_movimiento();

-- Kardex legible: una fila por movimiento con entradas, salidas, saldos, valores y documento de origen
create view v_kardex with (security_invoker = true) as
select m.id,
       m.created_at                                   as fecha,
       m.articulo_id, a.sku, a.codigo_barras, a.nombre as articulo, a.unidad,
       m.sucursal_id, s.nombre                        as sucursal,
       m.ubicacion_id, u.codigo                       as ubicacion,
       m.tipo,
       greatest(m.cantidad, 0)                        as entrada,
       greatest(-m.cantidad, 0)                       as salida,
       m.cantidad,
       m.costo_unitario,
       round(m.cantidad * coalesce(m.costo_unitario, 0), 2)                 as valor_movimiento,
       m.saldo_ubicacion, m.saldo_sucursal, m.saldo_total,
       m.costo_promedio,
       round(m.saldo_total * coalesce(m.costo_promedio, 0), 2)              as valor_saldo_total,
       round(m.saldo_sucursal * coalesce(m.costo_promedio, 0), 2)           as valor_saldo_sucursal,
       case
         when m.oc_linea_id is not null then 'OC ' || oc.folio
         when m.orden_pieza_id is not null and ot.folio is not null then 'OT ' || ot.folio
         when m.orden_pieza_id is not null then 'OT (pieza retirada)'
         when m.transferencia_id is not null then 'Transferencia'
         else null
       end                                            as documento,
       m.referencia, m.motivo, pr.nombre              as proveedor,
       p.nombre                                       as usuario,
       m.metodo
  from movimientos_inventario m
  join articulos a        on a.id = m.articulo_id
  join ubicaciones u      on u.id = m.ubicacion_id
  left join sucursales s  on s.id = m.sucursal_id
  left join perfiles p    on p.id = m.usuario_id
  left join proveedores pr on pr.id = m.proveedor_id
  left join ordenes_compra_lineas ol on ol.id = m.oc_linea_id
  left join ordenes_compra oc on oc.id = ol.orden_compra_id
  left join orden_piezas op on op.id = m.orden_pieza_id
  left join orden_servicios os on os.id = op.orden_servicio_id
  left join ordenes_trabajo ot on ot.id = os.orden_id;

-- Existencias por artículo y sucursal con su estado frente al punto de reorden
create view v_existencias with (security_invoker = true) as
select a.id as articulo_id, a.sku, a.codigo_barras, a.nombre, a.tipo, a.unidad,
       a.costo_promedio, a.precio_venta, a.activo,
       c.nombre as categoria, mk.nombre as marca,
       s.id as sucursal_id, s.nombre as sucursal,
       coalesce(e.stock, 0) as stock,
       ps.punto_reorden, ps.cantidad_reorden, ps.stock_maximo,
       round(coalesce(e.stock, 0) * a.costo_promedio, 2) as valor,
       case when coalesce(e.stock, 0) = 0 then 'agotado'
            when ps.punto_reorden is not null and e.stock <= ps.punto_reorden then 'bajo'
            when ps.stock_maximo is not null and e.stock > ps.stock_maximo then 'exceso'
            else 'ok' end as estado,
       e.ultimo_movimiento
  from articulos a
  cross join sucursales s
  left join categorias_articulo c on c.id = a.categoria_id
  left join marcas mk on mk.id = a.marca_id
  left join lateral (
    select sum(ex.cantidad) stock, max(ex.updated_at) ultimo_movimiento
      from existencias ex join ubicaciones ub on ub.id = ex.ubicacion_id
     where ex.articulo_id = a.id and ub.sucursal_id = s.id) e on true
  left join parametros_stock ps on ps.articulo_id = a.id and ps.sucursal_id = s.id
 where s.activa;

-- Permisos de API para lo nuevo
grant select on v_kardex, v_existencias to authenticated;

-- La alerta la gestiona gerencia; el resto del equipo la ve para avisar
drop policy if exists alertas_leer on alertas_reabastecimiento;
create policy alertas_leer on alertas_reabastecimiento for select to authenticated using (rol_actual() is not null);
