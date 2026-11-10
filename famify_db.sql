

SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE IF NOT EXISTS roles (
  id     smallint    PRIMARY KEY,
  nombre varchar(30) NOT NULL UNIQUE
);

-- El servidor compara el nombre 'administrador' y el id 1 (admin) / 2 (integrante)
INSERT INTO roles (id, nombre) VALUES
  (1, 'administrador'),
  (2, 'integrante')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS permisos (
  clave       varchar(60) PRIMARY KEY,
  descripcion text        NOT NULL
);

INSERT INTO permisos (clave, descripcion) VALUES
  ('gastos.registrar', 'Registrar gastos propios'),
  ('gastos.editar',    'Editar o eliminar gastos (el integrante solo los suyos)'),
  ('reportes.ver',     'Consultar resúmenes y reportes de gastos')
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS rol_permisos (
  rol_id        smallint    NOT NULL REFERENCES roles (id)    ON DELETE CASCADE,
  permiso_clave varchar(60) NOT NULL REFERENCES permisos (clave) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_clave)
);

INSERT INTO rol_permisos (rol_id, permiso_clave) VALUES
  (1, 'gastos.registrar'), (1, 'gastos.editar'), (1, 'reportes.ver'),
  (2, 'gastos.registrar'), (2, 'gastos.editar'), (2, 'reportes.ver')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS metodos_pago (
  id         smallint    PRIMARY KEY,
  nombre     varchar(40) NOT NULL UNIQUE,
  es_credito boolean     NOT NULL DEFAULT false
);

INSERT INTO metodos_pago (id, nombre, es_credito) VALUES
  (1, 'Efectivo',           false),
  (2, 'Tarjeta de débito',  false),
  (3, 'Tarjeta de crédito', true),
  (4, 'Transferencia',      false)
ON CONFLICT (id) DO NOTHING;

-- El cuestionario toma el primer método con es_credito = true, así que solo puede haber uno
CREATE UNIQUE INDEX IF NOT EXISTS ux_metodos_pago_credito
  ON metodos_pago (es_credito) WHERE es_credito;

-- -----------------------------------------------------------------------------
-- 2. Familias y usuarios
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS familias (
  id         bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre     varchar(100) NOT NULL CHECK (btrim(nombre) <> ''),
  created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id                           bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre                       varchar(100) NOT NULL CHECK (btrim(nombre) <> ''),
  email                        varchar(254) NOT NULL,
  password_hash                varchar(100) NOT NULL,
  rol_id                       smallint     REFERENCES roles (id),
  familia_id                   bigint       REFERENCES familias (id),
  activo                       boolean      NOT NULL DEFAULT true,
  aviso_privacidad_aceptado_en timestamptz,
  -- cuestionario de configuración (RF05 a RF08)
  recibe_sueldo                boolean,
  ingreso_principal            numeric(12,2) CHECK (ingreso_principal IS NULL OR ingreso_principal > 0),
  tiene_ingresos_secundarios   boolean      NOT NULL DEFAULT false,
  dias_ingreso                 smallint[]   CHECK (dias_ingreso IS NULL OR
                                 dias_ingreso <@ '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31}'::smallint[]),
  perfil_completo              boolean      NOT NULL DEFAULT false,
  created_at                   timestamptz  NOT NULL DEFAULT now(),
  -- el rol y la familia se asignan siempre juntos (al crear o unirse a una familia)
  CONSTRAINT ck_usuarios_rol_familia CHECK ((rol_id IS NULL) = (familia_id IS NULL))
);

-- El servidor busca el correo tal cual (distingue mayúsculas), por eso el índice también
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email   ON usuarios (email);
CREATE INDEX        IF NOT EXISTS ix_usuarios_familia ON usuarios (familia_id);

CREATE TABLE IF NOT EXISTS invitaciones (
  id             bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia_id     bigint       NOT NULL REFERENCES familias (id) ON DELETE CASCADE,
  codigo         varchar(20)  NOT NULL UNIQUE,
  rol_id         smallint     NOT NULL REFERENCES roles (id),
  email_invitado varchar(254),
  creada_por     bigint       NOT NULL REFERENCES usuarios (id),
  creada_en      timestamptz  NOT NULL DEFAULT now(),
  expira_en      timestamptz  NOT NULL DEFAULT now() + interval '48 hours',
  usada_en       timestamptz,
  usada_por      bigint       REFERENCES usuarios (id)
);

