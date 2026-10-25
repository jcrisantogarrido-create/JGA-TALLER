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
