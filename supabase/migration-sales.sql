-- Ejecuta esta migracion si schema.sql ya se habia ejecutado.
create or replace function public.create_sale(items jsonb)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare new_sale_id bigint; item jsonb; product_record public.products%rowtype; sale_total numeric(10,2) := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  for item in select * from jsonb_array_elements(items) loop
    select * into product_record from public.products where id = (item->>'product_id')::bigint for update;
    if product_record.id is null or product_record.stock < (item->>'quantity')::integer then raise exception 'Insufficient stock'; end if;
    sale_total := sale_total + product_record.price * (item->>'quantity')::integer;
  end loop;
  insert into public.sales (seller_id, total) values (auth.uid(), sale_total) returning id into new_sale_id;
  for item in select * from jsonb_array_elements(items) loop
    select * into product_record from public.products where id = (item->>'product_id')::bigint;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price) values (new_sale_id, product_record.id, (item->>'quantity')::integer, product_record.price);
    update public.products set stock = stock - (item->>'quantity')::integer where id = product_record.id;
  end loop;
  return new_sale_id;
end;
$$;
grant execute on function public.create_sale(jsonb) to authenticated;