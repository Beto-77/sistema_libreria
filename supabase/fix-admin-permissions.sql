-- Ejecuta este archivo en Supabase SQL Editor.
-- Crea perfiles para usuarios que ya existian.
insert into public.profiles (id, full_name, role)
select id, coalesce(raw_user_meta_data ->> 'full_name', ''), 'seller'
from auth.users
on conflict (id) do nothing;

-- Reemplaza CORREO_DEL_ADMIN por el correo exacto de tu administrador.
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'CORREO_DEL_ADMIN');

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

grant execute on function public.is_admin() to authenticated;

drop policy if exists "Admins manage categories" on public.categories;
drop policy if exists "Admins manage products" on public.products;

create policy "Admins manage categories" on public.categories
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins manage products" on public.products
for all to authenticated
using (public.is_admin())
with check (public.is_admin());
