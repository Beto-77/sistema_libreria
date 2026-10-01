create table if not exists public.daily_closures (
  business_date date primary key,
  total numeric(12,2) not null default 0 check (total >= 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  units_sold integer not null default 0 check (units_sold >= 0),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_by_label text not null default 'Administrador',
  closed_at timestamptz not null default now()
);

alter table public.daily_closures enable row level security;
drop policy if exists "Authenticated users read daily closures" on public.daily_closures;
create policy "Authenticated users read daily closures" on public.daily_closures
for select to authenticated using (true);

create or replace function public.close_daily_sales()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  closing_date date := timezone('America/La_Paz', now())::date;
  existing_closure public.daily_closures%rowtype;
  closure_result public.daily_closures%rowtype;
  sales_total numeric(12,2);
  sales_count integer;
  units_count integer;
  admin_label text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only administrators can close the register';
  end if;

  perform pg_advisory_xact_lock(hashtext('daily_sales_register'), closing_date - date '2000-01-01');
  select * into existing_closure from public.daily_closures where business_date = closing_date;
  if found then return to_jsonb(existing_closure); end if;

  select coalesce(sum(total), 0), count(*)::integer
  into sales_total, sales_count
  from public.sales
  where (created_at at time zone 'America/La_Paz')::date = closing_date;

  select coalesce(sum(items.quantity), 0)::integer
  into units_count
  from public.sale_items as items
  join public.sales as sale on sale.id = items.sale_id
  where (sale.created_at at time zone 'America/La_Paz')::date = closing_date;

  select coalesce(nullif(full_name, ''), 'Administrador') into admin_label
  from public.profiles where id = auth.uid();

  insert into public.daily_closures (
    business_date, total, transaction_count, units_sold, closed_by, closed_by_label
  ) values (
    closing_date, sales_total, sales_count, units_count, auth.uid(), coalesce(admin_label, 'Administrador')
  ) returning * into closure_result;

  return to_jsonb(closure_result);
end;
$$;

create or replace function public.create_sale(items jsonb)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  new_sale_id bigint;
  item jsonb;
  product_record public.products%rowtype;
  sale_total numeric(10,2) := 0;
  v_business_date date := timezone('America/La_Paz', now())::date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext('daily_sales_register'), v_business_date - date '2000-01-01');
  if exists (select 1 from public.daily_closures as closing where closing.business_date = v_business_date) then
    raise exception 'Daily sales are closed';
  end if;

  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'Sale must contain at least one item';
  end if;
  if jsonb_array_length(items) = 0 then raise exception 'Sale must contain at least one item'; end if;
  if exists (
    select 1 from jsonb_to_recordset(items) as line(product_id bigint, quantity integer)
    where line.product_id is null or line.quantity is null or line.quantity <= 0
  ) then
    raise exception 'Sale items must have a product and a positive quantity';
  end if;

  for item in
    select jsonb_build_object('product_id', grouped.product_id, 'quantity', grouped.quantity)
    from (
      select product_id, sum(quantity)::integer as quantity
      from jsonb_to_recordset(items) as line(product_id bigint, quantity integer)
      group by product_id
    ) as grouped
  loop
    if (item->>'quantity')::integer <= 0 then raise exception 'Sale quantity must be positive'; end if;
    select * into product_record from public.products where id = (item->>'product_id')::bigint for update;
    if product_record.id is null or product_record.stock < (item->>'quantity')::integer then raise exception 'Insufficient stock'; end if;
    sale_total := sale_total + product_record.price * (item->>'quantity')::integer;
  end loop;

  insert into public.sales (seller_id, total) values (auth.uid(), sale_total) returning id into new_sale_id;
  perform set_config('app.stock_movement_type', 'sale', true);
  perform set_config('app.stock_movement_note', 'Venta #' || new_sale_id, true);
  for item in
    select jsonb_build_object('product_id', grouped.product_id, 'quantity', grouped.quantity)
    from (
      select product_id, sum(quantity)::integer as quantity
      from jsonb_to_recordset(items) as line(product_id bigint, quantity integer)
      group by product_id
    ) as grouped
  loop
    select * into product_record from public.products where id = (item->>'product_id')::bigint;
    insert into public.sale_items (sale_id, product_id, quantity, unit_price)
    values (new_sale_id, product_record.id, (item->>'quantity')::integer, product_record.price);
    update public.products set stock = stock - (item->>'quantity')::integer where id = product_record.id;
  end loop;
  return new_sale_id;
end;
$$;

revoke all on function public.close_daily_sales() from public;
revoke all on function public.close_daily_sales() from anon;
revoke all on function public.create_sale(jsonb) from public;
revoke all on function public.create_sale(jsonb) from anon;
drop policy if exists "Sellers create sales" on public.sales;
drop policy if exists "Sellers create sale items" on public.sale_items;
revoke insert on public.sales, public.sale_items from public, anon, authenticated;
grant execute on function public.close_daily_sales() to authenticated;
grant execute on function public.create_sale(jsonb) to authenticated;