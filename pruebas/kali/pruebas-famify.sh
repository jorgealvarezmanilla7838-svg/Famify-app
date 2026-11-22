#!/usr/bin/env bash
# =====================================================================================
#  Pruebas de Famify desde Kali (o cualquier Linux con bash y curl)
#  Recorre los requerimientos funcionales y de seguridad contra el servidor real por HTTPS.
#
#  Uso:
#     chmod +x pruebas-famify.sh
#     ./pruebas-famify.sh 192.168.1.71              # IP de la computadora con Famify
#     CERT=famify.crt ./pruebas-famify.sh 192.168.1.71   # validando el certificado de Famify
#
#  Requiere: curl, openssl y jq (sudo apt install jq) o python3. nmap es opcional.
#  OJO: crea usuarios, familias y movimientos de prueba. Úsalo con la base famify_pruebas.
# =====================================================================================
set -u

IP="${1:-${FAMIFY_IP:-127.0.0.1}}"
PUERTO_API="${PUERTO_API:-4000}"
PUERTO_WEB="${PUERTO_WEB:-5173}"
PUERTO_REDIRECCION="${PUERTO_REDIRECCION:-4080}"
API="https://$IP:$PUERTO_API/api"
WEB="https://$IP:$PUERTO_WEB"

# Si se tiene el certificado de Famify (server/certs/famify.crt) se valida; si no, se acepta el autofirmado
if [ -n "${CERT:-}" ] && [ -f "$CERT" ]; then TLS=(--cacert "$CERT"); MODO_TLS="validando $CERT"; else TLS=(-k); MODO_TLS="aceptando certificado autofirmado (-k)"; fi

VERDE=$'\e[32m'; ROJO=$'\e[31m'; AMARILLO=$'\e[33m'; AZUL=$'\e[36m'; NEGRITA=$'\e[1m'; FIN=$'\e[0m'
APROBADAS=0; FALLIDAS=0; FALLOS=()

seccion() { printf '\n%s== %s ==%s\n' "$AZUL$NEGRITA" "$1" "$FIN"; }
ok()   { APROBADAS=$((APROBADAS + 1)); printf '  %s✔ PASA%s  %s\n' "$VERDE" "$FIN" "$1"; }
mal()  { FALLIDAS=$((FALLIDAS + 1)); FALLOS+=("$1"); printf '  %s✘ FALLA%s %s %s\n' "$ROJO" "$FIN" "$1" "${2:+($2)}"; }
info() { printf '  %s·%s %s\n' "$AMARILLO" "$FIN" "$1"; }

# Lee un campo del JSON: campo '.familia.codigo_invitacion' "$JSON"
campo() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$2" | jq -r "$1 // empty" 2>/dev/null
  else
    local py; py=$(command -v python3 || command -v python)
    printf '%s' "$2" | "$py" -c '
import json, re, sys
try:
    v = json.load(sys.stdin)
    for parte in re.findall(r"\.([A-Za-z_0-9]+)|\[(\d+)\]", sys.argv[1]):
        v = v[parte[0]] if parte[0] else v[int(parte[1])]
    print("" if v is None else (json.dumps(v) if isinstance(v, (dict, list)) else (str(v).lower() if isinstance(v, bool) else v)))
except Exception:
    print("")' "$1"
  fi
}

