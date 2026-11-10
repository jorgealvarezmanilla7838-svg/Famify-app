# Diagramas de Famify (RNF28)

## Entidad-relación

```mermaid
erDiagram
  FAMILIAS ||--o{ USUARIOS : agrupa
  ROLES ||--o{ USUARIOS : asigna
  ROLES ||--o{ ROL_PERMISOS : define
  PERMISOS ||--o{ ROL_PERMISOS : incluye
  FAMILIAS ||--o{ FAMILIA_ROL_PERMISOS : personaliza
  PERMISOS ||--o{ FAMILIA_ROL_PERMISOS : ajusta
  FAMILIAS ||--o{ INVITACIONES : emite
  USUARIOS ||--o{ SESIONES : abre
  USUARIOS ||--o{ USUARIO_METODOS_PAGO : configura
  METODOS_PAGO ||--o{ USUARIO_METODOS_PAGO : tipo
  USUARIOS ||--o{ INGRESOS : recibe
  USUARIOS ||--o{ GASTOS : registra
  FAMILIAS ||--o{ GASTOS : acumula
  CATEGORIAS ||--o{ GASTOS : clasifica
  METODOS_PAGO ||--o{ GASTOS : paga
  USUARIOS ||--o{ GASTOS_FIJOS : programa
  CATEGORIAS ||--o{ GASTOS_FIJOS : clasifica
  FAMILIAS ||--o{ PRESUPUESTOS : establece
  PRESUPUESTOS ||--o{ PRESUPUESTO_CATEGORIAS : reparte
  CATEGORIAS ||--o{ PRESUPUESTO_CATEGORIAS : limita
  FAMILIAS ||--o{ METAS_AHORRO : define
  USUARIOS |o--o{ METAS_AHORRO : "meta personal"
  METAS_AHORRO ||--o{ APORTACIONES_META : recibe
  USUARIOS ||--o{ APORTACIONES_META : aporta
  USUARIOS ||--o{ NOTIFICACIONES : recibe
```

Notas:

- `metas_ahorro.usuario_id` nulo indica una meta de toda la familia.
- `ingresos.usuario_id` es texto y se relaciona con `usuarios.id` mediante una conversión.
- `familia_rol_permisos` guarda los cambios de cada familia sobre los permisos por defecto de `rol_permisos`.

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
