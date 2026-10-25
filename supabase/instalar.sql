-- Instalación completa de la base de datos del Taller JGA (incluye todas las actualizaciones).
-- Pégalo entero en Supabase → SQL Editor → New query y pulsa Run. Se ejecuta una sola vez, en un proyecto vacío.

-- =============================================================================
--  Sistema de gestión para taller automotriz / detailing
--  Esquema PostgreSQL 15+ pensado para Supabase (auth.users, auth.uid(), RLS)
--
--  Orden del archivo
--    0. Extensiones y tipos
--    1. Organización: sucursales, bahías, ubicaciones, usuarios y roles
--    2. CRM: clientes y vehículos
--    3. Catálogo de servicios
--    4. Inventario: artículos, proveedores, existencias, movimientos, compras
--    5. Agenda: horarios, ausencias y citas (sin doble reserva)
--    6. Órdenes de trabajo: servicios, mano de obra, piezas, pagos
--    7. Comunicación, recordatorios, segmentos, campañas y fidelización
--    8. Auditoría
--    9. Funciones de negocio (escaneo, recepción de compras, segmentos)
--   10. Vistas de KPI
--   11. Seguridad: Row Level Security por rol
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensiones y tipos
-- -----------------------------------------------------------------------------
create extension if not exists btree_gist;   -- exclusión (= y &&) en citas
create extension if not exists pg_trgm;      -- búsqueda difusa de clientes/placas
create extension if not exists citext;       -- correos sin distinción de mayúsculas

create type rol_usuario        as enum ('admin', 'gerente', 'recepcion', 'tecnico');
create type tipo_cliente       as enum ('persona', 'empresa');
create type canal_contacto     as enum ('llamada', 'email', 'sms', 'whatsapp', 'nota', 'visita');
create type direccion_mensaje  as enum ('entrante', 'saliente', 'interna');
create type tipo_vehiculo      as enum ('sedan', 'hatchback', 'suv', 'pickup', 'van', 'moto', 'camion', 'otro');
create type tipo_articulo      as enum ('pieza', 'insumo', 'consumible', 'quimico_detailing', 'accesorio');
create type tipo_movimiento    as enum ('entrada_compra', 'salida_orden', 'devolucion_orden',
                                        'ajuste_positivo', 'ajuste_negativo',
                                        'transferencia_entrada', 'transferencia_salida', 'merma');
create type metodo_captura     as enum ('escaneo', 'manual', 'sistema');
create type estado_cita        as enum ('programada', 'confirmada', 'en_curso', 'completada', 'cancelada', 'no_asistio');
create type estado_orden       as enum ('abierta', 'diagnostico', 'esperando_aprobacion', 'esperando_piezas',
                                        'en_proceso', 'control_calidad', 'terminada', 'entregada', 'cancelada');
create type estado_oc          as enum ('borrador', 'enviada', 'parcial', 'recibida', 'cancelada');
create type estado_alerta      as enum ('abierta', 'en_compra', 'resuelta', 'descartada');
create type estado_recordatorio as enum ('pendiente', 'enviado', 'completado', 'cancelado');
create type metodo_pago        as enum ('efectivo', 'tarjeta', 'transferencia', 'credito', 'otro');

-- updated_at automático
create function fn_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Organización
-- -----------------------------------------------------------------------------
create table sucursales (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  direccion   text,
  telefono    text,
  zona_horaria text not null default 'America/Mexico_City',
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Bahías / espacios de servicio (elevador, cabina de pintura, área de lavado...)
create table bahias (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id),
  nombre      text not null,
  tipo        text not null default 'general',          -- mecanica, alineacion, lavado, pulido...
  activa      boolean not null default true,
  unique (sucursal_id, nombre)
);

-- Ubicaciones físicas de inventario: estantes del almacén o una bahía concreta
create table ubicaciones (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id),
  codigo      text not null,                              -- ej. "A-03-2" (pasillo-estante-nivel)
  descripcion text,
  bahia_id    uuid references bahias(id),                 -- si el stock vive en una bahía
  activa      boolean not null default true,
  unique (sucursal_id, codigo)
);

-- Perfil de cada usuario de Supabase Auth
create table perfiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  rol           rol_usuario not null,
  sucursal_id   uuid references sucursales(id),          -- null = todas (admin)
  telefono      text,
  especialidades text[] not null default '{}',           -- ej. {frenos, electrico, ceramico}
  costo_hora    numeric(10,2) not null default 0,         -- costo interno de la hora del técnico
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_perfiles_touch before update on perfiles
  for each row execute function fn_touch_updated_at();

-- Helpers de seguridad (security definer para no recursar en RLS)
create function rol_actual() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create function tiene_rol(variadic roles rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = any(roles) from perfiles where id = auth.uid() and activo), false)
$$;

create function puede_ver_sucursal(p_sucursal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select activo and (rol = 'admin' or sucursal_id is null or sucursal_id = p_sucursal)
    from perfiles where id = auth.uid()), false)
$$;

-- -----------------------------------------------------------------------------
-- 2. CRM: clientes y vehículos
-- -----------------------------------------------------------------------------
create table clientes (
  id                uuid primary key default gen_random_uuid(),
  tipo              tipo_cliente not null default 'persona',
  nombre            text not null,
  apellidos         text,
  razon_social      text,
  documento_fiscal  text unique,                          -- RFC / NIT / RUC
  telefono          text,
  telefono_alt      text,
  email             citext,
  direccion         text,
  fecha_nacimiento  date,
  canal_preferido   canal_contacto not null default 'whatsapp',
  acepta_marketing  boolean not null default false,       -- consentimiento explícito
  origen            text,                                 -- referido, google, redes...
  notas             text,
  sucursal_origen_id uuid references sucursales(id),
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint cliente_contacto check (telefono is not null or email is not null)
);
create index clientes_busqueda_idx on clientes
  using gin ((coalesce(nombre,'') || ' ' || coalesce(apellidos,'') || ' ' || coalesce(telefono,'')) gin_trgm_ops);
create trigger trg_clientes_touch before update on clientes
  for each row execute function fn_touch_updated_at();

