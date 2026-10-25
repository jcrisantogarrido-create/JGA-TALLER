-- Pruebas de humo del esquema (ejecutar en una base vacía, NO en producción).
-- 1) Fuera de Supabase, simula auth:
-- create schema auth;
-- create table auth.users (id uuid primary key);
-- create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
-- grant usage on schema public, auth to authenticated;
-- 2) Carga esquema.sql y luego este archivo. Las líneas marcadas 'debe fallar' deben dar error.

\set ON_ERROR_STOP 0
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
insert into sucursales (id,nombre) values ('10000000-0000-0000-0000-000000000001','Centro');
insert into perfiles (id,nombre,rol,sucursal_id,costo_hora) values
 ('00000000-0000-0000-0000-00000000000a','Ana','admin',null,0),
 ('00000000-0000-0000-0000-00000000000b','Beto','tecnico','10000000-0000-0000-0000-000000000001',120),
 ('00000000-0000-0000-0000-00000000000c','Caro','tecnico','10000000-0000-0000-0000-000000000001',100),
 ('00000000-0000-0000-0000-00000000000d','Dani','recepcion','10000000-0000-0000-0000-000000000001',0);
insert into horarios_tecnico (tecnico_id,dia_semana,hora_inicio,hora_fin)
 select t, d, '08:00','17:00' from unnest(array['00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c']::uuid[]) t, generate_series(1,6) d;
insert into bahias (id,sucursal_id,nombre,tipo) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Elevador 1','mecanica'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Lavado','lavado');
insert into ubicaciones (id,sucursal_id,codigo) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A-01-1');
insert into ubicaciones (id,sucursal_id,codigo,bahia_id) values ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','BAHIA-1','20000000-0000-0000-0000-000000000001');
insert into categorias_servicio (id,nombre) values ('40000000-0000-0000-0000-000000000001','Mantenimiento'),('40000000-0000-0000-0000-000000000002','Detailing');
insert into servicios (id,categoria_id,nombre,precio_base,horas_estandar,intervalo_recordatorio_dias,intervalo_recordatorio_km) values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Cambio de aceite',450,1,180,5000);
insert into proveedores (id,nombre) values ('60000000-0000-0000-0000-000000000001','Refaccionaria Norte');
insert into articulos (id,sku,codigo_barras,nombre,tipo,precio_venta) values ('70000000-0000-0000-0000-000000000001','ACE-5W30','7501234567890','Aceite 5W-30 1L','consumible',180);
insert into articulo_proveedores values ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','N-5W30',90,1,true);
insert into parametros_stock values ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',6,24,48);
-- compra y recepción por escaneo
insert into ordenes_compra (id,proveedor_id,sucursal_id,estado) values ('80000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','enviada');
insert into ordenes_compra_lineas (id,orden_compra_id,articulo_id,cantidad,costo_unitario) values ('81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',20,90);
select recibir_linea_oc('81000000-0000-0000-0000-000000000001',10,'30000000-0000-0000-0000-000000000001');
select recibir_linea_oc('81000000-0000-0000-0000-000000000001',10,'30000000-0000-0000-0000-000000000001');
insert into movimientos_inventario (articulo_id,ubicacion_id,tipo,cantidad,costo_unitario) values ('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','entrada_compra',10,120);
select 'costo_prom' k, costo_promedio, (select estado from ordenes_compra) from articulos;
select transferir_stock('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',8);
select * from existencias;
select 'escaneo', sku from articulo_por_codigo('7501234567890');
select 'escaneo prov', sku from articulo_por_codigo('N-5W30');
-- CRM
insert into clientes (id,nombre,telefono,acepta_marketing) values ('90000000-0000-0000-0000-000000000001','Luis','5551234',true);
insert into vehiculos (id,cliente_id,placa,marca,modelo,anio,tipo) values ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','ABC-123','Nissan','Versa',2019,'sedan');
\echo -- placa duplicada (debe fallar)
insert into vehiculos (cliente_id,placa,marca,modelo,anio) values ('90000000-0000-0000-0000-000000000001','abc 123','Nissan','Versa',2019);
-- citas: lunes 2026-10-26 10:00 hora local
insert into citas (id,sucursal_id,cliente_id,vehiculo_id,bahia_id,tecnico_id,servicio_id,inicio,fin) values
 ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','50000000-0000-0000-0000-000000000001','2026-10-26 10:00-06','2026-10-26 11:00-06');
