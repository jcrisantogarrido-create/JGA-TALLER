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