# pedir METODO RUTA [JSON] [TOKEN]  ->  deja el código en $ESTADO y el cuerpo en $CUERPO
pedir() {
  local metodo=$1 ruta=$2 datos=${3:-} token=${4:-}
  local args=(-s -o /tmp/famify_cuerpo -w '%{http_code}' -X "$metodo" "${TLS[@]}" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$datos" ] && args+=(--data "$datos")
  ESTADO=$(curl "${args[@]}" "$API$ruta")
  CUERPO=$(cat /tmp/famify_cuerpo 2>/dev/null)
}

# esperar NOMBRE CODIGO_ESPERADO   (después de pedir)
esperar() {
  if [ "$ESTADO" = "$2" ]; then ok "$1 → HTTP $ESTADO"; else mal "$1" "esperaba HTTP $2, llegó $ESTADO: $(printf '%s' "$CUERPO" | head -c 160)"; fi
}

for herramienta in curl openssl; do
  command -v $herramienta >/dev/null 2>&1 || { echo "Falta $herramienta (sudo apt install $herramienta)"; exit 2; }
done
command -v jq >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || { echo 'Falta jq (sudo apt install jq)'; exit 2; }

SUFIJO="$(date +%s)$RANDOM"
CLAVE="Kali-Prueba-$RANDOM$RANDOM"
HOY=$(date +%F)
INICIO_MES=$(date +%Y-%m-01)
FIN_MES=$(date -d "$INICIO_MES +1 month -1 day" +%F 2>/dev/null || echo "$HOY")
HACE_UN_ANIO=$(date -d "$HOY -1 year +1 day" +%F 2>/dev/null || echo "$INICIO_MES")

printf '%sPruebas de Famify%s → API %s | Web %s | %s\n' "$NEGRITA" "$FIN" "$API" "$WEB" "$MODO_TLS"

# -------------------------------------------------------------------------------------
seccion 'Red: puertos abiertos'
if command -v nmap >/dev/null 2>&1; then
  nmap -Pn -p "$PUERTO_API,$PUERTO_WEB,$PUERTO_REDIRECCION" "$IP" 2>/dev/null | grep -E '^[0-9]+/tcp' | sed 's/^/  /'
else
  info 'nmap no está instalado; se omite el escaneo de puertos'
fi
pedir GET /health
esperar 'El backend responde y consulta la base de datos (/api/health)' 200

# -------------------------------------------------------------------------------------
seccion 'RNF02: comunicación segura (HTTPS/TLS)'
PROTOCOLO=$(echo | openssl s_client -connect "$IP:$PUERTO_API" 2>/dev/null | grep -m1 -oE 'TLSv1\.[0-9]')
case "$PROTOCOLO" in TLSv1.2|TLSv1.3) ok "Negocia $PROTOCOLO" ;; *) mal 'Negociar TLS 1.2 o superior' "obtuvo '$PROTOCOLO'" ;; esac
# SECLEVEL=0 hace que el cliente sí intente TLS 1.1; así el rechazo viene del servidor (alert protocol version)
if echo | openssl s_client -connect "$IP:$PUERTO_API" -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0' 2>&1 | grep -q 'alert protocol version'; then
  ok 'El servidor rechaza TLS 1.1 (alert protocol version)'
else
  mal 'Rechaza TLS 1.1'
fi
CABECERAS=$(curl -s -D - -o /dev/null "${TLS[@]}" "$API/health")
printf '%s' "$CABECERAS" | grep -qi '^strict-transport-security: max-age=31536000' && ok 'Cabecera HSTS presente' || mal 'Cabecera HSTS presente'
printf '%s' "$CABECERAS" | grep -qi '^x-frame-options: DENY' && ok 'Cabecera X-Frame-Options: DENY' || mal 'Cabecera X-Frame-Options: DENY'
printf '%s' "$CABECERAS" | grep -qi '^server-timing: app;dur=' && ok "Cabecera Server-Timing ($(printf '%s' "$CABECERAS" | grep -i '^server-timing' | tr -d '\r' | cut -d' ' -f2))" || mal 'Cabecera Server-Timing'
if curl -s -m 4 "http://$IP:$PUERTO_API/api/health" >/dev/null 2>&1 && [ "$(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://$IP:$PUERTO_API/api/health")" = "200" ]; then
  mal 'El puerto de la API no responde sin cifrar'
else
  ok 'El puerto de la API no responde por HTTP sin cifrar'
