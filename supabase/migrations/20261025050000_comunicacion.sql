-- Comunicación con clientes: plantillas editables, recordatorios por fecha o kilometraje
-- y prefijo telefónico de la sucursal para armar los enlaces de WhatsApp.

alter table sucursales add column prefijo_telefono text not null default '52';

create table plantillas_mensaje (
  clave      text primary key,          -- recordatorio, confirmar_cita, vehiculo_listo, ...
  titulo     text not null,
  asunto     text,                      -- para correo
  texto      text not null,             -- admite {{nombre}}, {{placa}}, {{vehiculo}}, {{servicio}}, {{fecha}}, {{hora}}, {{taller}}, {{total}}
  updated_at timestamptz not null default now()
);

insert into plantillas_mensaje (clave, titulo, asunto, texto) values
  ('recordatorio', 'Recordatorio de servicio', 'Tu {{servicio}} está por vencer',
   'Hola {{nombre}}, te saludamos de {{taller}}. A tu {{vehiculo}} placa {{placa}} le toca {{servicio}} ({{fecha}}). ¿Te agendamos una cita? Responde a este mensaje y te damos horario.'),
  ('confirmar_cita', 'Confirmar cita', 'Confirma tu cita en {{taller}}',
   'Hola {{nombre}}, te recordamos tu cita en {{taller}} el {{fecha}} a las {{hora}} para tu {{vehiculo}} placa {{placa}} ({{servicio}}). ¿Nos confirmas tu asistencia?'),
  ('vehiculo_listo', 'Vehículo listo', 'Tu vehículo está listo',
   'Hola {{nombre}}, tu {{vehiculo}} placa {{placa}} ya está listo para entregar en {{taller}}. Total: {{total}}. Te esperamos.'),
  ('campana', 'Campaña (base)', 'Novedades de {{taller}}',
   'Hola {{nombre}}, en {{taller}} tenemos una promoción para tu {{vehiculo}}. Responde este mensaje para más información.')
on conflict do nothing;

alter table plantillas_mensaje enable row level security;
create policy plantillas_leer on plantillas_mensaje for select to authenticated using (rol_actual() is not null);
create policy plantillas_gestionar on plantillas_mensaje for all to authenticated
  using (tiene_rol('admin','gerente')) with check (tiene_rol('admin','gerente'));
grant select, insert, update, delete on plantillas_mensaje to authenticated;

-- Recordatorios que toca avisar: por fecha (con días de anticipación) o porque el último
-- kilometraje conocido ya está a 500 km o menos del que toca. Respeta los permisos (RLS).
drop view if exists v_recordatorios_por_enviar;
create view v_recordatorios_por_enviar with (security_invoker = true) as
select r.*, c.nombre as cliente_nombre, c.apellidos as cliente_apellidos, c.telefono, c.email, c.canal_preferido,
       v.placa, v.marca, v.modelo, v.kilometraje_actual,
       case when r.vence_fecha is not null and r.vence_fecha - r.avisar_dias_antes <= current_date then 'fecha'
            else 'km' end as motivo
  from recordatorios r
  join clientes c on c.id = r.cliente_id
  join vehiculos v on v.id = r.vehiculo_id
 where r.estado = 'pendiente'
   and c.activo
   and ((r.vence_fecha is not null and r.vence_fecha - r.avisar_dias_antes <= current_date)
     or (r.vence_km is not null and v.kilometraje_actual is not null and v.kilometraje_actual >= r.vence_km - 500));
grant select on v_recordatorios_por_enviar to authenticated;

-- Cuántos clientes hay en cada segmento (para la lista de segmentos)
create function contar_segmento(p_segmento uuid) returns bigint
language sql stable as $$ select count(*) from clientes_en_segmento(p_segmento) $$;
grant execute on function contar_segmento(uuid), clientes_en_segmento(uuid) to authenticated;
