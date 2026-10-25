-- Datos iniciales de ejemplo: una sucursal, sus bahías y un catálogo básico de servicios.
-- Ajusta nombres, precios y horarios a tu taller antes de usarlo en producción.

insert into sucursales (id, nombre, direccion, zona_horaria) values
  ('00000000-0000-4000-8000-000000000001', 'Matriz', 'Dirección del taller', 'America/Lima')
on conflict do nothing;

insert into bahias (sucursal_id, nombre, tipo) values
  ('00000000-0000-4000-8000-000000000001', 'Elevador 1', 'mecanica'),
  ('00000000-0000-4000-8000-000000000001', 'Elevador 2', 'mecanica'),
  ('00000000-0000-4000-8000-000000000001', 'Alineación', 'alineacion'),
  ('00000000-0000-4000-8000-000000000001', 'Lavado', 'lavado'),
  ('00000000-0000-4000-8000-000000000001', 'Pulido y cerámico', 'detailing')
on conflict do nothing;

insert into ubicaciones (sucursal_id, codigo, descripcion) values
  ('00000000-0000-4000-8000-000000000001', 'ALM-A1', 'Almacén, anaquel A, nivel 1'),
  ('00000000-0000-4000-8000-000000000001', 'ALM-A2', 'Almacén, anaquel A, nivel 2')
on conflict do nothing;

insert into categorias_servicio (nombre, color) values
  ('Mantenimiento', '#24576e'), ('Frenos', '#b42318'), ('Suspensión y dirección', '#7a5af8'),
  ('Eléctrico', '#9a6700'), ('Diagnóstico', '#5b6672'), ('Detailing exterior', '#2f7d4f'),
  ('Detailing interior', '#0e7490')
on conflict do nothing;

insert into servicios (categoria_id, codigo, nombre, precio_base, horas_estandar, tipo_bahia_requerida, intervalo_recordatorio_dias, intervalo_recordatorio_km)
select c.id, s.codigo, s.nombre, s.precio, s.horas, s.bahia, s.dias, s.km
from (values
  ('Mantenimiento', 'MNT-ACE', 'Cambio de aceite y filtro', 450, 1.0, 'mecanica', 180, 5000),
  ('Mantenimiento', 'MNT-AFI', 'Afinación mayor', 1800, 3.0, 'mecanica', 365, 20000),
  ('Frenos', 'FRE-DEL', 'Balatas delanteras', 650, 1.5, 'mecanica', null, null),
  ('Suspensión y dirección', 'SUS-ALI', 'Alineación y balanceo', 550, 1.0, 'alineacion', 180, 10000),
  ('Diagnóstico', 'DIA-ESC', 'Diagnóstico con escáner', 400, 1.0, 'mecanica', null, null),
  ('Eléctrico', 'ELE-BAT', 'Revisión y cambio de batería', 250, 0.5, 'mecanica', null, null),
  ('Detailing exterior', 'DET-LAV', 'Lavado premium', 350, 1.5, 'lavado', 30, null),
  ('Detailing exterior', 'DET-CER', 'Recubrimiento cerámico', 6500, 8.0, 'detailing', 365, null),
  ('Detailing interior', 'DET-INT', 'Limpieza profunda de interiores', 1200, 4.0, 'lavado', 180, null)
) as s(categoria, codigo, nombre, precio, horas, bahia, dias, km)
join categorias_servicio c on c.nombre = s.categoria
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- Alta de usuarios
-- 1. Crea o invita al usuario en Supabase → Authentication → Users.
-- 2. Asígnale rol y sucursal (cambia el correo):
--
-- insert into perfiles (id, nombre, rol, sucursal_id, costo_hora)
-- select id, 'Nombre Apellido', 'tecnico', '00000000-0000-4000-8000-000000000001', 120
--   from auth.users where email = 'tecnico@tutaller.com';
--
-- 3. Para técnicos, define su turno (0 = domingo … 6 = sábado):
--
-- insert into horarios_tecnico (tecnico_id, dia_semana, hora_inicio, hora_fin)
-- select p.id, d, '08:00', '18:00' from perfiles p, generate_series(1, 6) d
--  where p.nombre = 'Nombre Apellido';
-- ---------------------------------------------------------------------------
