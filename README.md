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

Para crear las tablas y permisos, abre el **SQL Editor** de tu proyecto Supabase, copia el contenido de `supabase/schema.sql` y ejecuta la consulta completa. Después se podrá activar el inicio de sesión real y la sincronización entre equipos.

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

La aplicación inicia como **Vendedor**. Para cambiar a **Administrador**, abre el menú del perfil e introduce el PIN inicial `1234`. Puedes cambiarlo en `src/main.ts` antes de publicar una versión propia.

Este PIN protege la interfaz local, pero no es autenticación de servidor. Para uso compartido por internet se recomienda conectar el sistema a un backend con usuarios, contraseñas cifradas y permisos del lado del servidor.
