-- Ejecuta esto para crear perfiles de usuarios que ya existian antes del trigger.
insert into public.profiles (id, full_name, role)
select id, coalesce(raw_user_meta_data ->> 'full_name', ''), 'seller'
from auth.users
on conflict (id) do nothing;

-- Despues de consultar los UUID, asigna admin solo a la cuenta correcta:
-- update public.profiles set role = 'admin' where id = 'UUID_DEL_ADMIN';