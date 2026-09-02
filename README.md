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
public/qr-bcp.png
```

Después de confirmar una venta, el sistema mostrará automáticamente ese QR junto con el total a pagar. No se ha generado un QR nuevo para evitar usar datos bancarios incorrectos.
