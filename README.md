# Librería A&O | Punto de venta

Sistema pequeño de ventas para catálogos de hasta 100 productos.

## Incluye

- Ventas con descuento automático de inventario.
- Alta y edición de productos.
- Control de stock mínimo y alertas de reposición.
- Reportes de ventas, unidades y ticket promedio.
- Exportación CSV.
- Persistencia local en el navegador.
- Comprobante de pago horizontal con monto y QR BCP.

## Uso local

```bash
npm install
npm run dev
```

Abre `http://localhost:5173` en la máquina administradora.

## Configuración de Supabase

La conexión local se configura en `.env.local`, usando como base `.env.example`. Las claves no se suben al repositorio.

En Netlify debes configurar las mismas variables en **Site configuration → Environment variables** para el contexto `Production`:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Después selecciona **Deploys → Trigger deploy → Clear cache and deploy site**. Netlify no puede leer `.env.local` porque ese archivo solo existe en tu computadora.

Para crear las tablas y permisos, abre el **SQL Editor** de tu proyecto Supabase, copia el contenido de `supabase/schema.sql` y ejecuta la consulta completa. Después se podrá activar el inicio de sesión real y la sincronización entre equipos.

Si ya ejecutaste `schema.sql` antes de esta actualización, ejecuta también `supabase/migration-auth.sql`. Esta migración crea automáticamente un perfil Vendedor para cada usuario nuevo.

Si el usuario ya existía antes de activar el trigger, ejecuta `supabase/migration-existing-users.sql`. Luego asigna el rol administrador con el UUID correcto desde `Authentication → Users`.

Para activar el guardado compartido de ventas, ejecuta después `supabase/migration-sales.sql`. A partir de entonces, los productos, categorías y ventas se sincronizarán con Supabase para todos los usuarios autenticados.

Si al guardar aparece `new row violates row-level security policy`, ejecuta `supabase/fix-admin-permissions.sql` reemplazando `CORREO_DEL_ADMIN` por el correo exacto del administrador. Esto crea los perfiles faltantes y aplica la policy usando el rol real de Supabase.

## Acceso del empleado

El servidor está configurado para escuchar en la red local. Para que un empleado acceda desde la misma Wi-Fi, inicia `npm run dev` en la máquina administradora y comparte su dirección IPv4, por ejemplo:

```text
http://10.1.21.101:5173
```

Es posible que Windows solicite permitir Node/Vite en el Firewall privado.

### Importante

Esta primera versión guarda la información en `localStorage`. Eso significa que cada navegador mantiene una copia independiente: sirve para uso local o demostración, pero no sincroniza ventas entre dos equipos.

Para operación compartida real se debe añadir un backend con base de datos (por ejemplo, Node + SQLite/PostgreSQL), autenticación para administrador y empleado, y servir la aplicación desde ese backend. La interfaz ya está separada por módulos para poder conectar esa API en el siguiente paso.

## QR de pago

Coloca la imagen del QR proporcionada por BCP con este nombre:

```text
public/codigo-qr.jpeg
```

Después de confirmar una venta, el sistema mostrará automáticamente ese QR junto con el total a pagar. No se ha generado un QR nuevo para evitar usar datos bancarios incorrectos.

## Roles

El rol depende exclusivamente del perfil del usuario autenticado en Supabase. Los usuarios nuevos comienzan como **Vendedor**. Para convertir una cuenta en **Administrador**, actualiza su fila en `public.profiles` desde el SQL Editor. El botón de perfil sirve para cerrar sesión y cambiar de cuenta.