fi
REDIR=$(curl -s -m 4 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$IP:$PUERTO_REDIRECCION/api/health")
case "$REDIR" in 301\ https://*) ok "HTTP $PUERTO_REDIRECCION redirige a HTTPS ($REDIR)" ;; *) info "Redirección HTTP→HTTPS no activa en $PUERTO_REDIRECCION ($REDIR)" ;; esac

# -------------------------------------------------------------------------------------
seccion 'Frontend y conexión con el backend'
WEB_ESTADO=$(curl -s -o /tmp/famify_web -w '%{http_code}' "${TLS[@]}" "$WEB/")
[ "$WEB_ESTADO" = 200 ] && grep -q '<div id="root">' /tmp/famify_web && ok "El frontend responde en $WEB (HTML de la app)" || mal 'El frontend responde' "HTTP $WEB_ESTADO"
PROXY=$(curl -s "${TLS[@]}" "$WEB/api/health")
[ "$(campo .status "$PROXY")" = ok ] && ok 'El frontend reenvía /api al backend (misma conexión que usa el navegador)' || mal 'Proxy del frontend hacia el backend' "$PROXY"

# -------------------------------------------------------------------------------------
seccion 'RF01 / RNF01 / RNF31: registro e inicio de sesión'
CORREO_ADMIN="admin.$SUFIJO@kali.test"
pedir POST /auth/register "{\"nombre\":\"Admin Kali\",\"email\":\"$CORREO_ADMIN\",\"password\":\"$CLAVE\",\"acepta_aviso\":false}"
esperar 'Registro sin aceptar el aviso de privacidad se rechaza (RNF31)' 400
pedir POST /auth/register '{"nombre":"","email":"no-es-correo","password":"123","acepta_aviso":true}'
esperar 'Registro con datos inválidos indica cada campo (RNF21)' 400
info "Errores: $(campo .error "$CUERPO")"
pedir POST /auth/register "{\"nombre\":\"Admin Kali\",\"email\":\"$CORREO_ADMIN\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}"
esperar 'Registro del administrador' 201
TOKEN_ADMIN=$(campo .token "$CUERPO")
pedir POST /auth/register "{\"nombre\":\"Otra vez\",\"email\":\"$CORREO_ADMIN\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}"
esperar 'Correo duplicado se rechaza' 409
pedir POST /auth/login "{\"email\":\"$CORREO_ADMIN\",\"password\":\"incorrecta\"}"
esperar 'Login con contraseña incorrecta' 400
pedir POST /auth/login "{\"email\":\"$CORREO_ADMIN\",\"password\":\"$CLAVE\"}"
esperar 'Login correcto' 200
TOKEN_ADMIN=$(campo .token "$CUERPO")
printf '%s' "$CUERPO" | grep -q 'contrasena\|\$2[aby]\$' && mal 'La respuesta no expone el hash de la contraseña (RNF01)' || ok 'La respuesta no expone el hash de la contraseña (RNF01)'

# -------------------------------------------------------------------------------------
seccion 'RF02 / RF03: familia e invitaciones'
pedir POST /auth/crear-familia '{"nombre_familia":"Familia Kali"}' "$TOKEN_ADMIN"
esperar 'Crear familia (RF02)' 200
pedir POST /auth/generar-invitacion '{"rol_id":9}' "$TOKEN_ADMIN"
esperar 'Invitación con rol inválido se rechaza' 400
pedir POST /auth/generar-invitacion '{"rol_id":2}' "$TOKEN_ADMIN"
esperar 'Generar invitación como integrante (RF03)' 200
CODIGO=$(campo .codigo_invitacion "$CUERPO")
info "Código: $CODIGO — $(campo .message "$CUERPO")"

# -------------------------------------------------------------------------------------
seccion 'RF05–RF08: configuración de usuario'
pedir GET /configuracion/catalogos '' "$TOKEN_ADMIN"
esperar 'Catálogos de métodos de pago y categorías (RF06)' 200
CATEGORIA=$(campo '.categorias[0].id' "$CUERPO"); CATEGORIA2=$(campo '.categorias[1].id' "$CUERPO")
pedir POST /configuracion/completar '{"recibe_sueldo":true,"ingreso_principal":18000,"dias_ingreso":[15,30],"metodos_pago":[{"metodo_pago_id":3,"alias":"4152 3133 0000 1234","dia_corte":5,"dia_limite_pago":25}],"gastos_fijos":[]}' "$TOKEN_ADMIN"
esperar 'No permite guardar el número de tarjeta (RNF07)' 400
pedir POST /configuracion/completar "{\"recibe_sueldo\":true,\"ingreso_principal\":18000,\"tiene_ingresos_secundarios\":false,\"dias_ingreso\":[15,30],\"metodos_pago\":[{\"metodo_pago_id\":1,\"alias\":\"Efectivo\"},{\"metodo_pago_id\":3,\"alias\":\"Visa\",\"dia_corte\":5,\"dia_limite_pago\":25}],\"gastos_fijos\":[{\"descripcion\":\"Colegiatura\",\"categoria_id\":$CATEGORIA,\"monto\":3500,\"dia_pago\":10}]}" "$TOKEN_ADMIN"
esperar 'Guardar sueldo, métodos de pago, tarjeta de crédito y gastos fijos (RF05–RF08)' 201
pedir GET /configuracion '' "$TOKEN_ADMIN"
esperar 'Consultar la configuración guardada' 200

# -------------------------------------------------------------------------------------
seccion 'RF09–RF012: ingresos'
pedir POST /ingresos '{"monto":18000,"fuente":"Trabajo","tipo":"salario","periodicidad":"mensual"}' "$TOKEN_ADMIN"
esperar 'Registrar ingreso clasificado como salario (RF09, RF011)' 201
ID_INGRESO=$(campo .ingreso.id "$CUERPO")
pedir POST /ingresos '{"monto":2000,"fuente":"Tanda de la oficina","tipo":"tanda","periodicidad":"unico"}' "$TOKEN_ADMIN"
esperar 'Registrar ingreso de tanda (RF011)' 201
pedir PUT "/ingresos/$ID_INGRESO" '{"monto":16500,"fuente":"Trabajo","tipo":"salario","periodicidad":"mensual"}' "$TOKEN_ADMIN"
esperar 'Editar ingreso (RF010)' 200
pedir GET "/ingresos?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Consultar ingresos del mes (RF012)' 200

# -------------------------------------------------------------------------------------
seccion 'RF013–RF018: gastos'
pedir POST /gastos "{\"monto\":-5,\"categoria_id\":$CATEGORIA,\"metodo_pago_id\":1}" "$TOKEN_ADMIN"
esperar 'Monto negativo se rechaza con mensaje claro (RNF21)' 400
info "$(campo .error "$CUERPO")"
pedir POST /gastos "{\"monto\":1250.50,\"categoria_id\":$CATEGORIA,\"metodo_pago_id\":2,\"descripcion\":\"Súper\"}" "$TOKEN_ADMIN"
esperar 'Registrar gasto con categoría y método de pago (RF013, RF015, RF016)' 201
ID_GASTO=$(campo .gasto.id "$CUERPO")
pedir POST /gastos "{\"monto\":300,\"categoria_id\":$CATEGORIA2,\"metodo_pago_id\":3,\"descripcion\":\"Gasolina\"}" "$TOKEN_ADMIN"
esperar 'Registrar gasto con tarjeta de crédito' 201
pedir PUT "/gastos/$ID_GASTO" "{\"monto\":1300,\"categoria_id\":$CATEGORIA,\"metodo_pago_id\":1,\"descripcion\":\"Súper corregido\"}" "$TOKEN_ADMIN"
esperar 'Editar gasto (RF014)' 200
pedir GET "/gastos?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Consultar gastos por periodo (RF017)' 200
pedir GET "/gastos/por-categoria?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Consultar gastos por categoría (RF018)' 200
pedir GET '/gastos?desde=2020-01-01&hasta=2026-01-01' '' "$TOKEN_ADMIN"
esperar 'Periodo mayor a un año se rechaza' 400

# -------------------------------------------------------------------------------------
seccion 'RF019–RF022: presupuesto'
pedir POST /presupuestos "{\"nombre\":\"Kali\",\"monto_total\":1000,\"desde\":\"$INICIO_MES\",\"hasta\":\"$FIN_MES\",\"categorias\":[{\"categoria_id\":$CATEGORIA,\"monto\":5000}]}" "$TOKEN_ADMIN"
esperar 'Categorías que superan el total se rechazan (RF020)' 400
pedir POST /presupuestos "{\"nombre\":\"Presupuesto Kali\",\"monto_total\":2000,\"desde\":\"$INICIO_MES\",\"hasta\":\"$FIN_MES\",\"categorias\":[{\"categoria_id\":$CATEGORIA,\"monto\":1400}]}" "$TOKEN_ADMIN"
esperar 'Crear presupuesto con asignación por categoría (RF019, RF020)' 201
pedir GET /presupuestos '' "$TOKEN_ADMIN"
esperar 'Consultar presupuesto disponible (RF021)' 200
info "Disponible: $(campo '.presupuestos[0].disponible' "$CUERPO") | estado general: $(campo '.presupuestos[0].estado' "$CUERPO") | categoría: $(campo '.presupuestos[0].categorias[0].estado' "$CUERPO")"
[ "$(campo '.presupuestos[0].categorias[0].estado' "$CUERPO")" = cerca ] && ok 'Alerta "cerca del límite" al pasar el 80 % (RF022)' || mal 'Alerta de límite de presupuesto (RF022)'

# -------------------------------------------------------------------------------------
seccion 'RF023–RF026 / RNF15: metas de ahorro'
pedir POST /metas '{"nombre":"Vacaciones","descripcion":"Playa","monto_objetivo":10000,"alcance":"familia"}' "$TOKEN_ADMIN"
esperar 'Crear meta familiar (RF023)' 201
ID_META=$(campo .id "$CUERPO")
pedir POST "/metas/$ID_META/aportaciones" '{"monto":2500}' "$TOKEN_ADMIN"
esperar 'Registrar aportación (RF024, en transacción RNF15)' 201
pedir PUT "/metas/$ID_META" '{"nombre":"Vacaciones","descripcion":"Playa en familia","monto_objetivo":12500}' "$TOKEN_ADMIN"
esperar 'Modificar meta (RF026)' 200
pedir GET /metas '' "$TOKEN_ADMIN"
esperar 'Consultar progreso (RF025)' 200
[ "$(campo '.metas[0].porcentaje' "$CUERPO")" = 20 ] && ok 'Progreso calculado: 2,500 de 12,500 = 20 %' || mal 'Progreso de la meta' "porcentaje $(campo '.metas[0].porcentaje' "$CUERPO")"

# -------------------------------------------------------------------------------------
seccion 'RF027–RF031 / RF041–RF043: resumen y reportes'
pedir GET "/reportes/resumen?desde=$HACE_UN_ANIO&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Resumen financiero de un año (RF027–RF031)' 200
info "Ingresos $(campo .totales.familia.ingresos "$CUERPO") | Gastos $(campo .totales.familia.gastos "$CUERPO") | Balance $(campo .totales.familia.balance "$CUERPO") | Déficit $(campo .totales.familia.deficit "$CUERPO")"
pedir GET "/reportes/ingresos-egresos?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Reporte de ingresos y egresos (RF041)' 200
pedir GET "/reportes/categorias?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Reporte de gastos por categoría (RF042)' 200
pedir GET "/reportes/familiar?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
esperar 'Reporte financiero familiar (RF043)' 200

# -------------------------------------------------------------------------------------
seccion 'RF032–RF036: notificaciones'
pedir GET /notificaciones '' "$TOKEN_ADMIN"
esperar 'Consultar notificaciones' 200
info "Sin leer: $(campo .sin_leer "$CUERPO")"
pedir POST /notificaciones/leer-todas '' "$TOKEN_ADMIN"
esperar 'Marcar todas como leídas' 200

# -------------------------------------------------------------------------------------
seccion 'RF04 / RNF06: unirse por invitación'
CORREO_INT="integrante.$SUFIJO@kali.test"
pedir POST /auth/register "{\"nombre\":\"Integrante Kali\",\"email\":\"$CORREO_INT\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}"
esperar 'Registro del integrante' 201
TOKEN_INT=$(campo .token "$CUERPO"); ID_INT=$(campo .user.id "$CUERPO")
pedir POST /auth/unirse-familia "{\"codigo_invitacion\":\"$CODIGO\"}" "$TOKEN_INT"
esperar 'Unirse a la familia con el código (RF04)' 200
CORREO_INTRUSO="intruso.$SUFIJO@kali.test"
pedir POST /auth/register "{\"nombre\":\"Intruso Kali\",\"email\":\"$CORREO_INTRUSO\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}"
TOKEN_INTRUSO=$(campo .token "$CUERPO")
pedir POST /auth/unirse-familia "{\"codigo_invitacion\":\"$CODIGO\"}" "$TOKEN_INTRUSO"
esperar 'El mismo código no se puede usar dos veces (RNF06)' 400
info "$(campo .error "$CUERPO")"
pedir POST /auth/unirse-familia '{"codigo_invitacion":"CODIGO-FALSO"}' "$TOKEN_INTRUSO"
esperar 'Un código inexistente se rechaza' 400

# -------------------------------------------------------------------------------------
seccion 'RNF03 / RNF04: control de acceso y aislamiento por familia'
pedir GET /administracion/integrantes '' "$TOKEN_INT"
esperar 'Un integrante no puede administrar la familia (RNF03)' 403
pedir DELETE "/gastos/$ID_GASTO" '' "$TOKEN_INT"
case "$ESTADO" in 403) ok "Un integrante no puede borrar el gasto del administrador → HTTP 403" ;; *) mal 'Integrante borra gasto ajeno' "HTTP $ESTADO" ;; esac
pedir POST /auth/crear-familia '{"nombre_familia":"Familia Intrusa"}' "$TOKEN_INTRUSO"
pedir GET "/gastos?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_INTRUSO"
[ "$(campo '.gastos[0].id' "$CUERPO")" = "" ] && ok 'Otra familia no ve los gastos de esta familia (RNF04)' || mal 'Aislamiento de gastos entre familias'
pedir DELETE "/gastos/$ID_GASTO" '' "$TOKEN_INTRUSO"
esperar 'Otra familia no puede borrar un gasto ajeno aunque conozca su id (RNF04)' 404
pedir GET '/gastos' ''
esperar 'Sin token no hay acceso' 401
pedir GET '/gastos' '' 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwidiI6MX0.firma-falsa'
esperar 'Token falsificado se rechaza' 401