-- -----------------------------------------------------------------------------
-- 3. Categorías y configuración del usuario
-- -----------------------------------------------------------------------------

-- familia_id NULL = categoría general (la ven todas las familias)
CREATE TABLE IF NOT EXISTS categorias (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia_id bigint      REFERENCES familias (id) ON DELETE CASCADE,
  nombre     varchar(60) NOT NULL CHECK (btrim(nombre) <> ''),
  activa     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_categorias_nombre
  ON categorias (COALESCE(familia_id, 0), lower(nombre));

-- Los nombres Educación, Transporte, Alimentos, Servicios y Hogar los usa el
-- cuestionario del cliente como atajos, no los cambies.
INSERT INTO categorias (familia_id, nombre) VALUES
  (NULL, 'Alimentos'),
  (NULL, 'Hogar'),
  (NULL, 'Servicios'),
  (NULL, 'Transporte'),
  (NULL, 'Educación'),
  (NULL, 'Salud'),
  (NULL, 'Entretenimiento'),
  (NULL, 'Ropa'),
  (NULL, 'Otros')
ON CONFLICT (COALESCE(familia_id, 0), lower(nombre)) DO NOTHING;

-- Tarjetas y métodos de pago del usuario (solo alias y días, nunca el número de tarjeta)
CREATE TABLE IF NOT EXISTS usuario_metodos_pago (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id      bigint      NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  metodo_pago_id  smallint    NOT NULL REFERENCES metodos_pago (id),
  alias           varchar(50) NOT NULL DEFAULT 'Principal' CHECK (btrim(alias) <> ''),
  dia_corte       smallint    CHECK (dia_corte BETWEEN 1 AND 31),
  dia_limite_pago smallint    CHECK (dia_limite_pago BETWEEN 1 AND 31),
  activo          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_metodos_pago_alias
  ON usuario_metodos_pago (usuario_id, metodo_pago_id, lower(alias));

-- -----------------------------------------------------------------------------
-- 4. Gastos fijos y gastos
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gastos_fijos (
  id           bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia_id   bigint        NOT NULL REFERENCES familias (id)  ON DELETE CASCADE,
  usuario_id   bigint        NOT NULL REFERENCES usuarios (id)  ON DELETE CASCADE,
  categoria_id bigint        NOT NULL REFERENCES categorias (id),
  descripcion  varchar(150)  NOT NULL CHECK (btrim(descripcion) <> ''),
  monto        numeric(12,2) NOT NULL CHECK (monto > 0),
  dia_pago     smallint      NOT NULL CHECK (dia_pago BETWEEN 1 AND 31),
  dias_aviso   smallint      NOT NULL DEFAULT 3 CHECK (dias_aviso BETWEEN 0 AND 30),
  activo       boolean       NOT NULL DEFAULT true,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gastos_fijos_usuario ON gastos_fijos (usuario_id, familia_id);

CREATE TABLE IF NOT EXISTS gastos (
  id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia_id     bigint        NOT NULL REFERENCES familias (id) ON DELETE CASCADE,
  usuario_id     bigint        NOT NULL REFERENCES usuarios (id),
  categoria_id   bigint        NOT NULL REFERENCES categorias (id),
  metodo_pago_id smallint      NOT NULL REFERENCES metodos_pago (id),
  monto          numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha          date          NOT NULL DEFAULT current_date,
  descripcion    varchar(200),
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gastos_familia_fecha ON gastos (familia_id, fecha);
CREATE INDEX IF NOT EXISTS ix_gastos_usuario_fecha ON gastos (usuario_id, fecha);

-- -----------------------------------------------------------------------------
-- 5. Funciones que llama el servidor
-- -----------------------------------------------------------------------------

-- RF02: crea la familia y deja al usuario como administrador
CREATE OR REPLACE FUNCTION fn_crear_familia(p_usuario_id bigint, p_nombre text)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_usuario    usuarios%ROWTYPE;
  v_familia_id bigint;
BEGIN
  IF btrim(coalesce(p_nombre, '')) = '' THEN
    RAISE EXCEPTION 'El nombre de la familia es obligatorio.';
  END IF;

  SELECT * INTO v_usuario FROM usuarios WHERE id = p_usuario_id AND activo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe o está inactivo.';
  END IF;
  IF v_usuario.familia_id IS NOT NULL THEN
    RAISE EXCEPTION 'El usuario ya pertenece a una familia.';
  END IF;

  INSERT INTO familias (nombre) VALUES (btrim(p_nombre)) RETURNING id INTO v_familia_id;
  UPDATE usuarios SET familia_id = v_familia_id, rol_id = 1 WHERE id = p_usuario_id;

  RETURN v_familia_id;
END;
$$;

-- RF03 / RNF06: crea un código de invitación válido por 48 horas (solo el administrador)
CREATE OR REPLACE FUNCTION fn_crear_invitacion(p_usuario_id bigint, p_rol_id smallint, p_email text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_usuario usuarios%ROWTYPE;
  v_codigo  text;
BEGIN
  SELECT * INTO v_usuario FROM usuarios WHERE id = p_usuario_id AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe o está inactivo.';
  END IF;
  IF v_usuario.familia_id IS NULL THEN
    RAISE EXCEPTION 'Primero debes crear una familia.';
  END IF;
  IF v_usuario.rol_id <> 1 THEN
    RAISE EXCEPTION 'Solo el administrador puede generar invitaciones.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = p_rol_id) THEN
    RAISE EXCEPTION 'El rol indicado no existe.';
  END IF;

  v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO invitaciones (familia_id, codigo, rol_id, email_invitado, creada_por)
  VALUES (v_usuario.familia_id, v_codigo, p_rol_id, nullif(btrim(p_email), ''), p_usuario_id);

  RETURN v_codigo;
END;
$$;

-- RF04: el usuario se une a la familia con un código de invitación
CREATE OR REPLACE FUNCTION fn_usar_invitacion(p_codigo text, p_usuario_id bigint)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_usuario usuarios%ROWTYPE;
  v_inv     invitaciones%ROWTYPE;
BEGIN
  SELECT * INTO v_usuario FROM usuarios WHERE id = p_usuario_id AND activo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe o está inactivo.';
  END IF;
  IF v_usuario.familia_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ya perteneces a una familia.';
  END IF;

  SELECT * INTO v_inv FROM invitaciones WHERE codigo = upper(btrim(coalesce(p_codigo, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El código de invitación no es válido.';
  END IF;
  IF v_inv.usada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Este código de invitación ya fue utilizado.';
  END IF;
  IF v_inv.expira_en < now() THEN
    RAISE EXCEPTION 'El código de invitación expiró. Pide uno nuevo al administrador.';
  END IF;
  IF v_inv.email_invitado IS NOT NULL AND lower(v_inv.email_invitado) <> lower(v_usuario.email) THEN
    RAISE EXCEPTION 'Esta invitación fue enviada a otro correo electrónico.';
  END IF;

  UPDATE usuarios SET familia_id = v_inv.familia_id, rol_id = v_inv.rol_id WHERE id = p_usuario_id;
  UPDATE invitaciones SET usada_en = now(), usada_por = p_usuario_id WHERE id = v_inv.id;

  RETURN v_inv.familia_id;
END;
$$;

-- RF18: gasto total y porcentaje por categoría de toda la familia
CREATE OR REPLACE FUNCTION fn_gastos_por_categoria(p_familia_id bigint, p_desde date, p_hasta date)
RETURNS TABLE (categoria_id bigint, categoria text, total numeric, porcentaje numeric)
LANGUAGE sql STABLE AS $$
  SELECT c.id,
         c.nombre::text,
         sum(g.monto),
         round(100 * sum(g.monto) / NULLIF(sum(sum(g.monto)) OVER (), 0), 2)
    FROM gastos g
    JOIN categorias c ON c.id = g.categoria_id
   WHERE g.familia_id = p_familia_id
     AND g.fecha BETWEEN p_desde AND p_hasta
   GROUP BY c.id, c.nombre
   ORDER BY sum(g.monto) DESC;
$$;

-- -----------------------------------------------------------------------------
-- 6. Triggers: RNF04 aislamiento de datos por familia
-- -----------------------------------------------------------------------------

-- Un gasto (o gasto fijo) solo puede ser de un usuario que pertenece a esa familia
-- y de una categoría general o de esa misma familia.
CREATE OR REPLACE FUNCTION fn_validar_pertenencia()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM usuarios u
     WHERE u.id = NEW.usuario_id AND u.familia_id = NEW.familia_id AND u.activo
  ) THEN
    RAISE EXCEPTION 'El usuario no pertenece a la familia indicada.';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.categoria_id IS DISTINCT FROM OLD.categoria_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM categorias c
       WHERE c.id = NEW.categoria_id
         AND c.activa
         AND (c.familia_id IS NULL OR c.familia_id = NEW.familia_id)
    ) THEN
      RAISE EXCEPTION 'La categoría indicada no está disponible para esta familia.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_gastos_pertenencia ON gastos;
CREATE TRIGGER tg_gastos_pertenencia
  BEFORE INSERT OR UPDATE OF familia_id, usuario_id, categoria_id ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_pertenencia();

DROP TRIGGER IF EXISTS tg_gastos_fijos_pertenencia ON gastos_fijos;
CREATE TRIGGER tg_gastos_fijos_pertenencia
  BEFORE INSERT OR UPDATE OF familia_id, usuario_id, categoria_id ON gastos_fijos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_pertenencia();

-- -----------------------------------------------------------------------------
-- 7. Ingresos (RF09 a RF12)
-- -----------------------------------------------------------------------------

-- usuario_id es texto porque así existe la tabla en las bases ya creadas;
-- los reportes la unen con usuarios mediante u.id::text = i.usuario_id
CREATE TABLE IF NOT EXISTS ingresos (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   varchar(50)   NOT NULL,
  monto        numeric(12,2) NOT NULL CHECK (monto > 0),
  fuente       varchar(100)  NOT NULL,
  tipo         varchar(20)   NOT NULL,
  periodicidad varchar(20)   NOT NULL,
  fecha        timestamptz   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_ingresos_usuario_fecha ON ingresos (usuario_id, fecha);

-- -----------------------------------------------------------------------------
-- 8. Sesiones (RNF05: expiran por inactividad y se invalidan al cerrar sesión)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sesiones (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       bigint      NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  creada_en        timestamptz NOT NULL DEFAULT now(),
  ultima_actividad timestamptz NOT NULL DEFAULT now(),
  cerrada_en       timestamptz
);

CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON sesiones (usuario_id);

-- -----------------------------------------------------------------------------
-- 9. Permisos por familia (RF039, RNF03)
-- -----------------------------------------------------------------------------

INSERT INTO permisos (clave, descripcion) VALUES
  ('ingresos.registrar',     'Registrar ingresos propios'),
  ('ingresos.editar',        'Editar o eliminar ingresos propios'),
  ('presupuestos.gestionar', 'Crear, modificar y eliminar presupuestos'),
  ('metas.crear',            'Crear metas de ahorro'),
  ('metas.aportar',          'Registrar aportaciones a metas de ahorro'),
  ('metas.editar',           'Modificar metas de ahorro (el integrante solo las suyas)')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_clave) VALUES
  (1, 'ingresos.registrar'), (1, 'ingresos.editar'), (1, 'presupuestos.gestionar'),
  (1, 'metas.crear'), (1, 'metas.aportar'), (1, 'metas.editar'),
  (2, 'ingresos.registrar'), (2, 'ingresos.editar'),
  (2, 'metas.crear'), (2, 'metas.aportar'), (2, 'metas.editar')
ON CONFLICT DO NOTHING;

-- rol_permisos son los valores por defecto; aquí cada familia guarda sus cambios
-- para que lo que decida un administrador no afecte a otras familias (RNF04).
CREATE TABLE IF NOT EXISTS familia_rol_permisos (
  familia_id    bigint      NOT NULL REFERENCES familias (id) ON DELETE CASCADE,
  rol_id        smallint    NOT NULL REFERENCES roles (id),
  permiso_clave varchar(60) NOT NULL REFERENCES permisos (clave) ON DELETE CASCADE,
  permitido     boolean     NOT NULL,
  PRIMARY KEY (familia_id, rol_id, permiso_clave)
);

-- RNF03: ¿el usuario tiene este permiso según su rol y su familia?
-- RF05: quien indicó que no recibe sueldo no tiene los permisos de ingresos.
CREATE OR REPLACE FUNCTION fn_tiene_permiso(p_usuario_id bigint, p_clave text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM usuarios u
      LEFT JOIN rol_permisos rp
             ON rp.rol_id = u.rol_id AND rp.permiso_clave = p_clave
      LEFT JOIN familia_rol_permisos frp
             ON frp.familia_id = u.familia_id AND frp.rol_id = u.rol_id AND frp.permiso_clave = p_clave
     WHERE u.id = p_usuario_id
       AND u.activo
       AND COALESCE(frp.permitido, rp.permiso_clave IS NOT NULL)
       AND (p_clave NOT LIKE 'ingresos.%' OR u.recibe_sueldo IS DISTINCT FROM false)
  );
$$;

-- -----------------------------------------------------------------------------
-- 10. Presupuesto familiar (RF019 a RF022)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS presupuestos (
  id          bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia_id  bigint        NOT NULL REFERENCES familias (id) ON DELETE CASCADE,
  nombre      varchar(100)  NOT NULL CHECK (btrim(nombre) <> ''),
  monto_total numeric(12,2) NOT NULL CHECK (monto_total > 0),
  desde       date          NOT NULL,
  hasta       date          NOT NULL,
  creado_por  bigint        NOT NULL REFERENCES usuarios (id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_presupuestos_periodo CHECK (hasta >= desde)
);

CREATE INDEX IF NOT EXISTS ix_presupuestos_familia ON presupuestos (familia_id, hasta);

CREATE TABLE IF NOT EXISTS presupuesto_categorias (
  presupuesto_id bigint        NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  categoria_id   bigint        NOT NULL REFERENCES categorias (id),
  monto          numeric(12,2) NOT NULL CHECK (monto > 0),
  PRIMARY KEY (presupuesto_id, categoria_id)
);

-- -----------------------------------------------------------------------------
-- 11. Metas de ahorro (RF023 a RF026)
-- -----------------------------------------------------------------------------

-- usuario_id NULL = meta de toda la familia
CREATE TABLE IF NOT EXISTS metas_ahorro (
  id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia_id     bigint        NOT NULL REFERENCES familias (id) ON DELETE CASCADE,
  usuario_id     bigint        REFERENCES usuarios (id) ON DELETE SET NULL,
  nombre         varchar(100)  NOT NULL CHECK (btrim(nombre) <> ''),
  descripcion    varchar(200),
  monto_objetivo numeric(12,2) NOT NULL CHECK (monto_objetivo > 0),
  monto_ahorrado numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto_ahorrado >= 0),
  fecha_limite   date,
  creada_por     bigint        NOT NULL REFERENCES usuarios (id),
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_metas_familia ON metas_ahorro (familia_id);

CREATE TABLE IF NOT EXISTS aportaciones_meta (
  id         bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meta_id    bigint        NOT NULL REFERENCES metas_ahorro (id) ON DELETE CASCADE,
  usuario_id bigint        NOT NULL REFERENCES usuarios (id),
  monto      numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha      date          NOT NULL DEFAULT current_date,
  created_at timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_aportaciones_meta ON aportaciones_meta (meta_id);

-- -----------------------------------------------------------------------------
-- 12. Notificaciones y recordatorios (RF022, RF032 a RF036)
-- -----------------------------------------------------------------------------

-- clave evita repetir el mismo aviso (por ejemplo corte:12:2026-11-20)
CREATE TABLE IF NOT EXISTS notificaciones (
  id         bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id bigint       NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  tipo       varchar(20)  NOT NULL,
  titulo     varchar(120) NOT NULL,
  mensaje    varchar(300) NOT NULL,
  clave      varchar(120) NOT NULL,
  leida_en   timestamptz,
  created_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ux_notificaciones_clave UNIQUE (usuario_id, clave)
);

CREATE INDEX IF NOT EXISTS ix_notificaciones_usuario ON notificaciones (usuario_id, created_at DESC);

COMMIT;