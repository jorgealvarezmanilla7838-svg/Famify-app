# RNF02 y RNF09–RNF12: cómo se cumplen y cómo comprobarlo

## RNF02 — Comunicación segura (HTTPS/TLS)

| Qué | Dónde |
|---|---|
| Certificado con `localhost`, `127.0.0.1` y las IP de red del equipo (sirve desde Kali/VM) | `server/scripts/generar-certificado.cjs` (`npm run tls:generar`) |
| El servidor atiende por HTTPS con TLS 1.2 como mínimo (negocia TLS 1.3) | `server/src/index.ts` |
| Puerto HTTP opcional que solo redirige (301) a HTTPS | `HTTP_REDIRECCION_PUERTO` en `server/.env` |
| Cabecera HSTS en toda respuesta cifrada; en producción (o `TLS_OBLIGATORIO=true`) se rechaza lo que no llegue por HTTPS | `server/src/modulos/compartido/seguridad.ts` |
| El cliente se sirve por HTTPS y pide la API a su propio origen (`/api`); Vite la reenvía al backend también por HTTPS, validando el certificado de Famify | `client/vite.config.ts`, `client/src/api.ts` |
| Los enlaces de invitación usan `https://` cuando hay certificado | `server/src/modulos/auth/auth.routes.ts` |

Configuración (`server/.env`):

```
TLS_CERT=certs/famify.crt
TLS_KEY=certs/famify.key
HTTP_REDIRECCION_PUERTO=4080
```

Comprobación (Windows con Git Bash, o Kali cambiando `localhost` por la IP del equipo):

```bash
curl -i --cacert server/certs/famify.crt https://localhost:4000/api/health
```

Respuesta esperada: `HTTP/1.1 200`, `Strict-Transport-Security` y `Server-Timing`.

```bash
curl -i http://localhost:4080/api/health
```

Respuesta esperada: `301 Moved Permanently` con `Location: https://...`.

```bash
openssl s_client -connect localhost:4000 </dev/null | grep Protocol
```

Respuesta esperada: `TLSv1.3`. Si se fuerza `-tls1_1`, la conexión se rechaza.

```bash
curl -m 3 http://localhost:4000/api/health
```

Sin cifrar, el puerto 4000 no responde.

En Kali, para no usar `-k`, copia `server/certs/famify.crt` a la VM y usa `--cacert famify.crt`.
En el navegador basta con abrir `https://IP:5173` y aceptar una vez la advertencia del certificado autofirmado. Las llamadas a la API pasan por ese mismo origen, así que no hay que aceptar otro certificado.
En Windows, para que Chrome y Edge no muestren la advertencia, el usuario puede confiar en el certificado (en PowerShell): `certutil -user -addstore Root server\certs\famify.crt`.

## RNF09–RNF12 — Rendimiento

`npm run prueba:rendimiento` (en `server/`, con el servidor encendido) mide:

| Requisito | Qué mide | Criterio |
|---|---|---|
| RNF09 | Consultar gastos, ingresos y presupuesto (20 veces cada una). Con `PRUEBA_ESCRITURA=1` también registra un ingreso y un gasto, y los borra al terminar | máximo < 3 s |
| RNF10 | Los 4 reportes (`ingresos-egresos`, `resumen`, `categorias`, `familiar`) de un año completo | < 10 s |
| RNF11 | Tamaño comprimido de la carga inicial del cliente compilado (`client/dist`), estimado en 4G conservador (1.6 Mbps, 150 ms de latencia) + 600 ms de procesamiento + `/api/auth/me`. Con `FRONT_URL` también lo mide de verdad contra `npm run preview` | < 5 s |
| RNF12 | 100 usuarios virtuales haciendo peticiones mixtas sin pausa durante 15 s, comparados contra 1 usuario | 0 errores y p95 < 3 s |

Necesita `PRUEBA_EMAIL` y `PRUEBA_PASSWORD` de un usuario con familia, ya sea en `server/.env` o como variables de entorno. Por defecto la prueba solo lee.
Si hay certificado, confía únicamente en `server/certs/famify.crt` y nunca desactiva la validación TLS.
El resultado se guarda en `docs/rendimiento/ultimo-resultado.md`.

### Base de pruebas (`famify_pruebas`)

La medición se hace en una base aparte, para no tocar la base `famify`. Esa base tiene `famify_db.sql` aplicado y la cuenta `perf@famify.test`. Sus datos se crearon por la API: 23 ingresos y 353 gastos repartidos en 12 meses, 1 presupuesto con 3 categorías y 1 meta con 5 aportaciones. Las credenciales están en `server/.env` (`PRUEBA_EMAIL` / `PRUEBA_PASSWORD`).

Para correr la prueba, primero levanta el servidor contra la base de pruebas, sin respaldos (PowerShell, en `server/`):

```powershell
$env:DB_NAME='famify_pruebas'; $env:RESPALDOS_ACTIVOS='false'; npm run dev
```

Después, en otra terminal (en `server/`):

```powershell
$env:PRUEBA_ESCRITURA='1'; npm run prueba:rendimiento
```

### Resultados (21/11/2026, servidor por HTTPS en la computadora de desarrollo)

| Requisito | Medición | Límite |
|---|---|---|
| RNF09 consultar gastos / ingresos / presupuesto | máx 13 / 10 / 16 ms | 3 s |
| RNF09 registrar ingreso / gasto | 7 / 15 ms | 3 s |
| RNF10 4 reportes de un año | máx 184 ms (resumen financiero) | 10 s |
| RNF11 carga inicial en 4G (estimada) | 2.5 s (78.4 KB comprimidos) | 5 s |
| RNF11 carga inicial real (`vite preview`) | 41 ms en red local | 5 s |
| RNF12 100 usuarios simultáneos, 15 s | 11 124 peticiones (742/s), p95 191 ms, 0 errores | p95 < 3 s |

Detalle completo: `docs/rendimiento/ultimo-resultado.md`.

Apoyos en el código:
- Cada respuesta trae `Server-Timing: app;dur=...`, el tiempo del servidor en ms (visible con `curl -i` o en F12 → Red → Tiempos).
- Conexiones persistentes (`keepAliveTimeout`) para no repetir el saludo TLS en cada petición.
- El pool de PostgreSQL es de 20 conexiones (`DB_POOL_MAX`).
- El cliente descarga cada módulo solo cuando se abre (`React.lazy`). La carga inicial es de unos 81 KB comprimidos.