# -------------------------------------------------------------------------------------
seccion 'RNF08: inyección SQL y XSS'
pedir POST /auth/login "{\"email\":\"' OR '1'='1' --\",\"password\":\"' OR '1'='1\"}"
esperar "Inyección SQL en el login no entra" 400
pedir DELETE "/gastos/1%20OR%201=1" '' "$TOKEN_ADMIN"
esperar 'Inyección SQL en un id se rechaza' 400
pedir POST /gastos "{\"monto\":10,\"categoria_id\":$CATEGORIA,\"metodo_pago_id\":1,\"descripcion\":\"<script>alert(1)</script>Prueba XSS\"}" "$TOKEN_ADMIN"
pedir GET "/gastos?desde=$INICIO_MES&hasta=$HOY" '' "$TOKEN_ADMIN"
printf '%s' "$CUERPO" | grep -q '<script>' && mal 'Las etiquetas HTML se eliminan (XSS)' || ok 'Las etiquetas <script> se eliminan antes de guardar (XSS)'
pedir POST /gastos '{"monto":' "$TOKEN_ADMIN"
esperar 'JSON mal formado da un error claro (RNF16)' 400
printf '%s' "$CUERPO" | grep -qiE 'stack|SyntaxError|at .*\.ts' && mal 'No expone detalles técnicos (RNF16)' || ok 'No expone detalles técnicos (RNF16)'