create table vehiculos (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes(id),
  placa              text not null,
  placa_norm         text generated always as (upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g'))) stored,
  vin                text unique check (vin is null or length(vin) = 17),
  marca              text not null,
  modelo             text not null,
  anio               smallint not null check (anio between 1950 and 2100),
  version            text,
  color              text,
  tipo               tipo_vehiculo not null default 'sedan',
  motor              text,
  combustible        text,
  kilometraje_actual integer check (kilometraje_actual >= 0),
  notas              text,
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Placa única entre vehículos activos, normalizada (sin espacios ni guiones)
create unique index vehiculos_placa_uk on vehiculos (placa_norm) where activo;
create index vehiculos_placa_trgm on vehiculos using gin (placa_norm gin_trgm_ops);
create index vehiculos_cliente_idx on vehiculos (cliente_id);
create index vehiculos_marca_modelo_idx on vehiculos (marca, modelo, anio);
create trigger trg_vehiculos_touch before update on vehiculos
  for each row execute function fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Catálogo de servicios (categorías = "tipo de trabajo")
-- -----------------------------------------------------------------------------
create table categorias_servicio (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique,            -- Mantenimiento, Frenos, Suspensión, Eléctrico, Detailing interior...
  color   text                             -- para el calendario
);

create table servicios (
  id                       uuid primary key default gen_random_uuid(),
  categoria_id             uuid not null references categorias_servicio(id),
  codigo                   text unique,
  nombre                   text not null,
  descripcion              text,
  precio_base              numeric(12,2) not null default 0 check (precio_base >= 0),
  horas_estandar           numeric(6,2) not null default 1 check (horas_estandar > 0),
  tipo_bahia_requerida     text,                       -- debe coincidir con bahias.tipo
  intervalo_recordatorio_dias integer check (intervalo_recordatorio_dias > 0),  -- ej. 180
  intervalo_recordatorio_km   integer check (intervalo_recordatorio_km > 0),    -- ej. 5000
  activo                   boolean not null default true
);

-- Piezas/insumos que un servicio consume normalmente (kit sugerido)
create table servicio_articulos_sugeridos (
  servicio_id uuid not null references servicios(id) on delete cascade,
  articulo_id uuid not null,               -- FK añadida tras crear articulos
  cantidad    numeric(12,3) not null check (cantidad > 0),
  primary key (servicio_id, articulo_id)
);

-- -----------------------------------------------------------------------------
-- 4. Inventario
-- -----------------------------------------------------------------------------
create table categorias_articulo (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null unique,
  padre_id  uuid references categorias_articulo(id)       -- jerarquía: Frenos > Pastillas
);

create table marcas (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique
);

create table proveedores (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  documento_fiscal text unique,
  contacto         text,
  telefono         text,
  email            citext,
  direccion        text,
  condiciones_pago text,                                  -- ej. "30 días"
  dias_entrega     integer check (dias_entrega >= 0),
  calificacion     smallint check (calificacion between 1 and 5),
  activo           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table articulos (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  codigo_barras   text unique,                            -- EAN-13 / UPC / Code128
  nombre          text not null,
  descripcion     text,
  tipo            tipo_articulo not null,
  categoria_id    uuid references categorias_articulo(id),
  marca_id        uuid references marcas(id),
  unidad          text not null default 'pieza',          -- pieza, litro, galón, metro
  costo_promedio  numeric(12,4) not null default 0 check (costo_promedio >= 0),  -- promedio ponderado
  ultimo_costo    numeric(12,4),
  precio_venta    numeric(12,2) not null default 0 check (precio_venta >= 0),
  tasa_impuesto   numeric(5,4) not null default 0.16,
  compatibilidad  jsonb not null default '[]',            -- [{"marca":"Nissan","modelo":"Versa","anios":[2016,2020]}]
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index articulos_nombre_trgm on articulos using gin (nombre gin_trgm_ops);
create trigger trg_articulos_touch before update on articulos
  for each row execute function fn_touch_updated_at();

alter table servicio_articulos_sugeridos
  add foreign key (articulo_id) references articulos(id);

create table articulo_proveedores (
  articulo_id       uuid not null references articulos(id) on delete cascade,
  proveedor_id      uuid not null references proveedores(id),
  codigo_proveedor  text,
  costo             numeric(12,4) not null check (costo >= 0),
  cantidad_minima   numeric(12,3) not null default 1,
  preferido         boolean not null default false,
  primary key (articulo_id, proveedor_id)
);
create unique index articulo_proveedor_preferido_uk on articulo_proveedores (articulo_id) where preferido;

-- Umbrales de reabastecimiento por sucursal
create table parametros_stock (
  articulo_id      uuid not null references articulos(id) on delete cascade,
  sucursal_id      uuid not null references sucursales(id),
  punto_reorden    numeric(12,3) not null default 0 check (punto_reorden >= 0),
  cantidad_reorden numeric(12,3) not null default 0 check (cantidad_reorden >= 0),
  stock_maximo     numeric(12,3) check (stock_maximo is null or stock_maximo >= punto_reorden),
  primary key (articulo_id, sucursal_id)
);

-- Saldo actual por artículo y ubicación. Solo lo escribe el trigger de movimientos.
create table existencias (
  articulo_id  uuid not null references articulos(id),
  ubicacion_id uuid not null references ubicaciones(id),
  cantidad     numeric(12,3) not null default 0 check (cantidad >= 0),   -- nunca negativo
  updated_at   timestamptz not null default now(),
  primary key (articulo_id, ubicacion_id)
);

create table ordenes_compra (
  id            uuid primary key default gen_random_uuid(),
  folio         bigint generated always as identity unique,
  proveedor_id  uuid not null references proveedores(id),
  sucursal_id   uuid not null references sucursales(id),
  estado        estado_oc not null default 'borrador',
  fecha_esperada date,
  notas         text,
  creada_por    uuid references perfiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_oc_touch before update on ordenes_compra
  for each row execute function fn_touch_updated_at();

create table ordenes_compra_lineas (
  id                uuid primary key default gen_random_uuid(),
  orden_compra_id   uuid not null references ordenes_compra(id) on delete cascade,
  articulo_id       uuid not null references articulos(id),
  cantidad          numeric(12,3) not null check (cantidad > 0),
  costo_unitario    numeric(12,4) not null check (costo_unitario >= 0),
  cantidad_recibida numeric(12,3) not null default 0 check (cantidad_recibida >= 0),
  constraint oc_no_sobre_recepcion check (cantidad_recibida <= cantidad)
);

-- Libro mayor de inventario: solo inserciones. Toda variación de stock pasa por aquí.
create table movimientos_inventario (
  id               bigint generated always as identity primary key,
  articulo_id      uuid not null references articulos(id),
  ubicacion_id     uuid not null references ubicaciones(id),
  tipo             tipo_movimiento not null,
  cantidad         numeric(12,3) not null check (cantidad <> 0),   -- + entra, - sale
  costo_unitario   numeric(12,4),                                  -- costo al momento del movimiento
  metodo           metodo_captura not null default 'manual',
  oc_linea_id      uuid references ordenes_compra_lineas(id),
  orden_pieza_id   uuid,                                           -- FK tras crear orden_piezas
  transferencia_id uuid,                                           -- agrupa salida+entrada
  motivo           text,
  usuario_id       uuid references perfiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint mov_signo check (
    (tipo in ('entrada_compra','devolucion_orden','ajuste_positivo','transferencia_entrada') and cantidad > 0) or
    (tipo in ('salida_orden','ajuste_negativo','transferencia_salida','merma') and cantidad < 0)),
  constraint mov_ajuste_motivo check (tipo not in ('ajuste_positivo','ajuste_negativo','merma') or motivo is not null)
);
create index mov_articulo_fecha_idx on movimientos_inventario (articulo_id, created_at);
create index mov_tipo_fecha_idx on movimientos_inventario (tipo, created_at);

create table alertas_reabastecimiento (
  id              uuid primary key default gen_random_uuid(),
  articulo_id     uuid not null references articulos(id),
  sucursal_id     uuid not null references sucursales(id),
  stock_detectado numeric(12,3) not null,
  punto_reorden   numeric(12,3) not null,
  estado          estado_alerta not null default 'abierta',
  orden_compra_id uuid references ordenes_compra(id),
  created_at      timestamptz not null default now(),
  resuelta_en     timestamptz
);
-- Una sola alerta viva por artículo y sucursal
create unique index alerta_abierta_uk on alertas_reabastecimiento (articulo_id, sucursal_id)
  where estado in ('abierta', 'en_compra');

-- Stock total de un artículo en una sucursal
create function stock_sucursal(p_articulo uuid, p_sucursal uuid) returns numeric
language sql stable as $$
  select coalesce(sum(e.cantidad), 0)
  from existencias e join ubicaciones u on u.id = e.ubicacion_id
  where e.articulo_id = p_articulo and u.sucursal_id = p_sucursal
$$;

-- Aplica cada movimiento al saldo, recalcula costo promedio y dispara alertas
create function fn_aplicar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sucursal  uuid;
  v_total     numeric;
  v_stock     numeric;
  v_param     parametros_stock%rowtype;
begin
  select sucursal_id into v_sucursal from ubicaciones where id = new.ubicacion_id;

  -- Costo promedio ponderado en entradas por compra
  if new.tipo = 'entrada_compra' and new.costo_unitario is not null then
    select coalesce(sum(cantidad), 0) into v_total from existencias where articulo_id = new.articulo_id;
    update articulos
       set costo_promedio = case when v_total + new.cantidad > 0
                                 then (v_total * costo_promedio + new.cantidad * new.costo_unitario) / (v_total + new.cantidad)
                                 else new.costo_unitario end,
           ultimo_costo   = new.costo_unitario
     where id = new.articulo_id;
  end if;

  -- Saldo (el CHECK cantidad >= 0 impide stock negativo y aborta la transacción).
  -- Se actualiza primero: un INSERT ... ON CONFLICT validaría el CHECK sobre la fila
  -- propuesta (negativa) antes de llegar a la rama UPDATE.
  update existencias set cantidad = cantidad + new.cantidad, updated_at = now()
   where articulo_id = new.articulo_id and ubicacion_id = new.ubicacion_id;
  if not found then
    insert into existencias as e (articulo_id, ubicacion_id, cantidad)
    values (new.articulo_id, new.ubicacion_id, new.cantidad)
    on conflict (articulo_id, ubicacion_id)
    do update set cantidad = e.cantidad + excluded.cantidad, updated_at = now();
  end if;

  -- Alerta de reabastecimiento
  select * into v_param from parametros_stock
   where articulo_id = new.articulo_id and sucursal_id = v_sucursal;
  if found then
    v_stock := stock_sucursal(new.articulo_id, v_sucursal);
    if v_stock <= v_param.punto_reorden then
      insert into alertas_reabastecimiento (articulo_id, sucursal_id, stock_detectado, punto_reorden)
      values (new.articulo_id, v_sucursal, v_stock, v_param.punto_reorden)
      on conflict (articulo_id, sucursal_id) where estado in ('abierta','en_compra') do nothing;
      perform pg_notify('reabastecimiento', json_build_object(
        'articulo_id', new.articulo_id, 'sucursal_id', v_sucursal, 'stock', v_stock)::text);
    else
      update alertas_reabastecimiento set estado = 'resuelta', resuelta_en = now()
       where articulo_id = new.articulo_id and sucursal_id = v_sucursal and estado in ('abierta','en_compra');
    end if;
  end if;
  return new;
end $$;

create trigger trg_movimiento_aplicar after insert on movimientos_inventario
  for each row execute function fn_aplicar_movimiento();

-- El libro mayor es inmutable: se corrige con un movimiento inverso, no editando
create function fn_bloquear_cambio() returns trigger language plpgsql as $$
begin
  raise exception 'La tabla % es de solo inserción; registre un movimiento de ajuste', tg_table_name;
end $$;
create trigger trg_movimiento_inmutable before update or delete on movimientos_inventario
  for each row execute function fn_bloquear_cambio();

-- -----------------------------------------------------------------------------
-- 5. Agenda: disponibilidad y citas
-- -----------------------------------------------------------------------------
create table horarios_tecnico (
  id          uuid primary key default gen_random_uuid(),
  tecnico_id  uuid not null references perfiles(id) on delete cascade,
  dia_semana  smallint not null check (dia_semana between 0 and 6),   -- 0 = domingo
  hora_inicio time not null,
  hora_fin    time not null,
  check (hora_fin > hora_inicio),
  exclude using gist (tecnico_id with =, dia_semana with =,
                      tsrange('2000-01-01'::date + hora_inicio, '2000-01-01'::date + hora_fin) with &&)
);

create table ausencias_tecnico (
  id          uuid primary key default gen_random_uuid(),
  tecnico_id  uuid not null references perfiles(id) on delete cascade,
  periodo     tstzrange not null,
  motivo      text,
  exclude using gist (tecnico_id with =, periodo with &&)
);

create table citas (
  id             uuid primary key default gen_random_uuid(),
  sucursal_id    uuid not null references sucursales(id),
  cliente_id     uuid not null references clientes(id),
  vehiculo_id    uuid not null references vehiculos(id),
  bahia_id       uuid references bahias(id),
  tecnico_id     uuid references perfiles(id),
  servicio_id    uuid references servicios(id),                 -- servicio principal solicitado
  inicio         timestamptz not null,
  fin            timestamptz not null,
  periodo        tstzrange generated always as (tstzrange(inicio, fin, '[)')) stored,
  estado         estado_cita not null default 'programada',
  motivo_cliente text,
  canal_origen   canal_contacto,
  creada_por     uuid references perfiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (fin > inicio),
  -- Reglas anti doble reserva: la base de datos rechaza el traslape, aunque dos
  -- recepcionistas reserven el mismo hueco al mismo tiempo.
  constraint cita_bahia_sin_traslape exclude using gist (bahia_id with =, periodo with &&)
    where (estado in ('programada','confirmada','en_curso')),
  constraint cita_tecnico_sin_traslape exclude using gist (tecnico_id with =, periodo with &&)
    where (estado in ('programada','confirmada','en_curso'))
);
create index citas_sucursal_inicio_idx on citas (sucursal_id, inicio);
create index citas_cliente_idx on citas (cliente_id);
create trigger trg_citas_touch before update on citas
  for each row execute function fn_touch_updated_at();

-- Valida reglas que una restricción no puede expresar
create function fn_validar_cita() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tz  text;
  v_ok  boolean;
begin
  if new.estado not in ('programada','confirmada','en_curso') then
    return new;
  end if;

  -- El vehículo pertenece al cliente
  if not exists (select 1 from vehiculos where id = new.vehiculo_id and cliente_id = new.cliente_id) then
    raise exception 'El vehículo no pertenece al cliente indicado';
  end if;

  -- La bahía está activa y es de la misma sucursal
  if new.bahia_id is not null and not exists (
       select 1 from bahias where id = new.bahia_id and sucursal_id = new.sucursal_id and activa) then
    raise exception 'La bahía no está activa o no pertenece a la sucursal';
  end if;

  if new.tecnico_id is not null then
    -- Es técnico activo
    if not exists (select 1 from perfiles where id = new.tecnico_id and rol = 'tecnico' and activo) then
      raise exception 'El usuario asignado no es un técnico activo';
    end if;

    -- No está ausente (vacaciones, incapacidad, capacitación)
    if exists (select 1 from ausencias_tecnico where tecnico_id = new.tecnico_id and periodo && new.periodo) then
      raise exception 'El técnico tiene una ausencia registrada en ese horario';
    end if;

    -- Cae dentro de su turno, en la zona horaria de la sucursal
    select zona_horaria into v_tz from sucursales where id = new.sucursal_id;
    select exists (
      select 1 from horarios_tecnico h
       where h.tecnico_id = new.tecnico_id
         and h.dia_semana = extract(dow from new.inicio at time zone v_tz)
         and (new.inicio at time zone v_tz)::date = (new.fin at time zone v_tz)::date
         and (new.inicio at time zone v_tz)::time >= h.hora_inicio
         and (new.fin    at time zone v_tz)::time <= h.hora_fin
    ) into v_ok;
    if not v_ok then
      raise exception 'La cita queda fuera del turno del técnico';
    end if;
  end if;
  return new;
end $$;

create trigger trg_citas_validar before insert or update on citas
  for each row execute function fn_validar_cita();

-- -----------------------------------------------------------------------------
-- 6. Órdenes de trabajo (historial de servicio)
-- -----------------------------------------------------------------------------
create table ordenes_trabajo (
  id                  uuid primary key default gen_random_uuid(),
  folio               bigint generated always as identity unique,
  sucursal_id         uuid not null references sucursales(id),
  cita_id             uuid unique references citas(id),
  cliente_id          uuid not null references clientes(id),
  vehiculo_id         uuid not null references vehiculos(id),
  bahia_id            uuid references bahias(id),
  asesor_id           uuid references perfiles(id),            -- recepción que abrió la orden
  estado              estado_orden not null default 'abierta',
  kilometraje_ingreso integer check (kilometraje_ingreso >= 0),
  nivel_combustible   smallint check (nivel_combustible between 0 and 100),
  inventario_vehiculo jsonb not null default '{}',              -- checklist de recepción (gato, llanta, golpes)
  fotos_ingreso       text[] not null default '{}',             -- rutas en Supabase Storage
  diagnostico         text,
  descuento           numeric(12,2) not null default 0 check (descuento >= 0),
  -- Marcas de tiempo del ciclo de vida
  recibido_en         timestamptz not null default now(),
  aprobado_en         timestamptz,
  iniciado_en         timestamptz,
  terminado_en        timestamptz,
  entregado_en        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (terminado_en is null or iniciado_en is null or terminado_en >= iniciado_en),
  check (entregado_en is null or terminado_en is null or entregado_en >= terminado_en)
);
create index ot_vehiculo_idx on ordenes_trabajo (vehiculo_id, recibido_en desc);
create index ot_cliente_idx on ordenes_trabajo (cliente_id, recibido_en desc);
create index ot_estado_idx on ordenes_trabajo (sucursal_id, estado);
create trigger trg_ot_touch before update on ordenes_trabajo
  for each row execute function fn_touch_updated_at();

-- Cada trabajo realizado dentro de la orden, clasificado por categoría
create table orden_servicios (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references ordenes_trabajo(id) on delete cascade,
  servicio_id    uuid references servicios(id),
  categoria_id   uuid not null references categorias_servicio(id),   -- copia: el historial no cambia si cambia el catálogo
  descripcion    text not null,
  tecnico_id     uuid references perfiles(id),
  horas_cobradas numeric(6,2) not null default 0 check (horas_cobradas >= 0),
  precio         numeric(12,2) not null default 0 check (precio >= 0), -- mano de obra cobrada
  aprobado       boolean not null default false,                       -- aprobado por el cliente
  completado_en  timestamptz,
  created_at     timestamptz not null default now()
);
create index os_orden_idx on orden_servicios (orden_id);
create index os_tecnico_idx on orden_servicios (tecnico_id);

-- Si viene del catálogo y no se dio categoría/precio, se copian
create function fn_os_defaults() returns trigger language plpgsql as $$
declare s servicios%rowtype;
begin
  if new.servicio_id is not null then
    select * into s from servicios where id = new.servicio_id;
    new.categoria_id   := coalesce(new.categoria_id, s.categoria_id);
    new.descripcion    := coalesce(new.descripcion, s.nombre);
    if tg_op = 'INSERT' and new.precio = 0 then new.precio := s.precio_base; end if;
    if tg_op = 'INSERT' and new.horas_cobradas = 0 then new.horas_cobradas := s.horas_estandar; end if;
  end if;
  return new;
end $$;
create trigger trg_os_defaults before insert on orden_servicios
  for each row execute function fn_os_defaults();

-- Horas reales trabajadas (reloj del técnico desde el móvil)
create table registros_tiempo (
  id                uuid primary key default gen_random_uuid(),
  orden_servicio_id uuid not null references orden_servicios(id) on delete cascade,
  tecnico_id        uuid not null references perfiles(id),
  inicio            timestamptz not null,
  fin               timestamptz,
  horas             numeric(6,2) generated always as
                      (case when fin is null then null
                            else round((extract(epoch from (fin - inicio)) / 3600)::numeric, 2) end) stored,
  costo_hora        numeric(10,2) not null default 0,     -- copia de perfiles.costo_hora al registrar
  notas             text,
  check (fin is null or fin > inicio),
  -- Un técnico no puede tener dos relojes encendidos a la vez
  exclude using gist (tecnico_id with =, tstzrange(inicio, coalesce(fin, 'infinity'), '[)') with &&)
);

create function fn_tiempo_costo() returns trigger language plpgsql as $$
begin
  if new.costo_hora = 0 then
    select costo_hora into new.costo_hora from perfiles where id = new.tecnico_id;
  end if;
  return new;
end $$;
create trigger trg_tiempo_costo before insert on registros_tiempo
  for each row execute function fn_tiempo_costo();

-- Piezas e insumos usados; cada fila descuenta stock automáticamente
create table orden_piezas (
  id                uuid primary key default gen_random_uuid(),
  orden_servicio_id uuid not null references orden_servicios(id) on delete cascade,
  articulo_id       uuid not null references articulos(id),
  ubicacion_id      uuid not null references ubicaciones(id),
  cantidad          numeric(12,3) not null check (cantidad > 0),
  costo_unitario    numeric(12,4),           -- se congela al registrar (costo promedio)
  precio_unitario   numeric(12,2),           -- se congela al registrar (precio de venta)
  metodo            metodo_captura not null default 'manual',
  registrado_por    uuid references perfiles(id) default auth.uid(),
  created_at        timestamptz not null default now()
);
create index op_os_idx on orden_piezas (orden_servicio_id);

-- movimientos_inventario.orden_pieza_id queda como referencia sin FK a propósito:
-- el libro mayor es inmutable y debe conservar la traza aunque la pieza se retire.

create function fn_orden_pieza_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- congela costo y precio
    select coalesce(new.costo_unitario, a.costo_promedio), coalesce(new.precio_unitario, a.precio_venta)
      into new.costo_unitario, new.precio_unitario
      from articulos a where a.id = new.articulo_id;
    return new;
  end if;
  return null;
end $$;
create trigger trg_op_congelar before insert on orden_piezas
  for each row execute function fn_orden_pieza_stock();

create function fn_orden_pieza_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into movimientos_inventario (articulo_id, ubicacion_id, tipo, cantidad, costo_unitario, metodo, orden_pieza_id, usuario_id)
    values (new.articulo_id, new.ubicacion_id, 'salida_orden', -new.cantidad, new.costo_unitario, new.metodo, new.id, new.registrado_por);
    return new;
  elsif tg_op = 'DELETE' then
    insert into movimientos_inventario (articulo_id, ubicacion_id, tipo, cantidad, costo_unitario, metodo, motivo, usuario_id)
    values (old.articulo_id, old.ubicacion_id, 'devolucion_orden', old.cantidad, old.costo_unitario, 'sistema',
            'Pieza retirada de la orden', auth.uid());
    return old;
  end if;
  return null;
end $$;
create trigger trg_op_movimiento after insert or delete on orden_piezas
  for each row execute function fn_orden_pieza_movimiento();

-- Una pieza ya registrada no se edita: se borra (devuelve stock) y se registra de nuevo
create trigger trg_op_inmutable before update on orden_piezas
  for each row execute function fn_bloquear_cambio();

create table pagos (
  id         uuid primary key default gen_random_uuid(),
  orden_id   uuid not null references ordenes_trabajo(id),
  monto      numeric(12,2) not null check (monto <> 0),     -- negativo = reembolso
  metodo     metodo_pago not null,
  referencia text,
  recibido_por uuid references perfiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index pagos_orden_idx on pagos (orden_id);

-- -----------------------------------------------------------------------------
-- 7. Comunicación, recordatorios, segmentos, campañas, fidelización
-- -----------------------------------------------------------------------------
create table comunicaciones (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references clientes(id),
  vehiculo_id    uuid references vehiculos(id),
  orden_id       uuid references ordenes_trabajo(id),
  cita_id        uuid references citas(id),
  canal          canal_contacto not null,
  direccion      direccion_mensaje not null,
  asunto         text,
  contenido      text not null,
  duracion_seg   integer,                         -- llamadas
  estado_envio   text,                            -- queued, sent, delivered, failed (Twilio/Resend)
  id_externo     text,                            -- SID de Twilio / id de Resend
  recordatorio_id uuid,                           -- FK tras crear recordatorios
  campana_id     uuid,                            -- FK tras crear campanas
  usuario_id     uuid references perfiles(id) default auth.uid(),
  ocurrido_en    timestamptz not null default now()
);
create index com_cliente_idx on comunicaciones (cliente_id, ocurrido_en desc);
create unique index com_id_externo_uk on comunicaciones (id_externo) where id_externo is not null;

create table recordatorios (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references clientes(id),
  vehiculo_id     uuid not null references vehiculos(id),
  servicio_id     uuid references servicios(id),
  titulo          text not null,                  -- "Cambio de aceite", "Verificación vehicular"
  vence_fecha     date,
  vence_km        integer,
  avisar_dias_antes integer not null default 7,
  canal           canal_contacto,
  estado          estado_recordatorio not null default 'pendiente',
  orden_origen_id uuid references ordenes_trabajo(id),
  enviado_en      timestamptz,
  created_at      timestamptz not null default now(),
  check (vence_fecha is not null or vence_km is not null)
);
create index rec_pendientes_idx on recordatorios (vence_fecha) where estado = 'pendiente';

alter table comunicaciones add foreign key (recordatorio_id) references recordatorios(id);

-- Al entregar una orden: actualiza el kilometraje y programa recordatorios
create function fn_orden_entregada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'entregada' and old.estado is distinct from 'entregada' then
    new.entregado_en := coalesce(new.entregado_en, now());
    new.terminado_en := coalesce(new.terminado_en, new.entregado_en);

    if new.kilometraje_ingreso is not null then
      update vehiculos set kilometraje_actual = greatest(coalesce(kilometraje_actual, 0), new.kilometraje_ingreso)
       where id = new.vehiculo_id;
    end if;

    -- El servicio recién hecho cierra el recordatorio anterior del mismo tipo
    update recordatorios r set estado = 'completado'
     where r.vehiculo_id = new.vehiculo_id and r.estado in ('pendiente','enviado')
       and r.servicio_id in (select servicio_id from orden_servicios where orden_id = new.id);

    insert into recordatorios (cliente_id, vehiculo_id, servicio_id, titulo, vence_fecha, vence_km, canal, orden_origen_id)
    select new.cliente_id, new.vehiculo_id, s.id, s.nombre,
           case when s.intervalo_recordatorio_dias is not null
                then (new.entregado_en::date + s.intervalo_recordatorio_dias) end,
           case when s.intervalo_recordatorio_km is not null and new.kilometraje_ingreso is not null
                then new.kilometraje_ingreso + s.intervalo_recordatorio_km end,
           c.canal_preferido, new.id
      from (select distinct servicio_id from orden_servicios where orden_id = new.id and servicio_id is not null) os
      join servicios s on s.id = os.servicio_id
      join clientes c on c.id = new.cliente_id
     where s.intervalo_recordatorio_dias is not null
        or (s.intervalo_recordatorio_km is not null and new.kilometraje_ingreso is not null);
  end if;

  if new.estado = 'en_proceso' and new.iniciado_en is null then
    new.iniciado_en := now();
  end if;
  if new.estado = 'terminada' and new.terminado_en is null then
    new.terminado_en := now();
  end if;
  return new;
end $$;
create trigger trg_ot_estado before update of estado on ordenes_trabajo
  for each row execute function fn_orden_entregada();

-- Lo que el job diario (pg_cron → Edge Function → Twilio/Resend) debe enviar hoy
create view v_recordatorios_por_enviar as
select r.*, c.nombre as cliente_nombre, c.telefono, c.email, c.canal_preferido,
       v.placa, v.marca, v.modelo
  from recordatorios r
  join clientes c on c.id = r.cliente_id
  join vehiculos v on v.id = r.vehiculo_id
 where r.estado = 'pendiente'
   and c.activo
   and r.vence_fecha is not null
   and r.vence_fecha - r.avisar_dias_antes <= current_date;

create table segmentos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  -- Reglas soportadas por clientes_en_segmento():
  -- {"dias_sin_visita_min":180, "dias_sin_visita_max":365, "gasto_min":5000, "gasto_max":null,
  --  "visitas_min":2, "tipos_vehiculo":["suv","pickup"], "marcas":["Toyota"],
  --  "categorias":["Detailing"], "solo_marketing":true}
  reglas      jsonb not null default '{}',
  creado_por  uuid references perfiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table campanas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  segmento_id   uuid not null references segmentos(id),
  canal         canal_contacto not null check (canal in ('email','sms','whatsapp')),
  asunto        text,
  plantilla     text not null,                  -- admite {{nombre}}, {{placa}}, {{marca}}
  programada_para timestamptz,
  estado        text not null default 'borrador' check (estado in ('borrador','programada','enviando','enviada','cancelada')),
  creado_por    uuid references perfiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
alter table comunicaciones add foreign key (campana_id) references campanas(id);

-- Libro de puntos de fidelidad
create table puntos_fidelidad (
  id         bigint generated always as identity primary key,
  cliente_id uuid not null references clientes(id),
  orden_id   uuid references ordenes_trabajo(id),
  puntos     integer not null check (puntos <> 0),
  concepto   text not null,
  created_at timestamptz not null default now()
);
create index pf_cliente_idx on puntos_fidelidad (cliente_id);

-- -----------------------------------------------------------------------------
-- 8. Auditoría
-- -----------------------------------------------------------------------------
create table auditoria (
  id           bigint generated always as identity primary key,
  tabla        text not null,
  registro_id  text,
  accion       text not null,
  antes        jsonb,
  despues      jsonb,
  usuario_id   uuid,
  ocurrido_en  timestamptz not null default now()
);
create index auditoria_tabla_idx on auditoria (tabla, registro_id);

create function fn_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria (tabla, registro_id, accion, antes, despues, usuario_id)
  values (tg_table_name,
          coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id')),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['clientes','vehiculos','articulos','parametros_stock','citas',
                           'ordenes_trabajo','orden_servicios','orden_piezas','pagos','perfiles','ordenes_compra']
  loop
    execute format('create trigger trg_%s_auditoria after insert or update or delete on %I
                    for each row execute function fn_auditar()', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Funciones de negocio (llamadas desde la app como RPC de Supabase)
-- -----------------------------------------------------------------------------

-- Escáner: busca por código de barras, SKU o código del proveedor
create function articulo_por_codigo(p_codigo text)
returns setof articulos language sql stable as $$
  select a.* from articulos a
   where a.activo and (a.codigo_barras = p_codigo or a.sku = p_codigo
         or exists (select 1 from articulo_proveedores ap where ap.articulo_id = a.id and ap.codigo_proveedor = p_codigo))
   limit 1
$$;

-- Recepción de mercancía contra una orden de compra (escaneo en almacén)
create function recibir_linea_oc(p_linea uuid, p_cantidad numeric, p_ubicacion uuid,
                                 p_metodo metodo_captura default 'escaneo')
returns void language plpgsql security invoker as $$
declare l ordenes_compra_lineas%rowtype;
begin
  select * into l from ordenes_compra_lineas where id = p_linea for update;
  if not found then raise exception 'Línea de compra inexistente'; end if;

  update ordenes_compra_lineas set cantidad_recibida = cantidad_recibida + p_cantidad where id = p_linea;

  insert into movimientos_inventario (articulo_id, ubicacion_id, tipo, cantidad, costo_unitario, metodo, oc_linea_id)
  values (l.articulo_id, p_ubicacion, 'entrada_compra', p_cantidad, l.costo_unitario, p_metodo, p_linea);

  update ordenes_compra oc
     set estado = case when not exists (select 1 from ordenes_compra_lineas
                                         where orden_compra_id = oc.id and cantidad_recibida < cantidad)
                       then 'recibida'::estado_oc else 'parcial'::estado_oc end
   where oc.id = l.orden_compra_id;
end $$;

-- Transferencia entre ubicaciones (almacén → bahía), atómica
create function transferir_stock(p_articulo uuid, p_origen uuid, p_destino uuid, p_cantidad numeric,
                                 p_metodo metodo_captura default 'escaneo')
returns uuid language plpgsql security invoker as $$
declare v_id uuid := gen_random_uuid(); v_costo numeric;
begin
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser positiva'; end if;
  select costo_promedio into v_costo from articulos where id = p_articulo;
  insert into movimientos_inventario (articulo_id, ubicacion_id, tipo, cantidad, costo_unitario, metodo, transferencia_id)
  values (p_articulo, p_origen,  'transferencia_salida',  -p_cantidad, v_costo, p_metodo, v_id),
         (p_articulo, p_destino, 'transferencia_entrada',  p_cantidad, v_costo, p_metodo, v_id);
  return v_id;
end $$;

-- Huecos libres para un servicio en un día: cruza turnos, ausencias, citas y bahías
create function huecos_disponibles(p_sucursal uuid, p_dia date, p_duracion interval,
                                   p_tipo_bahia text default null, p_paso interval default '30 minutes')
returns table (inicio timestamptz, fin timestamptz, tecnico_id uuid, bahia_id uuid)
language sql stable as $$
  with tz as (select zona_horaria z from sucursales where id = p_sucursal),
  turnos as (
    select h.tecnico_id,
           ((p_dia + h.hora_inicio) at time zone tz.z) as t_ini,
           ((p_dia + h.hora_fin)    at time zone tz.z) as t_fin
      from horarios_tecnico h
      join perfiles p on p.id = h.tecnico_id and p.activo and p.rol = 'tecnico'
                     and (p.sucursal_id = p_sucursal or p.sucursal_id is null)
      cross join tz
     where h.dia_semana = extract(dow from p_dia)
  ),
  candidatos as (
    select t.tecnico_id, s as c_ini, s + p_duracion as c_fin
      from turnos t,
           generate_series(t.t_ini, t.t_fin - p_duracion, p_paso) s
  )
  select c.c_ini, c.c_fin, c.tecnico_id, b.id
    from candidatos c
    join lateral (
      select b.id from bahias b
       where b.sucursal_id = p_sucursal and b.activa
         and (p_tipo_bahia is null or b.tipo = p_tipo_bahia)
         and not exists (select 1 from citas ci where ci.bahia_id = b.id
                          and ci.estado in ('programada','confirmada','en_curso')
                          and ci.periodo && tstzrange(c.c_ini, c.c_fin, '[)'))
       order by b.nombre limit 1) b on true
   where not exists (select 1 from citas ci where ci.tecnico_id = c.tecnico_id
                      and ci.estado in ('programada','confirmada','en_curso')
                      and ci.periodo && tstzrange(c.c_ini, c.c_fin, '[)'))
     and not exists (select 1 from ausencias_tecnico a where a.tecnico_id = c.tecnico_id
                      and a.periodo && tstzrange(c.c_ini, c.c_fin, '[)'))
   order by c.c_ini, c.tecnico_id
$$;

-- -----------------------------------------------------------------------------
-- 10. Vistas de KPI (con security_invoker para respetar RLS)
-- -----------------------------------------------------------------------------

-- Totales por orden: ingreso, costo y margen
create view v_orden_totales with (security_invoker = true) as
select o.id as orden_id, o.folio, o.sucursal_id, o.cliente_id, o.vehiculo_id, o.estado,
       o.recibido_en, o.iniciado_en, o.terminado_en, o.entregado_en,
       coalesce(s.mano_obra, 0)                                   as ingreso_mano_obra,
       coalesce(p.piezas_venta, 0)                                as ingreso_piezas,
       coalesce(s.mano_obra, 0) + coalesce(p.piezas_venta, 0) - o.descuento as ingreso_total,
       coalesce(t.costo_mano_obra, 0)                             as costo_mano_obra,
       coalesce(p.piezas_costo, 0)                                as costo_piezas,
       coalesce(t.horas_reales, 0)                                as horas_reales,
       coalesce(pg.pagado, 0)                                     as pagado
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

-- Historial completo de servicio por vehículo (pantalla de CRM)
create view v_historial_servicio with (security_invoker = true) as
select v.placa, v.marca, v.modelo, v.anio, o.folio, o.recibido_en, o.entregado_en, o.kilometraje_ingreso,
       cs.nombre as categoria, os.descripcion as trabajo, pf.nombre as tecnico,
       os.horas_cobradas,
       (select sum(horas) from registros_tiempo where orden_servicio_id = os.id) as horas_reales,
       os.precio as mano_obra,
       (select coalesce(sum(cantidad * precio_unitario), 0) from orden_piezas where orden_servicio_id = os.id) as piezas,
       (select string_agg(a.nombre || ' x' || op.cantidad::text, ', ')
          from orden_piezas op join articulos a on a.id = op.articulo_id
         where op.orden_servicio_id = os.id) as piezas_detalle,
       v.id as vehiculo_id, o.cliente_id, o.id as orden_id
  from orden_servicios os
  join ordenes_trabajo o on o.id = os.orden_id
  join vehiculos v on v.id = o.vehiculo_id
  join categorias_servicio cs on cs.id = os.categoria_id
  left join perfiles pf on pf.id = os.tecnico_id
 where o.estado <> 'cancelada';

-- Métricas por cliente: base de la segmentación y del "ingreso por cliente"
create view v_cliente_metricas with (security_invoker = true) as
select c.id as cliente_id, c.nombre, c.apellidos, c.acepta_marketing, c.canal_preferido,
       count(t.orden_id)                                  as visitas,
       coalesce(sum(t.ingreso_total), 0)                  as gasto_total,
       coalesce(avg(t.ingreso_total), 0)::numeric(12,2)   as ticket_promedio,
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

create function clientes_en_segmento(p_segmento uuid)
returns setof v_cliente_metricas language sql stable as $$
  select m.* from v_cliente_metricas m, segmentos s
   where s.id = p_segmento
     and (s.reglas->>'dias_sin_visita_min' is null or m.dias_sin_visita >= (s.reglas->>'dias_sin_visita_min')::int)
     and (s.reglas->>'dias_sin_visita_max' is null or m.dias_sin_visita <= (s.reglas->>'dias_sin_visita_max')::int)
     and (s.reglas->>'gasto_min'  is null or m.gasto_total >= (s.reglas->>'gasto_min')::numeric)
     and (s.reglas->>'gasto_max'  is null or m.gasto_total <= (s.reglas->>'gasto_max')::numeric)
     and (s.reglas->>'visitas_min' is null or m.visitas >= (s.reglas->>'visitas_min')::int)
     and (s.reglas->'tipos_vehiculo' is null or m.tipos_vehiculo::text[] && array(select jsonb_array_elements_text(s.reglas->'tipos_vehiculo')))
     and (s.reglas->'marcas'     is null or m.marcas     && array(select jsonb_array_elements_text(s.reglas->'marcas')))
     and (s.reglas->'categorias' is null or m.categorias && array(select jsonb_array_elements_text(s.reglas->'categorias')))
     and (coalesce((s.reglas->>'solo_marketing')::boolean, true) = false or m.acepta_marketing)
$$;

-- Rentabilidad por tipo de servicio (categoría), por mes
create view v_rentabilidad_categoria with (security_invoker = true) as
select date_trunc('month', o.entregado_en)::date as mes, o.sucursal_id, cs.nombre as categoria,
       count(*)                                         as trabajos,
       sum(os.precio + coalesce(p.venta, 0))            as ingreso,
       sum(coalesce(t.costo, 0) + coalesce(p.costo, 0)) as costo,
       sum(os.precio + coalesce(p.venta, 0)) - sum(coalesce(t.costo, 0) + coalesce(p.costo, 0)) as margen,
       round(100 * (sum(os.precio + coalesce(p.venta, 0)) - sum(coalesce(t.costo, 0) + coalesce(p.costo, 0)))
             / nullif(sum(os.precio + coalesce(p.venta, 0)), 0), 1) as margen_pct,
       round(avg(t.horas), 2)                           as horas_reales_prom,
       round(avg(os.horas_cobradas), 2)                 as horas_cobradas_prom
  from orden_servicios os
  join ordenes_trabajo o on o.id = os.orden_id and o.estado = 'entregada'
  join categorias_servicio cs on cs.id = os.categoria_id
  left join lateral (select sum(cantidad * precio_unitario) venta, sum(cantidad * costo_unitario) costo
                       from orden_piezas where orden_servicio_id = os.id) p on true
  left join lateral (select sum(horas) horas, sum(horas * costo_hora) costo
                       from registros_tiempo where orden_servicio_id = os.id) t on true
 group by 1, 2, 3;

-- Tiempo promedio de servicio (recepción → entrega y trabajo efectivo)
create view v_tiempo_servicio with (security_invoker = true) as
select date_trunc('month', entregado_en)::date as mes, sucursal_id,
       count(*) as ordenes,
       round(avg(extract(epoch from (entregado_en - recibido_en)) / 3600)::numeric, 1) as horas_estadia_prom,
       round(avg(extract(epoch from (terminado_en - iniciado_en)) / 3600)::numeric, 1) as horas_en_proceso_prom,
       round(avg(horas_reales), 2) as horas_trabajadas_prom
  from v_orden_totales
 where estado = 'entregada'
 group by 1, 2;

-- Rotación de inventario de los últimos 12 meses por artículo
-- rotación = costo de lo consumido / valor del inventario actual
create view v_rotacion_inventario with (security_invoker = true) as
with consumo as (
  select articulo_id, sum(-cantidad * costo_unitario) costo_consumido, sum(-cantidad) unidades
    from movimientos_inventario
   where tipo in ('salida_orden','merma') and created_at >= now() - interval '12 months'
   group by articulo_id),
stock as (
  select articulo_id, sum(cantidad) unidades from existencias group by articulo_id)
select a.id as articulo_id, a.sku, a.nombre, a.tipo,
       coalesce(s.unidades, 0)                          as stock_actual,
       coalesce(s.unidades, 0) * a.costo_promedio       as valor_inventario,
       coalesce(c.unidades, 0)                          as unidades_consumidas_12m,
       coalesce(c.costo_consumido, 0)                   as costo_consumido_12m,
       round(coalesce(c.costo_consumido, 0) / nullif(coalesce(s.unidades, 0) * a.costo_promedio, 0), 2) as rotacion,
       round(365 * coalesce(s.unidades, 0) / nullif(c.unidades, 0), 0) as dias_de_inventario
  from articulos a
  left join consumo c on c.articulo_id = a.id
  left join stock s on s.articulo_id = a.id
 where a.activo;

-- Consumo mensual por artículo: tendencias y sugerencia de compra
create view v_consumo_mensual with (security_invoker = true) as
select date_trunc('month', m.created_at)::date as mes, u.sucursal_id, m.articulo_id,
       sum(-m.cantidad) as unidades, sum(-m.cantidad * m.costo_unitario) as costo
  from movimientos_inventario m join ubicaciones u on u.id = m.ubicacion_id
 where m.tipo = 'salida_orden'
 group by 1, 2, 3;

-- Retención: de los clientes que vinieron en los 12 meses previos, cuántos volvieron en los últimos 12
create view v_retencion_clientes with (security_invoker = true) as
with periodo_ant as (
  select distinct cliente_id from ordenes_trabajo
   where estado = 'entregada' and entregado_en >= now() - interval '24 months' and entregado_en < now() - interval '12 months'),
periodo_act as (
  select distinct cliente_id from ordenes_trabajo
   where estado = 'entregada' and entregado_en >= now() - interval '12 months')
select (select count(*) from periodo_ant) as clientes_periodo_anterior,
       (select count(*) from periodo_ant a where a.cliente_id in (select cliente_id from periodo_act)) as retenidos,
       round(100.0 * (select count(*) from periodo_ant a where a.cliente_id in (select cliente_id from periodo_act))
             / nullif((select count(*) from periodo_ant), 0), 1) as tasa_retencion_pct,
       (select count(*) from periodo_act a where a.cliente_id not in (select cliente_id from periodo_ant)) as clientes_nuevos_o_recuperados;

-- Stock bajo en tiempo real (tablero de almacén)
create view v_stock_bajo with (security_invoker = true) as
select ps.sucursal_id, a.id as articulo_id, a.sku, a.nombre,
       stock_sucursal(a.id, ps.sucursal_id) as stock, ps.punto_reorden, ps.cantidad_reorden,
       (select pr.nombre from articulo_proveedores ap join proveedores pr on pr.id = ap.proveedor_id
         where ap.articulo_id = a.id and ap.preferido) as proveedor_preferido
  from parametros_stock ps join articulos a on a.id = ps.articulo_id
 where a.activo and stock_sucursal(a.id, ps.sucursal_id) <= ps.punto_reorden;

-- -----------------------------------------------------------------------------
-- 11. Seguridad: Row Level Security
--   admin     todo
--   gerente   todo lo operativo y los reportes de su sucursal; catálogo y precios
--   recepcion clientes, vehículos, citas, órdenes, comunicaciones, pagos
--   tecnico   ve sus citas y órdenes asignadas; registra tiempo y piezas; consulta stock
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sucursales','bahias','ubicaciones','perfiles','clientes','vehiculos','categorias_servicio','servicios',
    'servicio_articulos_sugeridos','categorias_articulo','marcas','proveedores','articulos','articulo_proveedores',
    'parametros_stock','existencias','ordenes_compra','ordenes_compra_lineas','movimientos_inventario',
    'alertas_reabastecimiento','horarios_tecnico','ausencias_tecnico','citas','ordenes_trabajo','orden_servicios',
    'registros_tiempo','orden_piezas','pagos','comunicaciones','recordatorios','segmentos','campanas',
    'puntos_fidelidad','auditoria']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Catálogos: lectura para cualquier empleado activo; escritura admin/gerente
do $$
declare t text;
begin
  foreach t in array array['sucursales','bahias','ubicaciones','categorias_servicio','servicios',
                           'servicio_articulos_sugeridos','categorias_articulo','marcas','articulos',
                           'parametros_stock','horarios_tecnico','ausencias_tecnico']
  loop
    execute format('create policy %I on %I for select to authenticated using (rol_actual() is not null)', t || '_leer', t);
    execute format('create policy %I on %I for all to authenticated using (tiene_rol(''admin'',''gerente'')) with check (tiene_rol(''admin'',''gerente''))', t || '_gestionar', t);
  end loop;
end $$;

-- Perfiles: cada quien ve el suyo; staff ve compañeros; solo admin administra
create policy perfiles_leer on perfiles for select to authenticated using (rol_actual() is not null);
create policy perfiles_admin on perfiles for all to authenticated
  using (tiene_rol('admin')) with check (tiene_rol('admin'));

-- Proveedores, compras y relaciones artículo-proveedor: admin/gerente
do $$
declare t text;
begin
  foreach t in array array['proveedores','articulo_proveedores','ordenes_compra','ordenes_compra_lineas']
  loop
    execute format('create policy %I on %I for all to authenticated using (tiene_rol(''admin'',''gerente'')) with check (tiene_rol(''admin'',''gerente''))', t || '_gestionar', t);
  end loop;
end $$;

-- Existencias: todos consultan; nadie escribe directo (solo el trigger, security definer)
create policy existencias_leer on existencias for select to authenticated using (rol_actual() is not null);

-- Movimientos: todos consultan; admin/gerente registran ajustes y entradas manuales
create policy mov_leer on movimientos_inventario for select to authenticated using (rol_actual() is not null);
create policy mov_registrar on movimientos_inventario for insert to authenticated
  with check (tiene_rol('admin','gerente'));

create policy alertas_leer on alertas_reabastecimiento for select to authenticated using (tiene_rol('admin','gerente'));
create policy alertas_gestionar on alertas_reabastecimiento for update to authenticated using (tiene_rol('admin','gerente'));

-- Clientes y vehículos: recepción, gerente y admin gestionan; técnicos solo leen
create policy clientes_leer on clientes for select to authenticated using (rol_actual() is not null);
create policy clientes_gestionar on clientes for all to authenticated
  using (tiene_rol('admin','gerente','recepcion')) with check (tiene_rol('admin','gerente','recepcion'));
create policy vehiculos_leer on vehiculos for select to authenticated using (rol_actual() is not null);
create policy vehiculos_gestionar on vehiculos for all to authenticated
  using (tiene_rol('admin','gerente','recepcion')) with check (tiene_rol('admin','gerente','recepcion'));

-- Citas: por sucursal; el técnico ve solo las suyas
create policy citas_leer on citas for select to authenticated
  using (puede_ver_sucursal(sucursal_id) and (rol_actual() <> 'tecnico' or tecnico_id = auth.uid()));
create policy citas_gestionar on citas for all to authenticated
  using (puede_ver_sucursal(sucursal_id) and tiene_rol('admin','gerente','recepcion'))
  with check (puede_ver_sucursal(sucursal_id) and tiene_rol('admin','gerente','recepcion'));
-- El técnico marca el inicio y el término de sus propias citas
create policy citas_tecnico_avanza on citas for update to authenticated
  using (rol_actual() = 'tecnico' and tecnico_id = auth.uid())
  with check (rol_actual() = 'tecnico' and tecnico_id = auth.uid() and estado in ('en_curso','completada'));

-- Órdenes de trabajo
create function es_tecnico_de_orden(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orden_servicios where orden_id = p_orden and tecnico_id = auth.uid())
$$;

create policy ot_leer on ordenes_trabajo for select to authenticated
  using (puede_ver_sucursal(sucursal_id) and (rol_actual() <> 'tecnico' or es_tecnico_de_orden(id)));
create policy ot_gestionar on ordenes_trabajo for all to authenticated
  using (puede_ver_sucursal(sucursal_id) and tiene_rol('admin','gerente','recepcion'))
  with check (puede_ver_sucursal(sucursal_id) and tiene_rol('admin','gerente','recepcion'));
create policy ot_tecnico_avanza on ordenes_trabajo for update to authenticated
  using (rol_actual() = 'tecnico' and es_tecnico_de_orden(id))
  with check (rol_actual() = 'tecnico' and es_tecnico_de_orden(id));

create policy os_leer on orden_servicios for select to authenticated
  using (exists (select 1 from ordenes_trabajo o where o.id = orden_id));   -- hereda ot_leer
create policy os_gestionar on orden_servicios for all to authenticated
  using (tiene_rol('admin','gerente','recepcion')) with check (tiene_rol('admin','gerente','recepcion'));
create policy os_tecnico_completa on orden_servicios for update to authenticated
  using (tecnico_id = auth.uid()) with check (tecnico_id = auth.uid());

create policy rt_leer on registros_tiempo for select to authenticated
  using (tecnico_id = auth.uid() or tiene_rol('admin','gerente'));
create policy rt_propio on registros_tiempo for all to authenticated
  using (tecnico_id = auth.uid() or tiene_rol('admin','gerente'))
  with check (tecnico_id = auth.uid() or tiene_rol('admin','gerente'));

create policy op_leer on orden_piezas for select to authenticated
  using (exists (select 1 from orden_servicios os where os.id = orden_servicio_id));
create policy op_registrar on orden_piezas for insert to authenticated
  with check (tiene_rol('admin','gerente','recepcion')
              or exists (select 1 from orden_servicios os where os.id = orden_servicio_id and os.tecnico_id = auth.uid()));
create policy op_retirar on orden_piezas for delete to authenticated
  using (tiene_rol('admin','gerente'));

create policy pagos_gestionar on pagos for all to authenticated
  using (tiene_rol('admin','gerente','recepcion')) with check (tiene_rol('admin','gerente','recepcion'));

-- Comunicación y marketing
create policy com_leer on comunicaciones for select to authenticated using (tiene_rol('admin','gerente','recepcion'));
create policy com_registrar on comunicaciones for insert to authenticated with check (rol_actual() is not null);
create policy rec_gestionar on recordatorios for all to authenticated
  using (tiene_rol('admin','gerente','recepcion')) with check (tiene_rol('admin','gerente','recepcion'));
create policy seg_gestionar on segmentos for all to authenticated
  using (tiene_rol('admin','gerente')) with check (tiene_rol('admin','gerente'));
create policy camp_gestionar on campanas for all to authenticated
  using (tiene_rol('admin','gerente')) with check (tiene_rol('admin','gerente'));
create policy pf_leer on puntos_fidelidad for select to authenticated using (tiene_rol('admin','gerente','recepcion'));
create policy pf_registrar on puntos_fidelidad for insert to authenticated with check (tiene_rol('admin','gerente','recepcion'));

create policy auditoria_leer on auditoria for select to authenticated using (tiene_rol('admin'));

-- Vistas de KPI: solo gerencia y administración (la vista hereda RLS de las tablas,
-- y además la app las muestra únicamente a esos roles)

-- Permisos de la API y alta automática del primer administrador.

-- Supabase expone las tablas a la app por medio de estos roles; las políticas RLS
-- del esquema deciden qué fila ve cada usuario. Se dan explícitamente por si el
-- proyecto no los concede de forma automática a las tablas nuevas.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- La primera persona que se registre en Authentication queda como administradora.
-- Después, administración da de alta al resto del equipo.
create function fn_primer_usuario_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from perfiles where rol = 'admin') then
    insert into perfiles (id, nombre, rol)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)), 'admin');
  end if;
  return new;
end $$;

create trigger trg_primer_usuario_admin after insert on auth.users
  for each row execute function fn_primer_usuario_admin();

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

-- Órdenes de trabajo: recepción también ve las horas trabajadas (para informar al cliente).
drop policy if exists rt_leer on registros_tiempo;
create policy rt_leer on registros_tiempo for select to authenticated
  using (tecnico_id = auth.uid() or tiene_rol('admin','gerente','recepcion'));

-- Puntos de fidelidad automáticos: 1 punto por cada $100 cobrados al entregar la orden.
create function fn_puntos_por_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  if new.estado = 'entregada' and old.estado is distinct from 'entregada' then
    select ingreso_total into v_total from v_orden_totales where orden_id = new.id;
    if coalesce(v_total, 0) >= 100 then
      insert into puntos_fidelidad (cliente_id, orden_id, puntos, concepto)
      values (new.cliente_id, new.id, floor(v_total / 100)::int, 'Servicio OT ' || new.folio);
    end if;
  end if;
  return new;
end $$;
create trigger trg_ot_puntos after update of estado on ordenes_trabajo
  for each row execute function fn_puntos_por_entrega();

-- Datos iniciales de ejemplo: una sucursal, sus bahías y un catálogo básico de servicios.
-- Ajusta nombres, precios y horarios a tu taller antes de usarlo en producción.

insert into sucursales (id, nombre, direccion, zona_horaria) values
  ('00000000-0000-4000-8000-000000000001', 'Matriz', 'Dirección del taller', 'America/Mexico_City')
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
