-- =====================================================================
--  FAMIFY - Base de datos (PostgreSQL 14+)
--  Universidad de Guadalajara - CUCEI - Ingenieria de Software D16
--
--  Como correrlo:
--     createdb famify
--     psql -d famify -f famify_db.sql
--
--  TABLAS (16, una por cada clase/entidad de los diagramas, mismo nombre):
--     familia, usuario, rolfamiliar, invitacion, configuracion_financiera,
--     ingresos, gastos, categoria_de_los_gastos, presupuesto,
--     presupuesto_por_categoria, meta_de_ahorro, aportacion,
--     notificacion, recordatorio, resumen_financiero, reporte
--  (PostgreSQL guarda los nombres sin comillas en minusculas.)
--
--  Mapa rapido requisito -> objeto de BD
--  RF01/RF04  usuario, fn_iniciar_sesion, fn_usar_invitacion
--  RF02       familia, fn_crear_familia
--  RF03/RF04  invitacion, fn_crear_invitacion, fn_usar_invitacion
--  RF05-RF08  usuario.recibe_sueldo, configuracion_financiera
--  RF09-RF12  ingresos (tipo_de_ingreso, periodicidad, indices por fecha)
--  RF13-RF18  gastos, categoria_de_los_gastos, fn_gastos_por_categoria
--  RF19-RF22  presupuesto, presupuesto_por_categoria, v_presupuesto_estado
--  RF23-RF26  meta_de_ahorro, aportacion, v_progreso_metas
--  RF27-RF31  resumen_financiero, fn_generar_resumen, fn_serie_mensual
--  RF32-RF36  recordatorio, notificacion, fn_generar_recordatorios
--  RF37-RF40  rolfamiliar, fn_cambiar_rol, fn_eliminar_integrante
--  RF41-RF43  reporte, fn_generar_reporte
--  RNF01      usuario.contrasena (CHECK de formato bcrypt/argon2)
--  RNF03      fn_tiene_permiso + tg_exigir_permiso
--  RNF04      Row Level Security por familia
--  RNF05      usuario.ultima_actividad / version_token (30 min)
--  RNF06      invitacion (48 h, un solo uso, solo se guarda el hash)
--  RNF07      configuracion_financiera (NO hay columnas de numero/CVV)
--  RNF08      tipos fuertes + CHECKs (la sanitizacion XSS va en la app)
--  RNF15      triggers dentro de la misma transaccion
--  RNF17      recordatorio.fecha_aviso + fn_generar_recordatorios
--  RNF23      numeric(12,2) para montos (el formato MXN se hace en la app)
--  RNF28      COMMENT ON TABLE en todas las tablas
--  RNF30      llaves identity bigint, indices
--  RNF31      usuario.aviso_privacidad_aceptado_en NOT NULL
--  RNF32      fn_anonimizar_usuario
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- para evitar presupuestos traslapados

-- ---------------------------------------------------------------------
-- 1. FUNCIONES DE VALIDACION (se usan en CHECKs)
-- ---------------------------------------------------------------------
-- Arreglo de dias de mes (1..31)
CREATE FUNCTION fn_dias_validos(d smallint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT d IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(d) x WHERE x IS NULL OR x NOT BETWEEN 1 AND 31)
$$;

-- Lista de permisos separados por coma: todos deben existir
CREATE FUNCTION fn_permisos_validos(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT p IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(string_to_array(p, ',')) x
         WHERE x <> ALL (ARRAY['ingresos.registrar','ingresos.editar','gastos.registrar',
                               'gastos.editar','gastos.ver_detalle','presupuesto.gestionar',
                               'metas.gestionar','metas.aportar','reportes.ver',
                               'familia.invitar','familia.administrar']))
$$;

