-- Actualización: configuración para Perú (25 oct 2026): hora de Lima y lada 51.
-- Ejecútalo UNA vez en Supabase → SQL Editor, después de la de mensajes.

-- El taller está en Perú: hora de Lima y lada 51 para WhatsApp (la moneda se muestra en soles desde la app).
alter table sucursales alter column zona_horaria set default 'America/Lima';
alter table sucursales alter column prefijo_telefono set default '51';
update sucursales set zona_horaria = 'America/Lima', prefijo_telefono = '51'
 where zona_horaria = 'America/Mexico_City';