# -------------------------------------------------------------------------------------
seccion 'RF037–RF040 / RNF32: administración familiar'
pedir GET /administracion/integrantes '' "$TOKEN_ADMIN"
esperar 'Consultar integrantes (RF037)' 200
pedir PUT "/administracion/integrantes/$ID_INT/rol" '{"rol_id":1}' "$TOKEN_ADMIN"
esperar 'Cambiar rol del integrante a administrador (RF038)' 200
pedir PUT "/administracion/integrantes/$ID_INT/rol" '{"rol_id":2}' "$TOKEN_ADMIN"
esperar 'Regresarlo a integrante (RF038)' 200
pedir PUT /administracion/permisos '{"clave":"gastos.ver_detalle","permitido":true}' "$TOKEN_ADMIN"
esperar 'Dar permiso de ver detalle a los integrantes (RF039)' 200
pedir GET /administracion/permisos '' "$TOKEN_ADMIN"
esperar 'Consultar permisos del rol integrante (RF039)' 200
pedir DELETE /administracion/cuenta '{"confirmacion":"ELIMINAR"}' "$TOKEN_ADMIN"
esperar 'El único administrador no puede darse de baja' 400
pedir DELETE "/administracion/integrantes/$ID_INT" '' "$TOKEN_ADMIN"
esperar 'Eliminar integrante y anonimizar sus datos (RF040, RNF32)' 200
pedir POST /auth/login "{\"email\":\"$CORREO_INT\",\"password\":\"$CLAVE\"}"
esperar 'El integrante eliminado ya no puede iniciar sesión' 400

