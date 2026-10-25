-- Proveedores y compras: pedidos sugeridos desde las alertas de stock, recepción con factura
-- y alertas que se reabren si se cancela el pedido.

-- Recepción de una línea: ahora guarda proveedor y factura en el kardex, y solo acepta
-- pedidos enviados o parciales.
drop function if exists recibir_linea_oc(uuid, numeric, uuid, metodo_captura);
create function recibir_linea_oc(p_linea uuid, p_cantidad numeric, p_ubicacion uuid,
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
  values (l.articulo_id, p_ubicacion, 'entrada_compra', p_cantidad, l.costo_unitario, p_metodo,
          p_linea, oc.proveedor_id, p_referencia);

  update ordenes_compra o
     set estado = case when not exists (select 1 from ordenes_compra_lineas
                                         where orden_compra_id = o.id and cantidad_recibida < cantidad)
                       then 'recibida'::estado_oc else 'parcial'::estado_oc end
   where o.id = oc.id;
end $$;

-- Cantidad sugerida para reabastecer: la cantidad de reorden; si no hay, hasta el máximo;
-- si tampoco, el doble del punto de reorden menos lo que hay.
create function cantidad_sugerida(p_articulo uuid, p_sucursal uuid) returns numeric
language sql stable as $$
  select greatest(1, coalesce(
           nullif(ps.cantidad_reorden, 0),
           ps.stock_maximo - stock_sucursal(p_articulo, p_sucursal),
           ps.punto_reorden * 2 - stock_sucursal(p_articulo, p_sucursal)))
    from parametros_stock ps
   where ps.articulo_id = p_articulo and ps.sucursal_id = p_sucursal
$$;

-- Crea pedidos en borrador, uno por proveedor preferido, con todo lo que tiene alerta abierta.
-- Los artículos sin proveedor preferido se quedan en la lista de alertas.
create function generar_pedidos_sugeridos(p_sucursal uuid) returns integer
language plpgsql security invoker as $$
declare
  r       record;
  v_oc    uuid;
  v_total integer := 0;
begin
  for r in
    select distinct ap.proveedor_id
      from alertas_reabastecimiento al
      join articulo_proveedores ap on ap.articulo_id = al.articulo_id and ap.preferido
     where al.sucursal_id = p_sucursal and al.estado = 'abierta'
  loop
    insert into ordenes_compra (proveedor_id, sucursal_id, creada_por, notas,
                                fecha_esperada)
    select r.proveedor_id, p_sucursal, auth.uid(), 'Pedido sugerido por alertas de stock',
           current_date + coalesce(pr.dias_entrega, 0)
      from proveedores pr where pr.id = r.proveedor_id
    returning id into v_oc;

    insert into ordenes_compra_lineas (orden_compra_id, articulo_id, cantidad, costo_unitario)
    select v_oc, al.articulo_id, cantidad_sugerida(al.articulo_id, p_sucursal),
           coalesce(nullif(ap.costo, 0), a.ultimo_costo, a.costo_promedio, 0)
      from alertas_reabastecimiento al
      join articulo_proveedores ap on ap.articulo_id = al.articulo_id and ap.preferido and ap.proveedor_id = r.proveedor_id
      join articulos a on a.id = al.articulo_id
     where al.sucursal_id = p_sucursal and al.estado = 'abierta';

    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

-- Al pedir un artículo con alerta abierta, la alerta pasa a "en compra" ligada al pedido
create function fn_oc_linea_alerta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update alertas_reabastecimiento al
     set estado = 'en_compra', orden_compra_id = new.orden_compra_id
    from ordenes_compra oc
   where oc.id = new.orden_compra_id
     and al.articulo_id = new.articulo_id and al.sucursal_id = oc.sucursal_id and al.estado = 'abierta';
  return new;
end $$;
create trigger trg_oc_linea_alerta after insert on ordenes_compra_lineas
  for each row execute function fn_oc_linea_alerta();

-- Si se quita la línea o se cancela el pedido, la alerta vuelve a quedar abierta
create function fn_oc_linea_quitada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update alertas_reabastecimiento set estado = 'abierta', orden_compra_id = null
   where orden_compra_id = old.orden_compra_id and articulo_id = old.articulo_id and estado = 'en_compra';
  return old;
end $$;
create trigger trg_oc_linea_quitada after delete on ordenes_compra_lineas
  for each row execute function fn_oc_linea_quitada();

create function fn_oc_cancelada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    update alertas_reabastecimiento set estado = 'abierta', orden_compra_id = null
     where orden_compra_id = new.id and estado = 'en_compra';
  end if;
  return new;
end $$;
create trigger trg_oc_cancelada after update of estado on ordenes_compra
  for each row execute function fn_oc_cancelada();

-- Total de cada pedido y lo que falta por recibir
create view v_ordenes_compra with (security_invoker = true) as
select oc.id, oc.folio, oc.sucursal_id, oc.proveedor_id, pr.nombre as proveedor, oc.estado,
       oc.fecha_esperada, oc.notas, oc.created_at, oc.updated_at,
       count(l.id)                                                   as lineas,
       coalesce(sum(l.cantidad * l.costo_unitario), 0)::numeric(14,2) as total,
       coalesce(sum(l.cantidad_recibida * l.costo_unitario), 0)::numeric(14,2) as recibido,
       coalesce(sum(greatest(l.cantidad - l.cantidad_recibida, 0)), 0) as piezas_pendientes
  from ordenes_compra oc
  join proveedores pr on pr.id = oc.proveedor_id
  left join ordenes_compra_lineas l on l.orden_compra_id = oc.id
 group by oc.id, pr.nombre;

grant select on v_ordenes_compra to authenticated;
grant execute on function recibir_linea_oc(uuid, numeric, uuid, metodo_captura, text),
                          cantidad_sugerida(uuid, uuid), generar_pedidos_sugeridos(uuid) to authenticated;
