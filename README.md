# Taller JGA

Sistema de gestión para taller mecánico y detailing: clientes y vehículos, agenda sin choques, órdenes de trabajo, inventario y reportes. Hecho con Next.js 15 y Supabase.

## Qué incluye esta primera entrega

- **Inicio de sesión** con Supabase Auth. Cada usuario tiene un rol (administración, gerencia, recepción o técnico) y una sucursal; el menú y los permisos cambian según el rol.
- **Clientes y vehículos**: alta de cliente con su primer vehículo, búsqueda por nombre, teléfono, correo o placa (sin importar guiones ni espacios), ficha con vehículos, historial de servicio, próximas citas, recordatorios y bitácora de comunicación.
- **Agenda** por día, en columnas por bahía o por técnico. Para agendar, el sistema muestra solo los horarios donde hay un técnico en turno y una bahía libre. La base de datos rechaza cualquier doble reserva aunque dos personas agenden al mismo tiempo.
- **Vista del técnico** en el celular: solo ve sus citas y puede marcar el inicio y el término.
- **Inventario**: catálogo por tipo, categoría y marca; existencia por sucursal y ubicación en tiempo real; punto de reorden con alerta automática al bajar del mínimo.
- **Kardex dinámico** (costo promedio ponderado): por artículo o general, con saldo inicial, entradas, salidas, saldo y valor tras cada movimiento. Los filtros (fechas, tipo, ubicación, búsqueda por artículo, SKU, código o factura) se aplican al instante, y se exporta a Excel.
- **Movimientos**: entradas por compra con proveedor y factura, ajustes, mermas y transferencias entre ubicaciones, con lector de código de barras USB/Bluetooth o la cámara del celular.

Pendiente en las siguientes entregas: órdenes de trabajo, órdenes de compra, recordatorios automáticos por WhatsApp/SMS/email y tablero de KPI. La base de datos de todo eso ya está en la migración.

## Puesta en marcha

1. Crea un proyecto en [Supabase](https://supabase.com).
2. Abre **SQL Editor → New query**, pega todo `supabase/instalar.sql` y pulsa **Run**. Crea tablas, reglas, permisos y un catálogo de ejemplo (sucursal “Matriz”, bahías y servicios; ajústalos a tu taller). Se ejecuta una sola vez.
   Si prefieres la CLI de Supabase, `supabase db push` aplica las migraciones de `supabase/migrations/` y `seed.sql` hace lo mismo.
3. En **Authentication → Users → Add user** crea tu usuario con “Auto Confirm User”. **La primera persona registrada queda como administradora** automáticamente.
4. Da de alta al resto del equipo: crea cada usuario en Authentication y asígnale rol y sucursal con el bloque comentado al final de `seed.sql`. Sin ese paso la persona puede entrar pero verá “Tu cuenta aún no tiene rol”.
5. Para cada técnico registra su turno en `horarios_tecnico` (también en `seed.sql`). Sin turno no aparece en los horarios libres de la agenda.
6. Variables de entorno (Project Settings → API Keys):

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key o anon key>
   ```

   En local van en `.env.local`. En Vercel, en Settings → Environment Variables.
7. Para probar en tu computadora: `npm install` y `npm run dev`, luego abre http://localhost:3000.

### Publicar en Vercel

En [vercel.com/new](https://vercel.com/new) importa este repositorio, agrega las dos variables de entorno y pulsa **Deploy**. Después, en Supabase → Authentication → URL Configuration, pon la dirección que te dé Vercel como Site URL.

### Actualizar una base ya instalada

Cada cambio de base de datos posterior a la instalación viene en `supabase/actualizaciones/`. Ejecuta en el SQL Editor, una sola vez y en orden, los que tengan fecha posterior a tu instalación.

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
