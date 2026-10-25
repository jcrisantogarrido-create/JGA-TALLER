-- Soles y dólares. La moneda base es el sol: inventario, kardex, costos y reportes van en S/.
-- Cada servicio, orden de trabajo, proveedor y pedido de compra tiene su moneda; las órdenes
-- y pedidos en dólares guardan el tipo de cambio con el que se convierten a soles.

create type moneda as enum ('PEN', 'USD');

-- Tipo de cambio del día (cuántos soles vale 1 dólar)
create table tipos_cambio (
  fecha      date primary key,
  usd_pen    numeric(10,4) not null check (usd_pen > 0),
  registrado_por uuid references perfiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table tipos_cambio enable row level security;
create policy tc_leer on tipos_cambio for select to authenticated using (rol_actual() is not null);
create policy tc_gestionar on tipos_cambio for all to authenticated
  using (tiene_rol('admin','gerente','recepcion')) with check (tiene_rol('admin','gerente','recepcion'));
grant select, insert, update, delete on tipos_cambio to authenticated;

-- El último tipo de cambio registrado hasta esa fecha
create function tipo_cambio_vigente(p_fecha date default current_date) returns numeric
language sql stable as $$
  select usd_pen from tipos_cambio where fecha <= p_fecha order by fecha desc limit 1
$$;
grant execute on function tipo_cambio_vigente(date) to authenticated;

-- Convierte un monto entre monedas con un tipo de cambio dado
create function convertir(p_monto numeric, p_de moneda, p_a moneda, p_tc numeric) returns numeric
language sql immutable as $$
  select case when p_de = p_a or p_monto is null then p_monto
              when p_de = 'USD' and p_a = 'PEN' then round(p_monto * p_tc, 2)
              else round(p_monto / nullif(p_tc, 0), 2) end
$$;

-- Catálogo y documentos con moneda
alter table servicios add column moneda moneda not null default 'PEN';
alter table proveedores add column moneda moneda not null default 'PEN';

alter table ordenes_trabajo
  add column moneda moneda not null default 'PEN',
  add column tipo_cambio numeric(10,4) check (tipo_cambio > 0),
  add constraint ot_tc_dolares check (moneda = 'PEN' or tipo_cambio is not null);

alter table ordenes_compra
  add column moneda moneda not null default 'PEN',
  add column tipo_cambio numeric(10,4) check (tipo_cambio > 0),
  add constraint oc_tc_dolares check (moneda = 'PEN' or tipo_cambio is not null);

-- Pagos: el monto queda en la moneda de la orden; si pagaron en la otra moneda se guarda el original
alter table pagos
  add column moneda_original moneda,
  add column monto_original numeric(12,2);

-- Trabajos del catálogo: el precio se convierte a la moneda de la orden
create or replace function fn_os_defaults() returns trigger language plpgsql as $$
declare s servicios%rowtype; o ordenes_trabajo%rowtype;
begin
  if new.servicio_id is not null then
    select * into s from servicios where id = new.servicio_id;
    select * into o from ordenes_trabajo where id = new.orden_id;
    new.categoria_id   := coalesce(new.categoria_id, s.categoria_id);
    new.descripcion    := coalesce(new.descripcion, s.nombre);
    if tg_op = 'INSERT' and new.precio = 0 then
      new.precio := convertir(s.precio_base, s.moneda, o.moneda, o.tipo_cambio);
    end if;
    if tg_op = 'INSERT' and new.horas_cobradas = 0 then new.horas_cobradas := s.horas_estandar; end if;
  end if;
  return new;
end $$;

-- Piezas: el costo queda en soles (inventario); el precio de venta, en la moneda de la orden
create or replace function fn_orden_pieza_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare o ordenes_trabajo%rowtype;
begin
  if tg_op = 'INSERT' then
    select ot.* into o from ordenes_trabajo ot join orden_servicios os on os.orden_id = ot.id where os.id = new.orden_servicio_id;
    select coalesce(new.costo_unitario, a.costo_promedio),
           coalesce(new.precio_unitario, convertir(a.precio_venta, 'PEN', o.moneda, o.tipo_cambio))
      into new.costo_unitario, new.precio_unitario
      from articulos a where a.id = new.articulo_id;
    return new;
  end if;
  return null;
end $$;

-- Totales por orden: los ingresos en la moneda de la orden y su equivalente en soles.
-- Los costos (piezas a costo promedio y horas del técnico) siempre en soles.
create or replace view v_orden_totales with (security_invoker = true) as
select o.id as orden_id, o.folio, o.sucursal_id, o.cliente_id, o.vehiculo_id, o.estado,
       o.recibido_en, o.iniciado_en, o.terminado_en, o.entregado_en,
       coalesce(s.mano_obra, 0)                                   as ingreso_mano_obra,
       coalesce(p.piezas_venta, 0)                                as ingreso_piezas,
       coalesce(s.mano_obra, 0) + coalesce(p.piezas_venta, 0) - o.descuento as ingreso_total,
       coalesce(t.costo_mano_obra, 0)                             as costo_mano_obra,
       coalesce(p.piezas_costo, 0)                                as costo_piezas,
       coalesce(t.horas_reales, 0)                                as horas_reales,
       coalesce(pg.pagado, 0)                                     as pagado,
       o.moneda,
       o.tipo_cambio,
       case when o.moneda = 'USD' then o.tipo_cambio else 1 end  as factor_pen,
       round((coalesce(s.mano_obra, 0) + coalesce(p.piezas_venta, 0) - o.descuento)
             * case when o.moneda = 'USD' then o.tipo_cambio else 1 end, 2) as ingreso_total_pen
  from ordenes_trabajo o
  left join lateral (select sum(precio) mano_obra from orden_servicios where orden_id = o.id) s on true
  left join lateral (select sum(op.cantidad * op.precio_unitario) piezas_venta,
                            sum(op.cantidad * op.costo_unitario)  piezas_costo
                       from orden_piezas op join orden_servicios os on os.id = op.orden_servicio_id
                      where os.orden_id = o.id) p on true
  left join lateral (select sum(rt.horas) horas_reales, sum(rt.horas * rt.costo_hora) costo_mano_obra
                       from registros_tiempo rt join orden_servicios os on os.id = rt.orden_servicio_id
                      where os.orden_id = o.id) t on true
  left join lateral (select sum(monto) pagado from pagos where orden_id = o.id) pg on true;

-- Historial: los montos se muestran en la moneda de su orden
create or replace view v_historial_servicio with (security_invoker = true) as
select v.placa, v.marca, v.modelo, v.anio, o.folio, o.recibido_en, o.entregado_en, o.kilometraje_ingreso,
       cs.nombre as categoria, os.descripcion as trabajo, pf.nombre as tecnico,
       os.horas_cobradas,
       (select sum(horas) from registros_tiempo where orden_servicio_id = os.id) as horas_reales,
       os.precio as mano_obra,
       (select coalesce(sum(cantidad * precio_unitario), 0) from orden_piezas where orden_servicio_id = os.id) as piezas,
       (select string_agg(a.nombre || ' x' || op.cantidad::text, ', ')
          from orden_piezas op join articulos a on a.id = op.articulo_id
         where op.orden_servicio_id = os.id) as piezas_detalle,
       v.id as vehiculo_id, o.cliente_id, o.id as orden_id,
       o.moneda
  from orden_servicios os
  join ordenes_trabajo o on o.id = os.orden_id
  join vehiculos v on v.id = o.vehiculo_id
  join categorias_servicio cs on cs.id = os.categoria_id
  left join perfiles pf on pf.id = os.tecnico_id
 where o.estado <> 'cancelada';

-- Métricas por cliente en soles
create or replace view v_cliente_metricas with (security_invoker = true) as
select c.id as cliente_id, c.nombre, c.apellidos, c.acepta_marketing, c.canal_preferido,
       count(t.orden_id)                                  as visitas,
       coalesce(sum(t.ingreso_total_pen), 0)              as gasto_total,
       coalesce(avg(t.ingreso_total_pen), 0)::numeric(12,2) as ticket_promedio,
       min(t.entregado_en)                                as primera_visita,
       max(t.entregado_en)                                as ultima_visita,
       (current_date - max(t.entregado_en)::date)         as dias_sin_visita,
       (select array_agg(distinct v.tipo) from vehiculos v where v.cliente_id = c.id and v.activo)  as tipos_vehiculo,
       (select array_agg(distinct v.marca) from vehiculos v where v.cliente_id = c.id and v.activo) as marcas,
       (select array_agg(distinct cs.nombre) from orden_servicios os
          join ordenes_trabajo o on o.id = os.orden_id join categorias_servicio cs on cs.id = os.categoria_id
         where o.cliente_id = c.id and o.estado = 'entregada')                                        as categorias,
       (select coalesce(sum(puntos), 0) from puntos_fidelidad pf where pf.cliente_id = c.id)         as puntos
  from clientes c
  left join v_orden_totales t on t.cliente_id = c.id and t.estado = 'entregada'
 where c.activo
 group by c.id;

-- Rentabilidad por categoría en soles
create or replace view v_rentabilidad_categoria with (security_invoker = true) as
select date_trunc('month', o.entregado_en)::date as mes, o.sucursal_id, cs.nombre as categoria,
       count(*)                                         as trabajos,
       sum((os.precio + coalesce(p.venta, 0)) * f.k)   as ingreso,
       sum(coalesce(t.costo, 0) + coalesce(p.costo, 0)) as costo,
       sum((os.precio + coalesce(p.venta, 0)) * f.k) - sum(coalesce(t.costo, 0) + coalesce(p.costo, 0)) as margen,
       round(100 * (sum((os.precio + coalesce(p.venta, 0)) * f.k) - sum(coalesce(t.costo, 0) + coalesce(p.costo, 0)))
             / nullif(sum((os.precio + coalesce(p.venta, 0)) * f.k), 0), 1) as margen_pct,
       round(avg(t.horas), 2)                           as horas_reales_prom,
       round(avg(os.horas_cobradas), 2)                 as horas_cobradas_prom
  from orden_servicios os
  join ordenes_trabajo o on o.id = os.orden_id and o.estado = 'entregada'
  cross join lateral (select case when o.moneda = 'USD' then o.tipo_cambio else 1 end k) f
  join categorias_servicio cs on cs.id = os.categoria_id
  left join lateral (select sum(cantidad * precio_unitario) venta, sum(cantidad * costo_unitario) costo
                       from orden_piezas where orden_servicio_id = os.id) p on true
  left join lateral (select sum(horas) horas, sum(horas * costo_hora) costo
                       from registros_tiempo where orden_servicio_id = os.id) t on true
 group by 1, 2, 3;

-- Puntos de fidelidad: 1 por cada S/ 100 (las órdenes en dólares se convierten)
create or replace function fn_puntos_por_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  if new.estado = 'entregada' and old.estado is distinct from 'entregada' then
    select ingreso_total_pen into v_total from v_orden_totales where orden_id = new.id;
    if coalesce(v_total, 0) >= 100 then
      insert into puntos_fidelidad (cliente_id, orden_id, puntos, concepto)
      values (new.cliente_id, new.id, floor(v_total / 100)::int, 'Servicio OT ' || new.folio);
    end if;
  end if;
  return new;
end $$;

-- Compras en dólares: la entrada al kardex se valora en soles con el tipo de cambio del pedido
create or replace function recibir_linea_oc(p_linea uuid, p_cantidad numeric, p_ubicacion uuid,
                                            p_metodo metodo_captura default 'escaneo', p_referencia text default null)
returns void language plpgsql security invoker as $$
declare
  l  ordenes_compra_lineas%rowtype;
  oc ordenes_compra%rowtype;
begin
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad debe ser positiva'; end if;
  select * into l from ordenes_compra_lineas where id = p_linea for update;
  if not found then raise exception 'Línea de compra inexistente'; end if;
  select * into oc from ordenes_compra where id = l.orden_compra_id for update;
  if oc.estado not in ('enviada', 'parcial') then
    raise exception 'Solo se recibe mercancía de pedidos enviados (estado actual: %)', oc.estado;
  end if;

  update ordenes_compra_lineas set cantidad_recibida = cantidad_recibida + p_cantidad where id = p_linea;

  insert into movimientos_inventario (articulo_id, ubicacion_id, tipo, cantidad, costo_unitario, metodo,
                                      oc_linea_id, proveedor_id, referencia)
  values (l.articulo_id, p_ubicacion, 'entrada_compra', p_cantidad,
          case when oc.moneda = 'USD' then round(l.costo_unitario * oc.tipo_cambio, 4) else l.costo_unitario end,
          p_metodo, p_linea, oc.proveedor_id, p_referencia);

  update ordenes_compra o
     set estado = case when not exists (select 1 from ordenes_compra_lineas
                                         where orden_compra_id = o.id and cantidad_recibida < cantidad)
                       then 'recibida'::estado_oc else 'parcial'::estado_oc end
   where o.id = oc.id;
end $$;

-- Pedidos sugeridos en la moneda del proveedor
create or replace function generar_pedidos_sugeridos(p_sucursal uuid) returns integer
language plpgsql security invoker as $$
declare
  r       record;
  v_oc    uuid;
  v_tc    numeric := tipo_cambio_vigente();
  v_total integer := 0;
begin
  for r in
    select distinct ap.proveedor_id, pr.moneda, pr.dias_entrega
      from alertas_reabastecimiento al
      join articulo_proveedores ap on ap.articulo_id = al.articulo_id and ap.preferido
      join proveedores pr on pr.id = ap.proveedor_id
     where al.sucursal_id = p_sucursal and al.estado = 'abierta'
       and (pr.moneda = 'PEN' or v_tc is not null)
  loop
    insert into ordenes_compra (proveedor_id, sucursal_id, creada_por, notas, fecha_esperada, moneda, tipo_cambio)
    values (r.proveedor_id, p_sucursal, auth.uid(), 'Pedido sugerido por alertas de stock',
            current_date + coalesce(r.dias_entrega, 0), r.moneda, v_tc)
    returning id into v_oc;

    insert into ordenes_compra_lineas (orden_compra_id, articulo_id, cantidad, costo_unitario)
    select v_oc, al.articulo_id, cantidad_sugerida(al.articulo_id, p_sucursal),
           coalesce(nullif(ap.costo, 0), convertir(coalesce(a.ultimo_costo, a.costo_promedio, 0), 'PEN', r.moneda, v_tc), 0)
      from alertas_reabastecimiento al
      join articulo_proveedores ap on ap.articulo_id = al.articulo_id and ap.preferido and ap.proveedor_id = r.proveedor_id
      join articulos a on a.id = al.articulo_id
     where al.sucursal_id = p_sucursal and al.estado = 'abierta';

    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

-- Pedidos con su moneda
create or replace view v_ordenes_compra with (security_invoker = true) as
select oc.id, oc.folio, oc.sucursal_id, oc.proveedor_id, pr.nombre as proveedor, oc.estado,
       oc.fecha_esperada, oc.notas, oc.created_at, oc.updated_at,
       count(l.id)                                                   as lineas,
       coalesce(sum(l.cantidad * l.costo_unitario), 0)::numeric(14,2) as total,
       coalesce(sum(l.cantidad_recibida * l.costo_unitario), 0)::numeric(14,2) as recibido,
       coalesce(sum(greatest(l.cantidad - l.cantidad_recibida, 0)), 0) as piezas_pendientes,
       oc.moneda, oc.tipo_cambio
  from ordenes_compra oc
  join proveedores pr on pr.id = oc.proveedor_id
  left join ordenes_compra_lineas l on l.orden_compra_id = oc.id
 group by oc.id, pr.nombre;

grant execute on function convertir(numeric, moneda, moneda, numeric) to authenticated;