\echo -- misma bahía traslapada (debe fallar)
insert into citas (sucursal_id,cliente_id,vehiculo_id,bahia_id,tecnico_id,inicio,fin) values ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','2026-10-26 10:30-06','2026-10-26 11:30-06');
\echo -- mismo técnico traslapado (debe fallar)
insert into citas (sucursal_id,cliente_id,vehiculo_id,bahia_id,tecnico_id,inicio,fin) values ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','2026-10-26 10:30-06','2026-10-26 11:30-06');
\echo -- fuera de turno (debe fallar)
insert into citas (sucursal_id,cliente_id,vehiculo_id,bahia_id,tecnico_id,inicio,fin) values ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c','2026-10-26 18:00-06','2026-10-26 19:00-06');
\echo -- contiguo (debe pasar)
insert into citas (sucursal_id,cliente_id,vehiculo_id,bahia_id,tecnico_id,inicio,fin) values ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','2026-10-26 11:00-06','2026-10-26 12:00-06');
select 'huecos', count(*), min(inicio) from huecos_disponibles('10000000-0000-0000-0000-000000000001','2026-10-26','1 hour','mecanica');
-- orden de trabajo
insert into ordenes_trabajo (id,sucursal_id,cita_id,cliente_id,vehiculo_id,kilometraje_ingreso) values ('b0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',42000);
insert into orden_servicios (id,orden_id,servicio_id,tecnico_id,descripcion,categoria_id) values ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',null,null);
insert into registros_tiempo (orden_servicio_id,tecnico_id,inicio,fin) values ('b1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','2026-10-26 10:05-06','2026-10-26 10:50-06');
\echo -- técnico como usuario: registra piezas por escaneo (RLS)
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
insert into orden_piezas (orden_servicio_id,articulo_id,ubicacion_id,cantidad,metodo) values ('b1000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',5,'escaneo');
select 'tec ve ordenes', count(*) from ordenes_trabajo;
select 'tec ve citas', count(*) from citas;
\echo -- técnico no puede crear clientes (debe fallar)
insert into clientes (nombre,telefono) values ('X','1');
\echo -- stock insuficiente (debe fallar)
insert into orden_piezas (orden_servicio_id,articulo_id,ubicacion_id,cantidad) values ('b1000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',50);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select 'otro tec ve ordenes', count(*) from ordenes_trabajo;
reset role;
-- consumir para disparar alerta: quedan 25 en sucursal, sacar 20 de almacén
insert into orden_piezas (orden_servicio_id,articulo_id,ubicacion_id,cantidad) values ('b1000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',20);
select 'alerta', stock_detectado, estado from alertas_reabastecimiento;
select * from v_stock_bajo;
update ordenes_trabajo set estado='en_proceso' where id='b0000000-0000-0000-0000-000000000001';
update ordenes_trabajo set estado='entregada' where id='b0000000-0000-0000-0000-000000000001';
insert into pagos (orden_id,monto,metodo) values ('b0000000-0000-0000-0000-000000000001',5000,'tarjeta');
select 'recordatorio', titulo, vence_fecha, vence_km, canal from recordatorios;
select 'km', kilometraje_actual from vehiculos;
select ingreso_total, costo_mano_obra, costo_piezas, horas_reales, pagado from v_orden_totales;
select * from v_rentabilidad_categoria;
select * from v_cliente_metricas;
insert into segmentos (id,nombre,reglas) values ('c0000000-0000-0000-0000-000000000001','Sedanes Nissan','{"marcas":["Nissan"],"tipos_vehiculo":["sedan"],"gasto_min":100}');
select 'segmento', nombre from clientes_en_segmento('c0000000-0000-0000-0000-000000000001');
select sku, rotacion, dias_de_inventario from v_rotacion_inventario;
select * from v_tiempo_servicio; select * from v_retencion_clientes; select * from v_historial_servicio;
\echo -- borrar pieza devuelve stock
delete from orden_piezas where cantidad=20;
select 'stock tras devolucion', stock_sucursal('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
select 'alertas', estado from alertas_reabastecimiento;
\echo -- movimiento inmutable (debe fallar)
update movimientos_inventario set cantidad=1 where id=1;
select 'auditoria', count(*) from auditoria;
