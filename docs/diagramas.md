# Diagramas de Famify (RNF28)

## Entidad-relación

Corresponde al script oficial de la base de datos (`famify_db.sql`), que no se modifica.

```mermaid
erDiagram
  FAMILIA ||--o{ USUARIO : agrupa
  ROLFAMILIAR ||--o{ USUARIO : asigna
  FAMILIA |o--o{ ROLFAMILIAR : "roles propios"
  FAMILIA ||--o{ INVITACION : emite
  ROLFAMILIAR ||--o{ INVITACION : otorga
  USUARIO ||--o| CONFIGURACION_FINANCIERA : configura
  USUARIO ||--o{ INGRESOS : recibe
  FAMILIA ||--o{ INGRESOS : acumula
  USUARIO ||--o{ GASTOS : registra
  FAMILIA ||--o{ GASTOS : acumula
  CATEGORIA_DE_LOS_GASTOS ||--o{ GASTOS : clasifica
  FAMILIA ||--o{ PRESUPUESTO : establece
  PRESUPUESTO ||--o{ PRESUPUESTO_POR_CATEGORIA : reparte
  CATEGORIA_DE_LOS_GASTOS ||--o{ PRESUPUESTO_POR_CATEGORIA : limita
  FAMILIA ||--o{ META_DE_AHORRO : define
  USUARIO |o--o{ META_DE_AHORRO : "meta personal"
  META_DE_AHORRO ||--o{ APORTACION : recibe
  USUARIO ||--o{ APORTACION : aporta
  USUARIO ||--o{ NOTIFICACION : recibe
  USUARIO ||--o{ RECORDATORIO : programa
  FAMILIA ||--o{ RESUMEN_FINANCIERO : resume
  FAMILIA ||--o{ REPORTE : guarda
```

Notas:

- `meta_de_ahorro.usuario_id` nulo indica una meta de toda la familia; `actual` y `estado` los mantienen triggers a partir de `aportacion`.
- Los permisos de cada rol son una lista separada por comas en `rolfamiliar.permisos`. Los roles base (`familia_id` nulo) no se editan: al cambiar permisos, la familia recibe su propio rol `integrante`.
- Los métodos de pago, la tarjeta de crédito (día de corte y fecha límite) y los gastos fijos viven en `configuracion_financiera`.
- La sesión se controla con `usuario.version_token` y `usuario.ultima_actividad` (`fn_iniciar_sesion`, `fn_validar_sesion`, `fn_cerrar_sesion`).
- Los avisos de corte, pago y gastos fijos los programa `fn_generar_recordatorios`; los de presupuesto y déficit, los triggers de `gastos` e `ingresos`.

## Clases y módulos del servidor

```mermaid
classDiagram
  class Middleware {
    verificarToken()
    cargarContexto()
    exigirPermiso(clave)
    sanitizarEntrada()
  }
  class AuthRoutes {
    register() login() me() logout()
    crearFamilia() generarInvitacion() unirseFamilia()
  }
  class ConfiguracionRoutes { catalogos() consultar() completar() editar() }
  class IngresosRoutes { listar() registrar() editar() eliminar() }
  class GastosRoutes { catalogos() listar() registrar() editar() eliminar() resumen() porCategoria() }
  class PresupuestoServicio { listarPresupuestos() estadoLimite() }
  class PresupuestoRoutes { listar() crear() editar() eliminar() }
  class MetasServicio { listarMetas() }
  class MetasRoutes { listar() crear() modificar() aportar() aportaciones() }
  class ReportesServicio { obtenerTotales() obtenerCategorias() obtenerPorMes() obtenerMovimientos() }
  class ReportesRoutes { resumen() ingresosEgresos() categorias() familiar() }
  class NotificacionesServicio { generarNotificaciones() iniciarNotificaciones() }
  class NotificacionesRoutes { listar() marcarLeida() marcarTodas() }
  class AdministracionRoutes { integrantes() nombres() cambiarRol() eliminar() baja() permisos() }
  class Respaldos { iniciarRespaldos() }

  Middleware <.. AuthRoutes
  Middleware <.. ConfiguracionRoutes
  Middleware <.. IngresosRoutes
  Middleware <.. GastosRoutes
  Middleware <.. PresupuestoRoutes
  Middleware <.. MetasRoutes
  Middleware <.. ReportesRoutes
  Middleware <.. NotificacionesRoutes
  Middleware <.. AdministracionRoutes
  PresupuestoRoutes --> PresupuestoServicio
  MetasRoutes --> MetasServicio
  ReportesRoutes --> ReportesServicio
  ReportesRoutes --> MetasServicio
  NotificacionesServicio --> PresupuestoServicio
  NotificacionesRoutes --> NotificacionesServicio
```
