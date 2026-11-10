# Matriz de cumplimiento de Famify

Referencia: documento de requerimientos funcionales y no funcionales del proyecto.

Estados:

- **Cumple:** implementado y comprobado con pruebas automáticas, mediciones o en el navegador.
- **Código listo:** implementado y probado; falta activarlo o publicarlo en un servidor real.
- **Parcial:** cubierto en parte; se indica qué falta.
- **Sin probar:** no fue posible comprobarlo en el entorno disponible.

Las mediciones se hicieron en una sola máquina, con servidor, cliente de prueba y base de datos juntos. No incluyen la latencia de una red real.

## Requerimientos funcionales

| Módulo | Requerimientos | Estado | Evidencia |
| --- | --- | --- | --- |
| Gestión de usuarios | RF01 a RF04 | Cumple | Registro, familia, invitación por enlace y por código, en API y navegador |
| Configuración de usuario | RF05 a RF08 | Cumple | Cuestionario con varias tarjetas; editable después en Mi configuración |
| Gestión de ingresos | RF09 a RF012 | Cumple | Alta, edición, baja, clasificación y consulta por periodo |
| Gestión de gastos | RF013 a RF018 | Cumple | Alta, edición, baja, categoría, método de pago y lista paginada |
| Presupuesto familiar | RF019 a RF022 | Cumple | Límite total y por categoría, disponible y alertas |
| Metas de ahorro | RF023 a RF026 | Cumple | Metas familiares y por integrante; aportaciones simultáneas exactas |
| Resumen financiero | RF027 a RF031 | Cumple | Totales, balance, gráficas, comparación y metas |
| Notificaciones | RF032 a RF036 | Cumple | Corte, pago, gastos fijos, presupuesto y déficit, sin duplicados |
| Administración familiar | RF037 a RF040 | Cumple | Integrantes, roles, permisos por familia y eliminación |
| Reportes financieros | RF041 a RF043 | Cumple | Filtros, por categoría, familiar y descarga en CSV |

Criterio aplicado en RF05: quien responde que no recibe sueldo no puede registrar ni editar ingresos, hasta que lo cambie en Mi configuración.

## Requerimientos no funcionales

| Requerimiento | Estado | Evidencia o pendiente |
| --- | --- | --- |
| RNF01 Cifrado de contraseñas | Cumple | bcrypt, comprobado en la base de datos |
| RNF02 HTTPS/TLS | Código listo | Probado con certificado autofirmado, HSTS y proxy; falta publicarlo con un certificado real |
| RNF03 Control por rol | Cumple | Probado por rol y por permiso, también con cambios durante la sesión |
| RNF04 Aislamiento por familia | Cumple | Probado entre dos familias |
| RNF05 Sesiones | Cumple | 30 minutos de inactividad; token invalidado al salir |
| RNF06 Invitaciones | Cumple | 48 horas y un solo uso |
| RNF07 Datos de tarjetas | Cumple | Solo alias y días; se rechaza un alias con número de tarjeta |
| RNF08 SQL y XSS | Cumple | Consultas con parámetros y limpieza de entradas |
| RNF09 Respuesta menor a 3 s | Cumple | Con 23,000 registros: máximo 42 ms |
| RNF10 Reportes menores a 10 s | Cumple | Un año con 23,000 registros: máximo 416 ms |
| RNF11 Carga inicial menor a 5 s | Sin probar | Estimado cerca de 2 s en 4G lenta por el peso de 88 kB comprimido; falta medir en red real |
| RNF12 100 usuarios simultáneos | Cumple | 100 usuarios durante 40 s: 3,941 peticiones, 0 errores, p95 de 24 ms |
| RNF13 Disponibilidad 99 % | Sin probar | Depende del servidor donde se publique; `/api/health` permite monitorearlo |
| RNF14 Respaldo diario | Código listo | Respaldo real generado con `pg_dump`; se activa con `RESPALDOS_ACTIVOS=true` |
| RNF15 Transacciones | Cumple | Probado que un fallo revierte la aportación |
| RNF16 Manejo de errores | Cumple | Mensajes claros, sin detalles internos |
| RNF17 Puntualidad de avisos | Cumple | Ciclo cada 5 minutos; aviso medido a los 295 s, límite de 900 s |
| RNF18 Facilidad de aprendizaje | Cumple | Tras el registro inicial: sección, monto, fuente y guardar |
| RNF19 Interfaz consistente | Cumple | Navegación, colores y botones compartidos en todas las pantallas |
| RNF20 Español | Cumple | Interfaz, mensajes e idioma del documento |
| RNF21 Mensajes de validación | Cumple | Los errores indican campo y corrección |
| RNF22 Accesibilidad AA | Parcial | Contraste, tamaños y etiquetas revisados con script en todas las pantallas, sin fallos; falta probar con teclado y lector de pantalla |
| RNF23 Formato de datos | Cumple | MXN con dos decimales y DD/MM/AAAA; los selectores de fecha siguen el idioma del navegador |
| RNF24 Responsive | Cumple | Sin desbordes a 375 px, 768 px y escritorio |
| RNF25 Navegadores | Sin probar | Solo se probó en un navegador basado en Chromium; faltan Firefox y Safari |
| RNF26 Sistemas operativos | Sin probar | Solo se probó en Windows; faltan macOS, Android e iOS |
| RNF27 Arquitectura modular | Cumple | Un directorio por módulo funcional |
| RNF28 Documentación | Cumple | Diagramas en `docs/diagramas.md` y comentarios en funciones principales |
| RNF29 Control de versiones | Cumple | Repositorio Git con commits descriptivos |
| RNF30 Escalabilidad | Cumple | Datos separados por familia, índices y pool de conexiones |
| RNF31 Aviso de privacidad | Parcial | Se muestra y se exige aceptarlo; falta el domicilio y contacto reales del responsable |
| RNF32 Eliminación de datos | Cumple | Baja y eliminación con anonimización probadas |

## Actualizar una base existente

```bash
npm --prefix server run db:aplicar
```

El script solo agrega lo que falta y no borra datos.