-- RF08: gastos fijos = arreglo JSON de {descripcion, monto, dia_pago, dias_aviso}
CREATE FUNCTION fn_gastos_fijos_validos(j jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e jsonb;
BEGIN
    IF j IS NULL OR jsonb_typeof(j) <> 'array' THEN RETURN false; END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(j) LOOP
        IF jsonb_typeof(e) <> 'object'
           OR btrim(COALESCE(e->>'descripcion','')) = ''
           OR COALESCE((e->>'monto')::numeric, 0) <= 0
           OR COALESCE((e->>'dia_pago')::int, 0) NOT BETWEEN 1 AND 31
           OR COALESCE((e->>'dias_aviso')::int, 3) NOT BETWEEN 0 AND 30 THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
EXCEPTION WHEN others THEN
    RETURN false;      -- cualquier dato mal tipado (ej. monto = 'abc')
END $$;

-- ---------------------------------------------------------------------
-- 2. FAMILIA, ROLFAMILIAR Y USUARIO
-- ---------------------------------------------------------------------
CREATE TABLE familia (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre            varchar(80) NOT NULL CHECK (btrim(nombre) <> ''),
    fecha_de_creacion timestamptz NOT NULL DEFAULT now(),
    creada_por        bigint                        -- FK se agrega despues (circular)
);

-- RF038/RF039: roles y permisos. familia_id NULL = rol base del sistema
CREATE TABLE rolfamiliar (
    id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id bigint REFERENCES familia(id) ON DELETE CASCADE,
    nombre     varchar(50) NOT NULL CHECK (btrim(nombre) <> ''),
    permisos   varchar(255) NOT NULL CHECK (fn_permisos_validos(permisos))
);
CREATE UNIQUE INDEX ux_rolfamiliar_nombre ON rolfamiliar (COALESCE(familia_id, 0), lower(nombre));

CREATE TABLE usuario (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id bigint   REFERENCES familia(id),
    rol_id     smallint REFERENCES rolfamiliar(id),
    nombre     varchar(100) NOT NULL CHECK (btrim(nombre) <> ''),
    email      varchar(254) NOT NULL
               CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    -- RNF01: solo se acepta formato bcrypt ($2a/$2b/$2y) o argon2; nunca texto plano
    contrasena text NOT NULL
               CHECK (contrasena ~ '^\$(2[aby]\$[0-9]{2}\$.{53}|argon2(id|i|d)\$.+)$'),
    recibe_sueldo boolean NOT NULL DEFAULT false,                 -- RF05
    perfil_completo boolean NOT NULL DEFAULT false,               -- RF04
    -- RNF31: obligatorio aceptar el aviso de privacidad al registrarse
    aviso_privacidad_aceptado_en timestamptz NOT NULL,
    -- RNF05: sesion de 30 min de inactividad; cerrar sesion sube version_token
    ultima_actividad timestamptz,
    version_token    integer NOT NULL DEFAULT 0,
    activo        boolean NOT NULL DEFAULT true,
    anonimizado   boolean NOT NULL DEFAULT false,                 -- RNF32
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- Tener familia y tener rol van siempre juntos
    CONSTRAINT ck_familia_rol CHECK ((familia_id IS NULL) = (rol_id IS NULL))
);
CREATE UNIQUE INDEX ux_usuario_email ON usuario (lower(email));
CREATE INDEX ix_usuario_familia ON usuario (familia_id) WHERE familia_id IS NOT NULL;

ALTER TABLE familia
    ADD CONSTRAINT fk_familia_creada_por FOREIGN KEY (creada_por) REFERENCES usuario(id);

-- ---------------------------------------------------------------------
-- 3. INVITACION (RF03, RF04, RNF06)
-- ---------------------------------------------------------------------
CREATE TABLE invitacion (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id       bigint   NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    usuario_id       bigint   REFERENCES usuario(id),     -- quien recibe/canjea (se llena al aceptar)
    invitado_por     bigint   NOT NULL REFERENCES usuario(id),
    rol_id           smallint NOT NULL REFERENCES rolfamiliar(id),
    email_invitado   varchar(254),
    codigo_hash      bytea    NOT NULL UNIQUE,            -- solo se guarda el hash del codigo
    estado           varchar(20) NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','aceptada','expirada','cancelada')),
    fecha_de_envio   timestamptz NOT NULL DEFAULT now(),
    fecha_expiracion timestamptz NOT NULL DEFAULT now() + interval '48 hours',
    fecha_uso        timestamptz,
    CONSTRAINT ck_inv_expira CHECK (fecha_expiracion > fecha_de_envio),
    CONSTRAINT ck_inv_uso    CHECK (estado <> 'aceptada' OR (fecha_uso IS NOT NULL AND usuario_id IS NOT NULL))
);
CREATE INDEX ix_invitacion_familia ON invitacion (familia_id);

-- ---------------------------------------------------------------------
-- 4. CONFIGURACION_FINANCIERA (RF05-RF08) - una fila por usuario
-- ---------------------------------------------------------------------
-- RNF07: NO existen columnas para numero de tarjeta ni CVV.
CREATE TABLE configuracion_financiera (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id           bigint NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE CASCADE,
    ingreso_principal    numeric(12,2) CHECK (ingreso_principal >= 0),
    ingresos_secundarios varchar(255),                      -- NULL = no tiene
    dias_de_ingreso      smallint[] CHECK (fn_dias_validos(dias_de_ingreso)),
    -- RF06: menu de metodos de pago que usa
    metodos_de_pago      text[] NOT NULL DEFAULT '{}'
                         CHECK (metodos_de_pago <@ ARRAY['efectivo','tarjeta_debito','tarjeta_credito','otro']),
    -- RF07: solo si usa tarjeta de credito (se usa el dia del mes de cada fecha)
    dia_de_corte         smallint CHECK (dia_de_corte BETWEEN 1 AND 31),
    fecha_limite_de_pago date,
    -- RF08: [{"descripcion":"Colegiatura","monto":1500,"dia_pago":5,"dias_aviso":3}, ...]
    gastos_fijos         jsonb NOT NULL DEFAULT '[]' CHECK (fn_gastos_fijos_validos(gastos_fijos)),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_credito_requiere_fechas CHECK
        (NOT ('tarjeta_credito' = ANY (metodos_de_pago))
         OR (dia_de_corte IS NOT NULL AND fecha_limite_de_pago IS NOT NULL)),
    CONSTRAINT ck_fechas_solo_credito CHECK
        ('tarjeta_credito' = ANY (metodos_de_pago)
         OR (dia_de_corte IS NULL AND fecha_limite_de_pago IS NULL))
);

-- ---------------------------------------------------------------------
-- 5. INGRESOS (RF09-RF12)
-- ---------------------------------------------------------------------
CREATE TABLE ingresos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id      bigint NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    usuario_id      bigint NOT NULL REFERENCES usuario(id),
    monto           numeric(12,2) NOT NULL CHECK (monto > 0),               -- RNF21
    fuente          varchar(255) NOT NULL CHECK (btrim(fuente) <> ''),
    periodicidad    varchar(255) NOT NULL DEFAULT 'mensual'
                    CHECK (periodicidad IN ('unico','semanal','quincenal','mensual','anual')),
    fecha           date NOT NULL DEFAULT current_date,
    tipo_de_ingreso varchar(255) NOT NULL DEFAULT 'salario'                 -- RF011
                    CHECK (tipo_de_ingreso IN ('salario','tanda','prestamo','otro')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ingresos_familia_fecha ON ingresos (familia_id, fecha);   -- RF012
CREATE INDEX ix_ingresos_usuario       ON ingresos (usuario_id);

-- ---------------------------------------------------------------------
-- 6. CATEGORIA_DE_LOS_GASTOS Y GASTOS (RF13-RF18)
-- ---------------------------------------------------------------------
CREATE TABLE categoria_de_los_gastos (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id bigint REFERENCES familia(id) ON DELETE CASCADE,   -- NULL = categoria global
    nombre     varchar(255) NOT NULL CHECK (btrim(nombre) <> ''),
    activa     boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_categoria_nombre ON categoria_de_los_gastos (COALESCE(familia_id, 0), lower(nombre));

CREATE TABLE gastos (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id     bigint NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    usuario_id     bigint NOT NULL REFERENCES usuario(id),
    categoria_id   bigint NOT NULL REFERENCES categoria_de_los_gastos(id),   -- RF015
    monto          numeric(12,2) NOT NULL CHECK (monto > 0),
    metodo_de_pago varchar(255) NOT NULL                                      -- RF016
                   CHECK (metodo_de_pago IN ('efectivo','tarjeta_debito','tarjeta_credito','otro')),
    fecha          date NOT NULL DEFAULT current_date,
    descripcion    varchar(255),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_gastos_familia_fecha ON gastos (familia_id, fecha);                  -- RF017
CREATE INDEX ix_gastos_familia_cat   ON gastos (familia_id, categoria_id, fecha);    -- RF018
CREATE INDEX ix_gastos_usuario       ON gastos (usuario_id);

-- ---------------------------------------------------------------------
-- 7. PRESUPUESTO Y PRESUPUESTO_POR_CATEGORIA (RF19-RF22)
-- ---------------------------------------------------------------------
CREATE TABLE presupuesto (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id    bigint NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    creado_por    bigint NOT NULL REFERENCES usuario(id),
    monto_total   numeric(12,2) NOT NULL CHECK (monto_total > 0),
    periodo       varchar(255) NOT NULL CHECK (btrim(periodo) <> ''),   -- nombre, ej. 'Noviembre 2026'
    fecha_inicio  date NOT NULL,
    fecha_fin     date NOT NULL,
    umbral_alerta numeric(5,2) NOT NULL DEFAULT 80 CHECK (umbral_alerta BETWEEN 1 AND 100),  -- RF022
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_presupuesto_fechas CHECK (fecha_fin >= fecha_inicio),
    -- Una familia no puede tener dos presupuestos con periodos traslapados
    CONSTRAINT ex_presupuesto_traslape EXCLUDE USING gist
        (familia_id WITH =, daterange(fecha_inicio, fecha_fin, '[]') WITH &&)
);

CREATE TABLE presupuesto_por_categoria (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    presupuesto_id bigint NOT NULL REFERENCES presupuesto(id) ON DELETE CASCADE,
    categoria_id   bigint NOT NULL REFERENCES categoria_de_los_gastos(id),
    monto_asignado numeric(12,2) NOT NULL CHECK (monto_asignado > 0),
    UNIQUE (presupuesto_id, categoria_id)
);

-- ---------------------------------------------------------------------
-- 8. META_DE_AHORRO Y APORTACION (RF23-RF26)
-- ---------------------------------------------------------------------
CREATE TABLE meta_de_ahorro (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id   bigint NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    usuario_id   bigint REFERENCES usuario(id),          -- NULL = meta de toda la familia
    creada_por   bigint NOT NULL REFERENCES usuario(id),
    nombre       varchar(255) NOT NULL CHECK (btrim(nombre) <> ''),
    descripcion  varchar(300),                           -- RF023 / RF026: para que se usara
    objetivo     numeric(12,2) NOT NULL CHECK (objetivo > 0),
    actual       numeric(12,2) NOT NULL DEFAULT 0 CHECK (actual >= 0),
    fecha_limite date,
    estado       varchar(20) NOT NULL DEFAULT 'activa'
                 CHECK (estado IN ('activa','cumplida','cancelada')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_meta_familia ON meta_de_ahorro (familia_id);

CREATE TABLE aportacion (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meta_de_ahorro_id bigint NOT NULL REFERENCES meta_de_ahorro(id) ON DELETE CASCADE,
    usuario_id        bigint NOT NULL REFERENCES usuario(id),
    monto             numeric(12,2) NOT NULL CHECK (monto > 0),
    fecha             date NOT NULL DEFAULT current_date
);
CREATE INDEX ix_aportacion_meta ON aportacion (meta_de_ahorro_id);

-- ---------------------------------------------------------------------
-- 9. NOTIFICACION Y RECORDATORIO (RF32-RF36)
-- ---------------------------------------------------------------------
CREATE TABLE notificacion (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id  bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    tipo        varchar(255) NOT NULL
                CHECK (tipo IN ('corte','limite_pago','gasto_fijo','presupuesto','deficit')),
    mensaje     varchar(400) NOT NULL,
    fecha       timestamptz NOT NULL DEFAULT now(),
    leida_en    timestamptz,
    clave_dedup varchar(150) UNIQUE                      -- evita notificaciones repetidas
);
CREATE INDEX ix_notificacion_usuario ON notificacion (usuario_id, leida_en);

-- Recordatorio = aviso programado; cuando llega fecha_aviso se convierte en notificacion
CREATE TABLE recordatorio (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id  bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    tipo        varchar(255) NOT NULL CHECK (tipo IN ('corte','limite_pago','gasto_fijo')),
    fecha       date NOT NULL,                           -- fecha del evento (corte, pago...)
    mensaje     varchar(300) NOT NULL,
    fecha_aviso timestamptz NOT NULL,                    -- RNF17: cuando debe avisarse
    notificado  boolean NOT NULL DEFAULT false,
    clave       varchar(150) NOT NULL UNIQUE             -- evita recordatorios repetidos
);
-- RNF17: el scheduler consulta lo pendiente
CREATE INDEX ix_recordatorio_pendientes ON recordatorio (fecha_aviso) WHERE NOT notificado;
CREATE INDEX ix_recordatorio_usuario    ON recordatorio (usuario_id);

-- ---------------------------------------------------------------------
-- 10. RESUMEN_FINANCIERO Y REPORTE (RF27-RF31, RF41-RF43)
-- ---------------------------------------------------------------------
CREATE TABLE resumen_financiero (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id       bigint NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    periodo          varchar(255) NOT NULL,
    fecha_inicio     date NOT NULL,
    fecha_fin        date NOT NULL,
    total_de_ingresos numeric(12,2) NOT NULL DEFAULT 0,
    total_de_gastos   numeric(12,2) NOT NULL DEFAULT 0,
    balance          numeric(12,2) GENERATED ALWAYS AS (total_de_ingresos - total_de_gastos) STORED,   -- RF028
    hay_deficit      boolean GENERATED ALWAYS AS (total_de_gastos > total_de_ingresos) STORED,         -- RF036
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_resumen_fechas CHECK (fecha_fin >= fecha_inicio),
    UNIQUE (familia_id, fecha_inicio, fecha_fin)
);

CREATE TABLE reporte (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia_id   bigint NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
    generado_por bigint REFERENCES usuario(id) ON DELETE SET NULL,
    tipo         varchar(255) NOT NULL
                 CHECK (tipo IN ('ingresos_egresos','gastos_por_categoria','financiero_familiar')),
    periodo      varchar(255) NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_fin    date NOT NULL,
    contenido    jsonb NOT NULL DEFAULT '{}',             -- resultado ya calculado del reporte
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_reporte_fechas CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX ix_reporte_familia ON reporte (familia_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 11. DOCUMENTACION DE TABLAS (RNF28)
-- ---------------------------------------------------------------------
COMMENT ON TABLE familia                  IS 'Familia (grupo) que comparte las finanzas. RF02';
COMMENT ON TABLE usuario                  IS 'Personas registradas; pertenecen a una familia con un rol. RF01, RF05';
COMMENT ON TABLE rolfamiliar              IS 'Roles y su lista de permisos (separados por coma). RF038, RF039';
COMMENT ON TABLE invitacion               IS 'Invitaciones a la familia, caducan a las 48 h y se usan una vez. RF03, RF04, RNF06';
COMMENT ON TABLE configuracion_financiera IS 'Perfil financiero del usuario: ingreso, metodos de pago, corte y gastos fijos. RF05-RF08';
COMMENT ON TABLE ingresos                 IS 'Ingresos registrados por los usuarios. RF09-RF12';
COMMENT ON TABLE gastos                   IS 'Gastos registrados con categoria y metodo de pago. RF13-RF18';
COMMENT ON TABLE categoria_de_los_gastos  IS 'Categorias de gasto (globales o propias de una familia). RF015';
COMMENT ON TABLE presupuesto              IS 'Presupuesto de la familia para un periodo. RF019';
COMMENT ON TABLE presupuesto_por_categoria IS 'Monto asignado a cada categoria dentro de un presupuesto. RF020';
COMMENT ON TABLE meta_de_ahorro           IS 'Metas de ahorro familiares o individuales. RF023, RF026';
COMMENT ON TABLE aportacion               IS 'Aportaciones de los integrantes a una meta. RF024';
COMMENT ON TABLE notificacion             IS 'Avisos entregados al usuario (corte, pago, presupuesto, deficit). RF032-RF036';
COMMENT ON TABLE recordatorio             IS 'Avisos programados que luego se vuelven notificaciones. RF032-RF034, RNF17';
COMMENT ON TABLE resumen_financiero       IS 'Totales de ingresos, gastos y balance de un periodo. RF027, RF028';
COMMENT ON TABLE reporte                  IS 'Reportes generados y guardados. RF041-RF043';

-- =====================================================================
-- 12. TRIGGERS GENERICOS Y FUNCIONES AUXILIARES
-- =====================================================================
CREATE FUNCTION tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER trg_upd_usuario  BEFORE UPDATE ON usuario                  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER trg_upd_ingresos BEFORE UPDATE ON ingresos                 FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER trg_upd_gastos   BEFORE UPDATE ON gastos                   FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER trg_upd_meta     BEFORE UPDATE ON meta_de_ahorro           FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER trg_upd_config   BEFORE UPDATE ON configuracion_financiera FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- Dia del mes -> proxima fecha >= p_desde (dia 31 en febrero = 28/29)
CREATE FUNCTION fn_proxima_fecha(p_dia int, p_desde date DEFAULT current_date) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_mes date := date_trunc('month', p_desde)::date;
    v_fecha date;
BEGIN
    v_fecha := v_mes + (LEAST(p_dia, EXTRACT(day FROM (v_mes + interval '1 month - 1 day'))::int) - 1);
    IF v_fecha < p_desde THEN
        v_mes := (v_mes + interval '1 month')::date;
        v_fecha := v_mes + (LEAST(p_dia, EXTRACT(day FROM (v_mes + interval '1 month - 1 day'))::int) - 1);
    END IF;
    RETURN v_fecha;
END $$;

-- RF04: al guardar la configuracion el perfil queda completo
CREATE FUNCTION tg_perfil_completo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE usuario SET perfil_completo = true WHERE id = NEW.usuario_id AND NOT perfil_completo;
    RETURN NULL;
END $$;
CREATE TRIGGER trg_perfil_completo AFTER INSERT ON configuracion_financiera
    FOR EACH ROW EXECUTE FUNCTION tg_perfil_completo();

-- ---------------------------------------------------------------------
-- 12.1 Permisos (RNF03, RF05, RF038, RF039)
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_tiene_permiso(p_usuario bigint, p_clave text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((
        SELECT CASE
            WHEN u.familia_id IS NULL OR NOT u.activo THEN false
            -- RF05: sin sueldo no se pueden registrar ni editar ingresos
            WHEN p_clave IN ('ingresos.registrar','ingresos.editar') AND NOT u.recibe_sueldo THEN false
            ELSE p_clave = ANY (string_to_array(r.permisos, ','))
        END
        FROM usuario u JOIN rolfamiliar r ON r.id = u.rol_id
        WHERE u.id = p_usuario), false)
$$;

-- Exige un permiso (clave en TG_ARGV[0]) al usuario que inserta
CREATE FUNCTION tg_exigir_permiso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT fn_tiene_permiso(NEW.usuario_id, TG_ARGV[0]) THEN
        RAISE EXCEPTION 'El usuario % no tiene el permiso "%"', NEW.usuario_id, TG_ARGV[0]
              USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_perm_ingresos BEFORE INSERT ON ingresos
    FOR EACH ROW EXECUTE FUNCTION tg_exigir_permiso('ingresos.registrar');
CREATE TRIGGER trg_perm_gastos BEFORE INSERT ON gastos
    FOR EACH ROW EXECUTE FUNCTION tg_exigir_permiso('gastos.registrar');

-- RNF04: el usuario debe pertenecer a la familia del registro
CREATE FUNCTION tg_validar_miembro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT'
       OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
       OR NEW.familia_id IS DISTINCT FROM OLD.familia_id THEN
        IF NOT EXISTS (SELECT 1 FROM usuario
                        WHERE id = NEW.usuario_id AND familia_id = NEW.familia_id AND activo) THEN
            RAISE EXCEPTION 'El usuario % no pertenece a la familia %', NEW.usuario_id, NEW.familia_id;
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_miembro_ingresos BEFORE INSERT OR UPDATE ON ingresos
    FOR EACH ROW EXECUTE FUNCTION tg_validar_miembro();
CREATE TRIGGER trg_miembro_gastos BEFORE INSERT OR UPDATE ON gastos
    FOR EACH ROW EXECUTE FUNCTION tg_validar_miembro();

-- La categoria del gasto debe ser global o de la misma familia
CREATE FUNCTION tg_validar_categoria() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM categoria_de_los_gastos c
                    WHERE c.id = NEW.categoria_id AND c.activa
                      AND (c.familia_id IS NULL OR c.familia_id = NEW.familia_id)) THEN
        RAISE EXCEPTION 'Categoria % no valida para la familia %', NEW.categoria_id, NEW.familia_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_cat_gastos BEFORE INSERT OR UPDATE OF categoria_id ON gastos
    FOR EACH ROW EXECUTE FUNCTION tg_validar_categoria();

-- ---------------------------------------------------------------------
-- 12.2 Presupuesto: la suma por categoria no puede exceder el total
-- ---------------------------------------------------------------------
CREATE FUNCTION tg_presupuesto_cat() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_total numeric; v_fam bigint; v_suma numeric;
BEGIN
    SELECT monto_total, familia_id INTO v_total, v_fam FROM presupuesto WHERE id = NEW.presupuesto_id;
    IF NOT EXISTS (SELECT 1 FROM categoria_de_los_gastos c WHERE c.id = NEW.categoria_id AND c.activa
                     AND (c.familia_id IS NULL OR c.familia_id = v_fam)) THEN
        RAISE EXCEPTION 'Categoria % no valida para esta familia', NEW.categoria_id;
    END IF;
    SELECT COALESCE(sum(monto_asignado),0) INTO v_suma
      FROM presupuesto_por_categoria WHERE presupuesto_id = NEW.presupuesto_id;
    IF v_suma > v_total THEN
        RAISE EXCEPTION 'La suma por categoria (%) excede el presupuesto total (%)', v_suma, v_total;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_ppto_cat AFTER INSERT OR UPDATE ON presupuesto_por_categoria
    FOR EACH ROW EXECUTE FUNCTION tg_presupuesto_cat();

CREATE FUNCTION tg_presupuesto_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_suma numeric;
BEGIN
    SELECT COALESCE(sum(monto_asignado),0) INTO v_suma
      FROM presupuesto_por_categoria WHERE presupuesto_id = NEW.id;
    IF NEW.monto_total < v_suma THEN
        RAISE EXCEPTION 'El total (%) no puede ser menor a lo asignado por categoria (%)',
                        NEW.monto_total, v_suma;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_ppto_total BEFORE UPDATE OF monto_total ON presupuesto
    FOR EACH ROW EXECUTE FUNCTION tg_presupuesto_total();

-- ---------------------------------------------------------------------
-- 12.3 Metas de ahorro (RNF15: todo en la misma transaccion)
-- ---------------------------------------------------------------------
CREATE FUNCTION tg_aportacion_antes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m meta_de_ahorro%ROWTYPE;
BEGIN
    SELECT * INTO m FROM meta_de_ahorro WHERE id = NEW.meta_de_ahorro_id FOR UPDATE;
    IF m.estado = 'cancelada' THEN
        RAISE EXCEPTION 'La meta % esta cancelada y no admite aportaciones', m.id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = NEW.usuario_id
                    AND familia_id = m.familia_id AND activo) THEN
        RAISE EXCEPTION 'El usuario % no pertenece a la familia de la meta', NEW.usuario_id;
    END IF;
    IF NOT fn_tiene_permiso(NEW.usuario_id, 'metas.aportar') THEN
        RAISE EXCEPTION 'El usuario % no puede aportar a metas', NEW.usuario_id USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_aport_antes BEFORE INSERT ON aportacion
    FOR EACH ROW EXECUTE FUNCTION tg_aportacion_antes();

-- Mantiene meta_de_ahorro.actual = suma de aportaciones
CREATE FUNCTION tg_aportacion_despues() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_meta bigint := COALESCE(NEW.meta_de_ahorro_id, OLD.meta_de_ahorro_id);
BEGIN
    UPDATE meta_de_ahorro
       SET actual = (SELECT COALESCE(sum(monto),0) FROM aportacion WHERE meta_de_ahorro_id = v_meta)
     WHERE id = v_meta;
    RETURN NULL;
END $$;
CREATE TRIGGER trg_aport_despues AFTER INSERT OR UPDATE OR DELETE ON aportacion
    FOR EACH ROW EXECUTE FUNCTION tg_aportacion_despues();

-- El estado se recalcula solo (cumplida / activa) salvo que este cancelada
CREATE FUNCTION tg_meta_estado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado <> 'cancelada' THEN
        NEW.estado := CASE WHEN NEW.actual >= NEW.objetivo THEN 'cumplida' ELSE 'activa' END;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_meta_estado BEFORE UPDATE ON meta_de_ahorro
    FOR EACH ROW EXECUTE FUNCTION tg_meta_estado();

-- La meta individual debe ser de un miembro de la familia
CREATE FUNCTION tg_meta_validar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.usuario_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM usuario WHERE id = NEW.usuario_id AND familia_id = NEW.familia_id) THEN
        RAISE EXCEPTION 'El usuario % no pertenece a la familia %', NEW.usuario_id, NEW.familia_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_meta_validar BEFORE INSERT OR UPDATE OF usuario_id, familia_id ON meta_de_ahorro
    FOR EACH ROW EXECUTE FUNCTION tg_meta_validar();

-- ---------------------------------------------------------------------
-- 12.4 Proteccion del ultimo administrador (RF037-RF040)
-- ---------------------------------------------------------------------
CREATE FUNCTION tg_proteger_ultimo_admin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_admin smallint;
BEGIN
    SELECT id INTO v_admin FROM rolfamiliar WHERE nombre = 'administrador' AND familia_id IS NULL;
    IF OLD.familia_id IS NOT NULL AND OLD.rol_id = v_admin
       AND (NEW.familia_id IS DISTINCT FROM OLD.familia_id OR NEW.rol_id IS DISTINCT FROM OLD.rol_id) THEN
        IF NOT EXISTS (SELECT 1 FROM usuario
                        WHERE familia_id = OLD.familia_id AND rol_id = v_admin
                          AND id <> OLD.id AND activo) THEN
            RAISE EXCEPTION 'La familia debe conservar al menos un administrador';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_ultimo_admin BEFORE UPDATE OF familia_id, rol_id ON usuario
    FOR EACH ROW EXECUTE FUNCTION tg_proteger_ultimo_admin();

-- =====================================================================
-- 13. FUNCIONES DE NEGOCIO
-- =====================================================================

-- RF02: crear familia; quien la crea queda como administrador
CREATE FUNCTION fn_crear_familia(p_usuario bigint, p_nombre text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_fam bigint; v_actual bigint;
BEGIN
    SELECT familia_id INTO v_actual FROM usuario WHERE id = p_usuario AND activo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe o esta inactivo', p_usuario; END IF;
    IF v_actual IS NOT NULL THEN RAISE EXCEPTION 'El usuario ya pertenece a una familia'; END IF;

    INSERT INTO familia (nombre, creada_por) VALUES (p_nombre, p_usuario) RETURNING id INTO v_fam;
    UPDATE usuario SET familia_id = v_fam,
                       rol_id = (SELECT id FROM rolfamiliar WHERE nombre = 'administrador' AND familia_id IS NULL)
     WHERE id = p_usuario;
    RETURN v_fam;
END $$;

-- RF03 / RNF06: genera invitacion; devuelve el codigo en claro UNA sola vez
CREATE FUNCTION fn_crear_invitacion(p_admin bigint, p_rol smallint,
                                    p_email text DEFAULT NULL, p_horas int DEFAULT 48)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_fam bigint; v_codigo text;
BEGIN
    IF NOT fn_tiene_permiso(p_admin, 'familia.invitar') THEN
        RAISE EXCEPTION 'No tienes permiso para invitar' USING ERRCODE = '42501';
    END IF;
    SELECT familia_id INTO v_fam FROM usuario WHERE id = p_admin;
    IF NOT EXISTS (SELECT 1 FROM rolfamiliar WHERE id = p_rol AND (familia_id IS NULL OR familia_id = v_fam)) THEN
        RAISE EXCEPTION 'El rol % no es valido para esta familia', p_rol;
    END IF;
    v_codigo := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO invitacion (familia_id, invitado_por, email_invitado, rol_id, codigo_hash, fecha_expiracion)
    VALUES (v_fam, p_admin, lower(p_email), p_rol,
            sha256(convert_to(v_codigo, 'UTF8')), now() + make_interval(hours => p_horas));
    RETURN v_codigo;
END $$;

-- RF04 / RNF06: canjear invitacion (un solo uso, no vencida)
-- SECURITY DEFINER: quien canjea todavia no tiene familia, por eso no puede pasar el RLS
CREATE FUNCTION fn_usar_invitacion(p_codigo text, p_usuario bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i invitacion%ROWTYPE; u usuario%ROWTYPE;
BEGIN
    SELECT * INTO i FROM invitacion
     WHERE codigo_hash = sha256(convert_to(p_codigo, 'UTF8')) FOR UPDATE;
    IF NOT FOUND                  THEN RAISE EXCEPTION 'Invitacion invalida'; END IF;
    IF i.estado = 'cancelada'     THEN RAISE EXCEPTION 'La invitacion fue cancelada'; END IF;
    IF i.estado = 'aceptada'      THEN RAISE EXCEPTION 'La invitacion ya fue utilizada'; END IF;
    IF i.fecha_expiracion < now() THEN RAISE EXCEPTION 'La invitacion expiro'; END IF;

    SELECT * INTO u FROM usuario WHERE id = p_usuario AND activo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no valido'; END IF;
    IF u.familia_id IS NOT NULL THEN RAISE EXCEPTION 'El usuario ya pertenece a una familia'; END IF;
    IF i.email_invitado IS NOT NULL AND i.email_invitado <> lower(u.email) THEN
        RAISE EXCEPTION 'Esta invitacion es para otro correo';
    END IF;

    UPDATE usuario SET familia_id = i.familia_id, rol_id = i.rol_id WHERE id = p_usuario;
    UPDATE invitacion SET estado = 'aceptada', fecha_uso = now(), usuario_id = p_usuario WHERE id = i.id;
    RETURN i.familia_id;
END $$;

-- Marca como expiradas las invitaciones vencidas (correr con el scheduler)
CREATE FUNCTION fn_expirar_invitaciones() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    UPDATE invitacion SET estado = 'expirada'
     WHERE estado = 'pendiente' AND fecha_expiracion < now();
    GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- RNF05: sesiones (el token JWT de la app lleva usuario_id + version_token)
-- Devuelve la version_token que debe ir dentro del token
CREATE FUNCTION fn_iniciar_sesion(p_usuario bigint) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
    UPDATE usuario SET ultima_actividad = now()
     WHERE id = p_usuario AND activo RETURNING version_token INTO v;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuario inactivo o inexistente'; END IF;
    RETURN v;
END $$;

-- true si la sesion sigue vigente (y renueva la actividad); false si expiro o se cerro
CREATE FUNCTION fn_validar_sesion(p_usuario bigint, p_version integer) RETURNS boolean
LANGUAGE sql AS $$
    WITH u AS (
        UPDATE usuario SET ultima_actividad = now()
         WHERE id = p_usuario AND activo AND version_token = p_version
           AND ultima_actividad > now() - interval '30 minutes'
        RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM u)
$$;

-- Cerrar sesion: el token anterior queda invalidado
CREATE FUNCTION fn_cerrar_sesion(p_usuario bigint) RETURNS void
LANGUAGE sql AS $$
    UPDATE usuario SET version_token = version_token + 1, ultima_actividad = NULL WHERE id = p_usuario
$$;

-- RF038: cambiar rol
CREATE FUNCTION fn_cambiar_rol(p_admin bigint, p_usuario bigint, p_rol smallint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_fam bigint;
BEGIN
    IF NOT fn_tiene_permiso(p_admin, 'familia.administrar') THEN
        RAISE EXCEPTION 'No tienes permiso para administrar la familia' USING ERRCODE = '42501';
    END IF;
    SELECT familia_id INTO v_fam FROM usuario WHERE id = p_admin;
    IF NOT EXISTS (SELECT 1 FROM rolfamiliar WHERE id = p_rol AND (familia_id IS NULL OR familia_id = v_fam)) THEN
        RAISE EXCEPTION 'El rol % no es valido para esta familia', p_rol;
    END IF;
    UPDATE usuario SET rol_id = p_rol WHERE id = p_usuario AND familia_id = v_fam;
    IF NOT FOUND THEN RAISE EXCEPTION 'El usuario no pertenece a tu familia'; END IF;
END $$;

-- RF039: el admin crea un rol propio de su familia con los permisos que elija
-- ejemplo de p_permisos: 'gastos.registrar,metas.aportar,reportes.ver'
CREATE FUNCTION fn_crear_rol_familiar(p_admin bigint, p_nombre text, p_permisos text) RETURNS smallint
LANGUAGE plpgsql AS $$
DECLARE v_fam bigint; v_id smallint;
BEGIN
    IF NOT fn_tiene_permiso(p_admin, 'familia.administrar') THEN
        RAISE EXCEPTION 'No tienes permiso para administrar la familia' USING ERRCODE = '42501';
    END IF;
    SELECT familia_id INTO v_fam FROM usuario WHERE id = p_admin;
    INSERT INTO rolfamiliar (familia_id, nombre, permisos) VALUES (v_fam, p_nombre, p_permisos)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- RF039: cambiar los permisos de un rol propio de la familia (los roles base no se tocan)
CREATE FUNCTION fn_definir_permisos_rol(p_admin bigint, p_rol smallint, p_permisos text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT fn_tiene_permiso(p_admin, 'familia.administrar') THEN
        RAISE EXCEPTION 'No tienes permiso para administrar la familia' USING ERRCODE = '42501';
    END IF;
    UPDATE rolfamiliar SET permisos = p_permisos
     WHERE id = p_rol AND familia_id = (SELECT familia_id FROM usuario WHERE id = p_admin);
    IF NOT FOUND THEN RAISE EXCEPTION 'Solo puedes editar roles propios de tu familia'; END IF;
END $$;

-- RNF32: anonimiza datos personales y saca al usuario de la familia
CREATE FUNCTION fn_anonimizar_usuario(p_usuario bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE meta_de_ahorro SET estado = 'cancelada'
     WHERE usuario_id = p_usuario AND estado = 'activa';

    UPDATE usuario SET
        familia_id = NULL, rol_id = NULL,
        nombre = 'Usuario eliminado',
        email = 'eliminado_' || id || '@famify.invalid',
        contrasena = '$2b$12$' || repeat('x', 53),   -- hash imposible de igualar
        recibe_sueldo = false, perfil_completo = false,
        ultima_actividad = NULL, version_token = version_token + 1,   -- cierra sesion
        activo = false, anonimizado = true
     WHERE id = p_usuario;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuario % no existe', p_usuario; END IF;

    DELETE FROM configuracion_financiera WHERE usuario_id = p_usuario;
    DELETE FROM recordatorio             WHERE usuario_id = p_usuario;
    DELETE FROM notificacion             WHERE usuario_id = p_usuario;
END $$;

-- RF040: el admin elimina a un integrante
CREATE FUNCTION fn_eliminar_integrante(p_admin bigint, p_usuario bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT fn_tiene_permiso(p_admin, 'familia.administrar') THEN
        RAISE EXCEPTION 'No tienes permiso para administrar la familia' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM usuario a JOIN usuario t ON t.familia_id = a.familia_id
                    WHERE a.id = p_admin AND t.id = p_usuario) THEN
        RAISE EXCEPTION 'El usuario no pertenece a tu familia';
    END IF;
    PERFORM fn_anonimizar_usuario(p_usuario);
END $$;

-- Baja voluntaria
CREATE FUNCTION fn_dar_de_baja(p_usuario bigint) RETURNS void
LANGUAGE sql AS $$ SELECT fn_anonimizar_usuario(p_usuario) $$;

-- ---------------------------------------------------------------------
-- 13.1 Consultas (RF12, RF17, RF18, RF27-RF31)
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_resumen_periodo(p_familia bigint, p_desde date, p_hasta date)
RETURNS TABLE (total_ingresos numeric, total_egresos numeric, balance numeric, hay_deficit boolean)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_desde > p_hasta THEN RAISE EXCEPTION 'La fecha inicial no puede ser mayor a la final'; END IF;
    RETURN QUERY
    SELECT i.t, g.t, i.t - g.t, g.t > i.t
      FROM (SELECT COALESCE(sum(monto),0) t FROM ingresos
             WHERE familia_id = p_familia AND fecha BETWEEN p_desde AND p_hasta) i,
           (SELECT COALESCE(sum(monto),0) t FROM gastos
             WHERE familia_id = p_familia AND fecha BETWEEN p_desde AND p_hasta) g;
END $$;

-- RF018 / RF029 / RF042
CREATE FUNCTION fn_gastos_por_categoria(p_familia bigint, p_desde date, p_hasta date)
RETURNS TABLE (categoria_id bigint, categoria varchar, total numeric, porcentaje numeric)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.nombre, sum(g.monto),
           round(100 * sum(g.monto) / NULLIF(sum(sum(g.monto)) OVER (), 0), 2)
      FROM gastos g JOIN categoria_de_los_gastos c ON c.id = g.categoria_id
     WHERE g.familia_id = p_familia AND g.fecha BETWEEN p_desde AND p_hasta
     GROUP BY c.id, c.nombre
     ORDER BY sum(g.monto) DESC
$$;

-- RF030: comparacion de ingresos y egresos mes por mes
CREATE FUNCTION fn_serie_mensual(p_familia bigint, p_desde date, p_hasta date)
RETURNS TABLE (mes date, ingresos numeric, egresos numeric, balance numeric)
LANGUAGE sql STABLE AS $$
    SELECT m.mes,
           COALESCE((SELECT sum(monto) FROM ingresos
                      WHERE familia_id = p_familia AND date_trunc('month', fecha) = m.mes), 0),
           COALESCE((SELECT sum(monto) FROM gastos
                      WHERE familia_id = p_familia AND date_trunc('month', fecha) = m.mes), 0),
           COALESCE((SELECT sum(monto) FROM ingresos
                      WHERE familia_id = p_familia AND date_trunc('month', fecha) = m.mes), 0)
         - COALESCE((SELECT sum(monto) FROM gastos
                      WHERE familia_id = p_familia AND date_trunc('month', fecha) = m.mes), 0)
      FROM (SELECT g::date AS mes
              FROM generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta),
                                   interval '1 month') g) m
$$;

-- RF021: presupuesto disponible
CREATE VIEW v_presupuesto_estado AS
SELECT p.id AS presupuesto_id, p.familia_id, p.periodo, p.fecha_inicio, p.fecha_fin,
       p.monto_total,
       COALESCE(g.t, 0)                                 AS gastado,
       p.monto_total - COALESCE(g.t, 0)                 AS disponible,
       round(100 * COALESCE(g.t, 0) / p.monto_total, 2) AS porcentaje_usado
  FROM presupuesto p
  LEFT JOIN LATERAL (SELECT sum(monto) t FROM gastos
                      WHERE familia_id = p.familia_id
                        AND fecha BETWEEN p.fecha_inicio AND p.fecha_fin) g ON true;

CREATE VIEW v_presupuesto_categoria_estado AS
SELECT pc.presupuesto_id, p.familia_id, c.id AS categoria_id, c.nombre AS categoria,
       pc.monto_asignado,
       COALESCE(g.t, 0)                                      AS gastado,
       pc.monto_asignado - COALESCE(g.t, 0)                  AS disponible,
       round(100 * COALESCE(g.t, 0) / pc.monto_asignado, 2)  AS porcentaje_usado
  FROM presupuesto_por_categoria pc
  JOIN presupuesto p              ON p.id = pc.presupuesto_id
  JOIN categoria_de_los_gastos c  ON c.id = pc.categoria_id
  LEFT JOIN LATERAL (SELECT sum(monto) t FROM gastos
                      WHERE familia_id = p.familia_id AND categoria_id = pc.categoria_id
                        AND fecha BETWEEN p.fecha_inicio AND p.fecha_fin) g ON true;

-- RF025 / RF031: progreso de metas
CREATE VIEW v_progreso_metas AS
SELECT id AS meta_id, familia_id, usuario_id, nombre, estado, fecha_limite,
       objetivo, actual,
       GREATEST(objetivo - actual, 0) AS faltante,
       round(LEAST(100 * actual / objetivo, 100), 2) AS porcentaje
  FROM meta_de_ahorro;

-- ---------------------------------------------------------------------
-- 13.2 Resumen financiero y reportes (RF027, RF028, RF041-RF043)
-- ---------------------------------------------------------------------
-- Calcula y guarda (o actualiza) el resumen de un periodo. Devuelve su id.
CREATE FUNCTION fn_generar_resumen(p_familia bigint, p_desde date, p_hasta date) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE r record; v_id bigint;
BEGIN
    SELECT * INTO r FROM fn_resumen_periodo(p_familia, p_desde, p_hasta);
    INSERT INTO resumen_financiero (familia_id, periodo, fecha_inicio, fecha_fin,
                                    total_de_ingresos, total_de_gastos)
    VALUES (p_familia, to_char(p_desde,'DD/MM/YYYY') || ' - ' || to_char(p_hasta,'DD/MM/YYYY'),
            p_desde, p_hasta, r.total_ingresos, r.total_egresos)
    ON CONFLICT (familia_id, fecha_inicio, fecha_fin)
    DO UPDATE SET total_de_ingresos = EXCLUDED.total_de_ingresos,
                  total_de_gastos   = EXCLUDED.total_de_gastos,
                  created_at        = now()
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- p_tipo: 'ingresos_egresos' (RF041) | 'gastos_por_categoria' (RF042) | 'financiero_familiar' (RF043)
CREATE FUNCTION fn_generar_reporte(p_usuario bigint, p_tipo text, p_desde date, p_hasta date)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_fam bigint; v_cont jsonb; v_id bigint;
BEGIN
    IF NOT fn_tiene_permiso(p_usuario, 'reportes.ver') THEN
        RAISE EXCEPTION 'No tienes permiso para generar reportes' USING ERRCODE = '42501';
    END IF;
    IF p_desde > p_hasta THEN RAISE EXCEPTION 'La fecha inicial no puede ser mayor a la final'; END IF;
    SELECT familia_id INTO v_fam FROM usuario WHERE id = p_usuario;

    IF p_tipo = 'ingresos_egresos' THEN
        v_cont := jsonb_build_object(
          'ingresos', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.fecha)
                      FROM (SELECT fecha, fuente, tipo_de_ingreso, monto FROM ingresos
                             WHERE familia_id = v_fam AND fecha BETWEEN p_desde AND p_hasta) i), '[]'),
          'gastos',   COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.fecha)
                      FROM (SELECT fecha, descripcion, metodo_de_pago, monto FROM gastos
                             WHERE familia_id = v_fam AND fecha BETWEEN p_desde AND p_hasta) g), '[]'),
          'resumen',  (SELECT to_jsonb(r) FROM fn_resumen_periodo(v_fam, p_desde, p_hasta) r));
    ELSIF p_tipo = 'gastos_por_categoria' THEN
        v_cont := jsonb_build_object(
          'categorias', COALESCE((SELECT jsonb_agg(to_jsonb(c))
                          FROM fn_gastos_por_categoria(v_fam, p_desde, p_hasta) c), '[]'));
    ELSIF p_tipo = 'financiero_familiar' THEN
        v_cont := jsonb_build_object(
          'resumen',    (SELECT to_jsonb(r) FROM fn_resumen_periodo(v_fam, p_desde, p_hasta) r),
          'categorias', COALESCE((SELECT jsonb_agg(to_jsonb(c))
                          FROM fn_gastos_por_categoria(v_fam, p_desde, p_hasta) c), '[]'),
          'metas',      COALESCE((SELECT jsonb_agg(to_jsonb(m))
                          FROM v_progreso_metas m WHERE m.familia_id = v_fam), '[]'));
    ELSE
        RAISE EXCEPTION 'Tipo de reporte no valido: %', p_tipo;
    END IF;

    INSERT INTO reporte (familia_id, generado_por, tipo, periodo, fecha_inicio, fecha_fin, contenido)
    VALUES (v_fam, p_usuario, p_tipo,
            to_char(p_desde,'DD/MM/YYYY') || ' - ' || to_char(p_hasta,'DD/MM/YYYY'),
            p_desde, p_hasta, v_cont)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 13.3 Alertas y recordatorios (RF22, RF32-RF36)
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_notificar_familia(p_familia bigint, p_tipo text, p_mensaje text, p_dedup text)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO notificacion (usuario_id, tipo, mensaje, clave_dedup)
    SELECT u.id, p_tipo, p_mensaje, p_dedup || ':' || u.id
      FROM usuario u WHERE u.familia_id = p_familia AND u.activo
    ON CONFLICT (clave_dedup) DO NOTHING
$$;

-- RF036: deficit del mes
CREATE FUNCTION fn_verificar_deficit(p_familia bigint, p_fecha date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_ini date := date_trunc('month', p_fecha)::date; v_ing numeric; v_gas numeric;
BEGIN
    SELECT COALESCE(sum(monto),0) INTO v_ing FROM ingresos
     WHERE familia_id = p_familia AND fecha BETWEEN v_ini AND (v_ini + interval '1 month - 1 day')::date;
    SELECT COALESCE(sum(monto),0) INTO v_gas FROM gastos
     WHERE familia_id = p_familia AND fecha BETWEEN v_ini AND (v_ini + interval '1 month - 1 day')::date;
    IF v_gas > v_ing THEN
        PERFORM fn_notificar_familia(p_familia, 'deficit',
            format('Deficit detectado: los gastos del mes (%s) superan a los ingresos (%s).', v_gas, v_ing),
            'deficit:' || p_familia || ':' || to_char(v_ini, 'YYYY-MM'));
    END IF;
END $$;

-- RF022 / RF035: presupuesto general y por categoria
CREATE FUNCTION fn_verificar_presupuesto(p_familia bigint, p_fecha date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT p.id, p.periodo, p.umbral_alerta, e.porcentaje_usado
               FROM presupuesto p JOIN v_presupuesto_estado e ON e.presupuesto_id = p.id
              WHERE p.familia_id = p_familia AND p_fecha BETWEEN p.fecha_inicio AND p.fecha_fin
                AND e.porcentaje_usado >= p.umbral_alerta
    LOOP
        PERFORM fn_notificar_familia(p_familia, 'presupuesto',
            format('%s: el presupuesto "%s" lleva %s%% utilizado.',
                   CASE WHEN r.porcentaje_usado >= 100 THEN 'Presupuesto superado' ELSE 'Presupuesto por agotarse' END,
                   r.periodo, r.porcentaje_usado),
            'ppto:' || r.id || ':' || CASE WHEN r.porcentaje_usado >= 100 THEN 'sup' ELSE 'cerca' END);
    END LOOP;

    FOR r IN SELECT e.presupuesto_id, e.categoria_id, e.categoria, e.porcentaje_usado, p.umbral_alerta
               FROM v_presupuesto_categoria_estado e JOIN presupuesto p ON p.id = e.presupuesto_id
              WHERE p.familia_id = p_familia AND p_fecha BETWEEN p.fecha_inicio AND p.fecha_fin
                AND e.porcentaje_usado >= p.umbral_alerta
    LOOP
        PERFORM fn_notificar_familia(p_familia, 'presupuesto',
            format('%s: la categoria "%s" lleva %s%% de su presupuesto.',
                   CASE WHEN r.porcentaje_usado >= 100 THEN 'Limite superado' ELSE 'Cerca del limite' END,
                   r.categoria, r.porcentaje_usado),
            'pcat:' || r.presupuesto_id || ':' || r.categoria_id || ':' ||
            CASE WHEN r.porcentaje_usado >= 100 THEN 'sup' ELSE 'cerca' END);
    END LOOP;
END $$;

CREATE FUNCTION tg_alertas_gasto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_verificar_presupuesto(NEW.familia_id, NEW.fecha);
    PERFORM fn_verificar_deficit(NEW.familia_id, NEW.fecha);
    RETURN NULL;
END $$;
CREATE TRIGGER trg_alertas_gasto AFTER INSERT OR UPDATE OF monto, fecha, categoria_id ON gastos
    FOR EACH ROW EXECUTE FUNCTION tg_alertas_gasto();

CREATE FUNCTION tg_alertas_ingreso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_verificar_deficit(OLD.familia_id, OLD.fecha);
    RETURN NULL;
END $$;
CREATE TRIGGER trg_alertas_ingreso AFTER UPDATE OR DELETE ON ingresos
    FOR EACH ROW EXECUTE FUNCTION tg_alertas_ingreso();

-- RF032, RF033, RF034 + RNF17: ejecutar con un scheduler (pg_cron o la app) cada <= 10 min.
--   Paso 1: programa en "recordatorio" el proximo corte, limite de pago y gastos fijos.
--   Paso 2: los que ya llegaron a su fecha_aviso se convierten en "notificacion".
-- Devuelve cuantas notificaciones nuevas se crearon.
CREATE FUNCTION fn_generar_recordatorios(p_ahora timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_hoy date := (p_ahora AT TIME ZONE 'America/Mexico_City')::date;
    n integer;
BEGIN
    -- Paso 1a: fecha de corte (aviso 3 dias antes, a las 9:00)
    INSERT INTO recordatorio (usuario_id, tipo, fecha, mensaje, fecha_aviso, clave)
    SELECT c.usuario_id, 'corte', f.fecha,
           format('Se acerca la fecha de corte de tu tarjeta de credito: %s.', to_char(f.fecha, 'DD/MM/YYYY')),
           ((f.fecha - 3)::timestamp + time '09:00') AT TIME ZONE 'America/Mexico_City',
           'corte:' || c.usuario_id || ':' || f.fecha
      FROM configuracion_financiera c
      JOIN usuario u ON u.id = c.usuario_id AND u.activo AND u.familia_id IS NOT NULL
      CROSS JOIN LATERAL (SELECT fn_proxima_fecha(c.dia_de_corte, v_hoy) AS fecha) f
     WHERE c.dia_de_corte IS NOT NULL
    ON CONFLICT (clave) DO NOTHING;

    -- Paso 1b: fecha limite de pago (se repite cada mes con el dia de fecha_limite_de_pago)
    INSERT INTO recordatorio (usuario_id, tipo, fecha, mensaje, fecha_aviso, clave)
    SELECT c.usuario_id, 'limite_pago', f.fecha,
           format('Debes pagar tu tarjeta de credito a mas tardar el %s.', to_char(f.fecha, 'DD/MM/YYYY')),
           ((f.fecha - 3)::timestamp + time '09:00') AT TIME ZONE 'America/Mexico_City',
           'limite:' || c.usuario_id || ':' || f.fecha
      FROM configuracion_financiera c
      JOIN usuario u ON u.id = c.usuario_id AND u.activo AND u.familia_id IS NOT NULL
      CROSS JOIN LATERAL (SELECT fn_proxima_fecha(EXTRACT(day FROM c.fecha_limite_de_pago)::int, v_hoy) AS fecha) f
     WHERE c.fecha_limite_de_pago IS NOT NULL
    ON CONFLICT (clave) DO NOTHING;

    -- Paso 1c: gastos fijos (RF034), cada uno con sus propios dias de aviso
    INSERT INTO recordatorio (usuario_id, tipo, fecha, mensaje, fecha_aviso, clave)
    SELECT c.usuario_id, 'gasto_fijo', f.fecha,
           format('"%s" por %s vence el %s.', gf->>'descripcion', gf->>'monto', to_char(f.fecha, 'DD/MM/YYYY')),
           ((f.fecha - COALESCE((gf->>'dias_aviso')::int, 3))::timestamp + time '09:00')
               AT TIME ZONE 'America/Mexico_City',
           'gfijo:' || c.usuario_id || ':' || md5(gf->>'descripcion') || ':' || f.fecha
      FROM configuracion_financiera c
      JOIN usuario u ON u.id = c.usuario_id AND u.activo AND u.familia_id IS NOT NULL
      CROSS JOIN LATERAL jsonb_array_elements(c.gastos_fijos) gf
      CROSS JOIN LATERAL (SELECT fn_proxima_fecha((gf->>'dia_pago')::int, v_hoy) AS fecha) f
    ON CONFLICT (clave) DO NOTHING;

    -- Paso 2: avisar lo que ya toca
    WITH pendientes AS (
        UPDATE recordatorio SET notificado = true
         WHERE NOT notificado AND fecha_aviso <= p_ahora AND fecha >= v_hoy
        RETURNING id, usuario_id, tipo, mensaje
    ), nuevas AS (
        INSERT INTO notificacion (usuario_id, tipo, mensaje, clave_dedup)
        SELECT usuario_id, tipo, mensaje, 'rec:' || id FROM pendientes
        ON CONFLICT (clave_dedup) DO NOTHING
        RETURNING 1)
    SELECT count(*) INTO n FROM nuevas;

    -- Los vencidos que nunca se avisaron (fecha ya paso) se marcan para no acumularse
    UPDATE recordatorio SET notificado = true WHERE NOT notificado AND fecha < v_hoy;
    RETURN n;
END $$;

-- =====================================================================
-- 14. RNF04: AISLAMIENTO POR FAMILIA (Row Level Security)
--     La app debe ejecutar al inicio de cada peticion:
--         SET app.familia_id = '<id de la familia del usuario>';
--         SET app.usuario_id = '<id del usuario>';
--     y conectarse con un rol que NO sea dueno de las tablas (el dueno
--     se salta RLS). Ver seccion 16.
-- =====================================================================
CREATE FUNCTION fn_familia_actual() RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.familia_id', true), '')::bigint
$$;
CREATE FUNCTION fn_usuario_actual() RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.usuario_id', true), '')::bigint
$$;

-- Tablas con familia_id
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['ingresos','gastos','presupuesto','meta_de_ahorro',
                             'invitacion','resumen_financiero','reporte'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY pol_familia ON %I USING (familia_id = fn_familia_actual())
                        WITH CHECK (familia_id = fn_familia_actual())', t);
    END LOOP;
END $$;

ALTER TABLE categoria_de_los_gastos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_familia ON categoria_de_los_gastos
    USING (familia_id IS NULL OR familia_id = fn_familia_actual())
    WITH CHECK (familia_id = fn_familia_actual());

ALTER TABLE rolfamiliar ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_familia ON rolfamiliar
    USING (familia_id IS NULL OR familia_id = fn_familia_actual())
    WITH CHECK (familia_id = fn_familia_actual());

-- Tablas hijas: heredan el filtro de su tabla padre
ALTER TABLE presupuesto_por_categoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_familia ON presupuesto_por_categoria
    USING (EXISTS (SELECT 1 FROM presupuesto p WHERE p.id = presupuesto_id));

ALTER TABLE aportacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_familia ON aportacion
    USING (EXISTS (SELECT 1 FROM meta_de_ahorro m WHERE m.id = meta_de_ahorro_id));

-- Tablas por usuario: el propio usuario o alguien de su misma familia
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['configuracion_financiera','notificacion','recordatorio'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY pol_familia ON %I USING (
                          usuario_id = fn_usuario_actual()
                          OR EXISTS (SELECT 1 FROM usuario u WHERE u.id = usuario_id
                                      AND u.familia_id = fn_familia_actual()))', t);
    END LOOP;
END $$;

-- =====================================================================
-- 15. DATOS INICIALES (catalogos)
-- =====================================================================
-- Roles base. El integrante NO tiene gastos.ver_detalle (solo ve lo general).
INSERT INTO rolfamiliar (familia_id, nombre, permisos) VALUES
 (NULL, 'administrador',
  'ingresos.registrar,ingresos.editar,gastos.registrar,gastos.editar,gastos.ver_detalle,presupuesto.gestionar,metas.gestionar,metas.aportar,reportes.ver,familia.invitar,familia.administrar'),
 (NULL, 'integrante',
  'ingresos.registrar,ingresos.editar,gastos.registrar,gastos.editar,metas.gestionar,metas.aportar,reportes.ver');

INSERT INTO categoria_de_los_gastos (familia_id, nombre) VALUES
 (NULL,'Alimentos'),(NULL,'Transporte'),(NULL,'Educacion'),(NULL,'Servicios'),
 (NULL,'Entretenimiento'),(NULL,'Salud'),(NULL,'Hogar'),(NULL,'Otros');

COMMIT;

-- =====================================================================
-- 16. (OPCIONAL) ROL DE LA APLICACION - RNF04 / RNF08
--     Descomenta y cambia la contrasena. Con este rol si aplica RLS.
-- =====================================================================
-- CREATE ROLE famify_app LOGIN PASSWORD 'cambia_esto';
-- GRANT USAGE ON SCHEMA public TO famify_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO famify_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO famify_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO famify_app;

-- =====================================================================
-- 17. (OPCIONAL) PROGRAMAR TAREAS CADA 10 MIN (RNF17) con pg_cron
-- =====================================================================
-- SELECT cron.schedule('famify_recordatorios', '*/10 * * * *', 'SELECT fn_generar_recordatorios()');
-- SELECT cron.schedule('famify_invitaciones', '0 * * * *', 'SELECT fn_expirar_invitaciones()');
-- Respaldo diario (RNF14), desde el sistema operativo:
--   0 2 * * *  pg_dump -Fc famify > /backups/famify_$(date +\%F).dump
