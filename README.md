# Taller JGA

Sistema de gestión para taller mecánico y detailing: clientes y vehículos, agenda sin choques, órdenes de trabajo, inventario y reportes. Hecho con Next.js 15 y Supabase.

## Qué incluye esta primera entrega

- **Inicio de sesión** con Supabase Auth. Cada usuario tiene un rol (administración, gerencia, recepción o técnico) y una sucursal; el menú y los permisos cambian según el rol.
- **Clientes y vehículos**: alta de cliente con su primer vehículo, búsqueda por nombre, teléfono, correo o placa (sin importar guiones ni espacios), ficha con vehículos, historial de servicio, próximas citas, recordatorios y bitácora de comunicación.
- **Agenda** por día, en columnas por bahía o por técnico. Para agendar, el sistema muestra solo los horarios donde hay un técnico en turno y una bahía libre. La base de datos rechaza cualquier doble reserva aunque dos personas agenden al mismo tiempo.
- **Vista del técnico** en el celular: solo ve sus citas y puede marcar el inicio y el término.

Pendiente en las siguientes entregas: órdenes de trabajo, inventario con escáner, compras, recordatorios automáticos por WhatsApp/SMS/email y tablero de KPI. La base de datos de todo eso ya está en la migración.

## Puesta en marcha

1. Crea un proyecto en [Supabase](https://supabase.com).
2. En **SQL Editor**, ejecuta en orden:
   - `supabase/migrations/20261024000000_esquema.sql` (tablas, reglas, vistas y permisos)
   - `supabase/seed.sql` (sucursal, bahías y catálogo de servicios de ejemplo; ajústalos a tu taller)
3. En **Authentication → Users** crea a tu equipo. Luego asigna rol y sucursal a cada persona con el bloque comentado al final de `seed.sql`. Sin ese paso la persona puede entrar pero verá “Tu cuenta aún no tiene rol”.
4. Para cada técnico registra su turno en `horarios_tecnico` (también en `seed.sql`). Sin turno no aparecerá en los horarios libres.
5. Copia `.env.example` a `.env.local` y pon la URL y la anon key de tu proyecto (Project Settings → API).
6. Instala y arranca:

   ```bash
   npm install
   npm run dev
   ```

   Abre http://localhost:3000.

Para publicarlo, despliega el repositorio en Vercel con las mismas dos variables de entorno.

## Estructura

```
src/
  app/
    login/            inicio de sesión
    sin-acceso/       cuenta sin rol asignado
    (app)/            pantallas con menú (requieren sesión y rol)
      page.tsx        inicio: citas de hoy y contadores
      clientes/       lista, alta, ficha y acciones del CRM
      agenda/         vista por día, nueva cita y detalle de cita
  components/         formularios y navegación
  lib/
    supabase/         clientes de Supabase para servidor y middleware
    sesion.ts         perfil, rol y sucursal del usuario
    fechas.ts         fechas en la zona horaria de la sucursal
    errores.ts        traduce errores de PostgreSQL a mensajes en español
  middleware.ts       refresca la sesión y protege las rutas
supabase/
  migrations/         esquema completo
  seed.sql            datos iniciales
```

## Decisiones

- **Las reglas viven en la base de datos.** Doble reserva, stock negativo y permisos por rol se validan en PostgreSQL (restricciones de exclusión, triggers y RLS). La app solo traduce los errores a mensajes claros.
- **La hora es la de la sucursal**, no la del navegador ni la del servidor. Todas las fechas se guardan como `timestamptz`.
- **Agenda propia en lugar de FullCalendar.** La vista con columnas por bahía requiere la licencia comercial de FullCalendar Scheduler; la vista propia es más ligera y hace lo que el taller necesita. Si más adelante se quiere vista semanal o arrastrar citas, se puede sumar FullCalendar.
