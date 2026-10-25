-- Equipo: la administración ve las cuentas creadas en Authentication para darles rol,
-- sucursal y turno desde la app (sin escribir SQL).
create function usuarios_equipo()
returns table (id uuid, email text, creado timestamptz, ultimo_acceso timestamptz, tiene_perfil boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
         exists (select 1 from perfiles p where p.id = u.id)
    from auth.users u
   where tiene_rol('admin')
   order by u.created_at
$$;
revoke execute on function usuarios_equipo() from public, anon;
grant execute on function usuarios_equipo() to authenticated;
