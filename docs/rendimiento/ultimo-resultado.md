# Prueba de rendimiento de Famify

- Fecha: 21/11/2026, 1:17:19 p.m.
- Servidor: https://localhost:4000 (HTTPS/TLS)
- Repeticiones RNF09: 20 | Usuarios simultáneos RNF12: 100 durante 15 s

| Resultado | Requisito | Medición |
|---|---|---|
| CUMPLE | RNF09 Consultar gastos del mes (< 3 s) | máx 16 ms, p95 8 ms, errores 0 |
| CUMPLE | RNF09 Consultar ingresos del mes (< 3 s) | máx 10 ms, p95 7 ms, errores 0 |
| CUMPLE | RNF09 Consultar presupuesto (< 3 s) | máx 11 ms, p95 7 ms, errores 0 |
| CUMPLE | RNF10 Reporte de ingresos y egresos de un año (< 10 s) | máx 9 ms, errores 0 |
| CUMPLE | RNF10 Resumen financiero de un año (< 10 s) | máx 71 ms, errores 0 |
| CUMPLE | RNF10 Reporte por categoría de un año (< 10 s) | máx 6 ms, errores 0 |
| CUMPLE | RNF10 Reporte familiar de un año (< 10 s) | máx 5 ms, errores 0 |
| CUMPLE | RNF11 Carga inicial en 4G (< 5 s) | 2487 ms estimados: descarga 78.4 KB comprimidos (3 archivos) a 1.6 Mbps/150 ms + 600 ms de procesamiento + API 754 ms |
| CUMPLE | RNF11 Carga inicial medida en esta red (< 5 s) | 41 ms (https://localhost:4173/) |
| CUMPLE | RNF12 100 usuarios simultáneos (sin errores, p95 < 3 s) | 11124 peticiones en 15 s (742/s), p50 124 ms, p95 191 ms (con 1 usuario: 6 ms, x33.2), errores 0 |

**Todos los requisitos de rendimiento se cumplen.**