# -------------------------------------------------------------------------------------
seccion 'RNF05: cierre de sesión'
pedir POST /auth/logout '' "$TOKEN_ADMIN"
esperar 'Cerrar sesión' 200
pedir GET /auth/me '' "$TOKEN_ADMIN"
esperar 'El token anterior ya no sirve' 401

# -------------------------------------------------------------------------------------
seccion 'RNF09 / RNF12: tiempos de respuesta'
pedir POST /auth/login "{\"email\":\"$CORREO_ADMIN\",\"password\":\"$CLAVE\"}"
TOKEN_ADMIN=$(campo .token "$CUERPO")
MAX=0
for i in $(seq 1 20); do
  T=$(curl -s -o /dev/null -w '%{time_total}' "${TLS[@]}" -H "Authorization: Bearer $TOKEN_ADMIN" "$API/gastos?desde=$INICIO_MES&hasta=$HOY")
  MAX=$(awk -v a="$MAX" -v b="$T" 'BEGIN{print (b>a)?b:a}')
done
awk -v m="$MAX" 'BEGIN{exit !(m<3)}' && ok "20 consultas de gastos: la más lenta tardó ${MAX}s (< 3 s)" || mal 'Consultas en menos de 3 s' "${MAX}s"
INICIO=$(date +%s.%N)
for i in $(seq 1 100); do
  curl -s -o /dev/null -w '%{http_code}\n' "${TLS[@]}" -H "Authorization: Bearer $TOKEN_ADMIN" "$API/presupuestos" &
done > /tmp/famify_concurrencia
wait
TOTAL=$(awk -v a="$INICIO" -v b="$(date +%s.%N)" 'BEGIN{printf "%.2f", b-a}')
EXITOSAS=$(grep -c '^200$' /tmp/famify_concurrencia)
[ "$EXITOSAS" = 100 ] && ok "100 peticiones simultáneas: 100 exitosas en ${TOTAL}s" || mal '100 peticiones simultáneas' "$EXITOSAS exitosas"

# -------------------------------------------------------------------------------------
printf '\n%s== Resultado ==%s\n' "$NEGRITA" "$FIN"
printf '  %s%d aprobadas%s, %s%d fallidas%s\n' "$VERDE" "$APROBADAS" "$FIN" "$ROJO" "$FALLIDAS" "$FIN"
for f in "${FALLOS[@]}"; do printf '  %s- %s%s\n' "$ROJO" "$f" "$FIN"; done
rm -f /tmp/famify_cuerpo /tmp/famify_web /tmp/famify_concurrencia
[ "$FALLIDAS" -eq 0 ]
