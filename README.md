# Famify

Aplicación web para administrar las finanzas de una familia: ingresos, gastos, presupuestos, metas de ahorro, reportes y recordatorios.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `client/` | Interfaz en React, TypeScript y Vite |
| `server/src/modulos/` | API en Express, un directorio por módulo funcional |
| `famify_db.sql` | Esquema completo de PostgreSQL; se puede aplicar sobre una base existente |
| `docs/` | Diagramas y matriz de cumplimiento |

## Puesta en marcha

Requiere Node.js y PostgreSQL 13 o superior.

1. Copia `server/.env.example` a `server/.env` y completa los valores.
2. Crea la base `famify` en PostgreSQL.
3. Aplica el esquema:

```bash
npm --prefix server run db:aplicar
```

4. Inicia el servidor y el cliente, cada uno en su terminal:

```bash
npm --prefix server run dev
```

```bash
npm --prefix client run dev
```

La aplicación queda en `http://localhost:5173`.

## Producción

- **HTTPS (RNF02):** define `TLS_CERT` y `TLS_KEY`, o coloca el servidor detrás de un proxy con TLS y usa `NODE_ENV=production`. Compila el cliente con `VITE_API_URL` apuntando a la dirección `https`.
- **Orígenes permitidos:** define `CLIENT_URL` con la dirección pública del cliente.
- **Respaldos diarios (RNF14):** define `RESPALDOS_ACTIVOS=true` y, si `pg_dump` no está en el PATH, `PG_DUMP_PATH`.
- **Secreto de sesión:** usa un `JWT_SECRET` largo y aleatorio, distinto del ejemplo.
