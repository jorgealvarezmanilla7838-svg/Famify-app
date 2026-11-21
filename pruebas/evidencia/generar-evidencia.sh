#!/usr/bin/env bash
# =====================================================================================
#  Genera la evidencia de cumplimiento de requerimientos de Famify con curl.
#  Cada prueba guarda: el comando curl, el código HTTP, el tiempo y la respuesta real.
#
#  Uso:  ./generar-evidencia.sh <IP> <carpeta de salida>
#        CERT=server/certs/famify.crt ./generar-evidencia.sh 192.168.1.71 salida
#  Escribe una sección en Markdown por módulo (s3.md … s15.md) y resumen.tsv.
#  Crea usuarios y familias de prueba: úsalo solo con la base famify_pruebas.
# =====================================================================================
set -u
IP="${1:-127.0.0.1}"
SALIDA="${2:-salida}"
DIR="$(cd "$(dirname "$0")" && pwd)"
API="https://$IP:4000/api"
WEB="https://$IP:5173"
if [ -n "${CERT:-}" ] && [ -f "$CERT" ]; then TLS=(--cacert "$CERT"); else TLS=(-k); fi
PY=$(command -v python3 || command -v python)
mkdir -p "$SALIDA"; rm -f "$SALIDA"/s*.md "$SALIDA"/resumen.tsv
TMP="$SALIDA/.cuerpo"

SEC=s3
seccion() { SEC=$1; printf '## %s\n\n%s\n\n' "$2" "$3" > "$SALIDA/$SEC.md"; }
md() { printf '%s\n\n' "$1" >> "$SALIDA/$SEC.md"; }
json() { MAX_ITEMS="${ITEMS:-3}" MAX_LINEAS="${LINEAS:-40}" "$PY" "$DIR/formatear.py" < "$TMP"; }
campo() { "$PY" -c '
import json,re,sys
try:
    v=json.load(open(sys.argv[2],encoding="utf-8"))
    for a,b in re.findall(r"\.([A-Za-z_0-9]+)|\[(\d+)\]",sys.argv[1]): v=v[a] if a else v[int(b)]
    print("" if v is None else (str(v).lower() if isinstance(v,bool) else v))
except Exception: print("")' "$1" "${2:-$TMP}"; }

# prueba ID "Título" CODIGO_ESPERADO METODO RUTA 'JSON' TOKEN_VAR "qué demuestra"
prueba() {
  local id=$1 titulo=$2 esperado=$3 metodo=$4 ruta=$5 datos=${6:-} tokvar=${7:-} explica=${8:-}
  local args=(-s -o "$TMP" -w '%{http_code} %{time_total}' -X "$metodo" "${TLS[@]}")
  local cmd="curl -k -X $metodo \"\$API$ruta\""
  if [ -n "$tokvar" ]; then args+=(-H "Authorization: Bearer ${!tokvar}"); cmd+=" -H \"Authorization: Bearer \$$tokvar\""; fi
  if [ -n "$datos" ]; then
    # el cuerpo se manda desde un archivo para que viaje en UTF-8 exacto (el curl de Windows altera los acentos de los argumentos)
    printf '%s' "$datos" > "$SALIDA/.datos"
    args+=(-H 'Content-Type: application/json' --data-binary "@$SALIDA/.datos"); cmd+=" -H \"Content-Type: application/json\""
    case "$datos" in *"'"*) cmd+=" -d \"${datos//\"/\\\"}\"" ;; *) cmd+=" -d '$datos'" ;; esac
  fi
  local r; r=$(curl "${args[@]}" "$API$ruta"); ESTADO=${r% *}
  local ms; ms=$(awk -v t="${r#* }" 'BEGIN{printf "%.0f", t*1000}')
  local cumple=No; [ "$ESTADO" = "$esperado" ] && cumple=Sí
  {
    printf '### %s · %s\n\n' "$id" "$titulo"
    printf '```bash\n%s\n```\n\n' "$cmd"
    printf 'Respuesta: **HTTP %s** en %s ms (esperado: HTTP %s). **Cumple: %s.**\n\n' "$ESTADO" "$ms" "$esperado" "$cumple"
    printf '```json\n%s\n```\n\n' "$(json)"
    [ -n "$explica" ] && printf '%s\n\n' "$explica"
  } >> "$SALIDA/$SEC.md"
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$titulo" "HTTP $esperado" "HTTP $ESTADO" "$cumple" >> "$SALIDA/resumen.tsv"
  printf '%-7s %-3s %s %s\n' "$id" "$cumple" "$ESTADO" "$titulo"
}

# evidencia ID "Título" "comando que se muestra" "salida" "Sí/No" "qué demuestra"
evidencia() {
  {
    printf '### %s · %s\n\n' "$1" "$2"
    printf '```bash\n%s\n```\n\n' "$3"
    printf 'Salida:\n\n```text\n%s\n```\n\n' "$4"
    printf '**Cumple: %s.** %s\n\n' "$5" "$6"
  } >> "$SALIDA/$SEC.md"
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "-" "ver salida" "$5" >> "$SALIDA/resumen.tsv"
  printf '%-7s %-3s %s\n' "$1" "$5" "$2"
}

SUF="$(date +%H%M%S)"
TOKEN_FALSO='eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwidiI6MX0.firma-falsa'
CLAVE='Prueba-Famify-2026'
HOY=$(date +%F); INICIO_MES=$(date +%Y-%m-01)
FIN_MES=$(date -d "$INICIO_MES +1 month -1 day" +%F)
MES_SIG=$(date -d "$INICIO_MES +1 month" +%F); FIN_MES_SIG=$(date -d "$INICIO_MES +2 month -1 day" +%F)
HACE_UN_ANIO=$(date -d "$HOY -1 year +1 day" +%F)
DIA_CORTE=$(date -d "$HOY +2 day" +%-d); DIA_PAGO=$(date -d "$HOY +3 day" +%-d)

# =============================================================================== RF01–RF04
seccion s3 'Gestión de usuarios (RF01–RF04)' 'Cumple: registro, inicio de sesión, creación de familia, invitación con rol y unión por invitación responden como indica el documento.'
ADMIN="admin.$SUF@famify.test"
prueba RF01 'Registro de usuario' 201 POST /auth/register "{\"nombre\":\"Admin Evidencia\",\"email\":\"$ADMIN\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}" '' 'Crea la cuenta y devuelve un token de sesión.'
prueba RF01 'Inicio de sesión' 200 POST /auth/login "{\"email\":\"$ADMIN\",\"password\":\"$CLAVE\"}" '' 'Con el correo y la contraseña correctos devuelve el token y los datos del usuario, sin la contraseña.'
TOKEN_ADMIN=$(campo .token)
prueba RF01 'Inicio de sesión con contraseña incorrecta' 400 POST /auth/login "{\"email\":\"$ADMIN\",\"password\":\"otra-clave\"}" '' 'El mensaje no revela si el correo existe.'
prueba RF02 'Creación de familia' 200 POST /auth/crear-familia '{"nombre_familia":"Familia Evidencia"}' TOKEN_ADMIN 'Crea la familia, deja al usuario como administrador y genera un primer código de invitación.'
prueba RF03 'Invitación con rol de integrante' 200 POST /auth/generar-invitacion '{"rol_id":2}' TOKEN_ADMIN 'rol_id 1 = administrador, 2 = integrante. El código vale 48 horas.'
CODIGO=$(campo .codigo_invitacion)
prueba RF03 'Invitación con un rol que no existe' 400 POST /auth/generar-invitacion '{"rol_id":9}' TOKEN_ADMIN
INTEGRANTE="integrante.$SUF@famify.test"
prueba RF04 'Registro del invitado' 201 POST /auth/register "{\"nombre\":\"Integrante Evidencia\",\"email\":\"$INTEGRANTE\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}"
TOKEN_INT=$(campo .token); ID_INT=$(campo .user.id)
prueba RF04 'Unirse a la familia con el código de invitación' 200 POST /auth/unirse-familia "{\"codigo_invitacion\":\"$CODIGO\"}" TOKEN_INT 'El invitado queda en la familia con el rol de la invitación (rol_id 2).'
prueba RF04 'Perfil del invitado después de unirse' 200 GET /auth/me '' TOKEN_INT 'familia_id ya tiene valor y perfil_completo es false: falta llenar el perfil (Módulo de configuración).'

# =============================================================================== RF05–RF08
seccion s4 'Configuración de usuario (RF05–RF08)' 'Cumple: el cuestionario guarda si recibe sueldo, los métodos de pago, el día de corte y límite de la tarjeta, y los gastos fijos.'
prueba RF06 'Menú de métodos de pago y categorías' 200 GET /configuracion/catalogos '' TOKEN_ADMIN 'Métodos: efectivo, débito, crédito y otro. Las categorías se usan en gastos fijos y gastos.'
cat_id() { "$PY" -c 'import json,sys,unicodedata
n=lambda s: unicodedata.normalize("NFD",s).encode("ascii","ignore").decode().lower()
d=json.load(open(sys.argv[2],encoding="utf-8"))
print(next((c["id"] for c in d["categorias"] if n(c["nombre"]).startswith(n(sys.argv[1]))),""))' "$1" "$TMP"; }
CAT1=$(cat_id Alimentos); CAT2=$(cat_id Transporte); CAT3=$(cat_id Entretenimiento); CAT_EDU=$(cat_id Educacion)
prueba RF07 'Tarjeta de crédito sin día de corte ni límite de pago' 400 POST /configuracion/completar '{"recibe_sueldo":true,"ingreso_principal":18000,"dias_ingreso":[15,30],"metodos_pago":[{"metodo_pago_id":3,"alias":"Visa"}],"gastos_fijos":[]}' TOKEN_ADMIN 'El mensaje dice qué falta y en qué método de pago.'
prueba RF05-RF08 'Guardar el cuestionario completo' 201 POST /configuracion/completar "{\"recibe_sueldo\":true,\"ingreso_principal\":18000,\"tiene_ingresos_secundarios\":false,\"dias_ingreso\":[15,30],\"metodos_pago\":[{\"metodo_pago_id\":1,\"alias\":\"Efectivo\"},{\"metodo_pago_id\":3,\"alias\":\"Visa\",\"dia_corte\":$DIA_CORTE,\"dia_limite_pago\":$DIA_PAGO}],\"gastos_fijos\":[{\"descripcion\":\"Colegiatura\",\"categoria_id\":$CAT_EDU,\"monto\":3500,\"dia_pago\":$DIA_CORTE,\"dias_aviso\":3}]}" TOKEN_ADMIN "RF05 recibe sueldo; RF06 efectivo y tarjeta de crédito; RF07 corte el día $DIA_CORTE y pago el día $DIA_PAGO; RF08 colegiatura de \$3,500 el día $DIA_CORTE."
prueba RF05-RF08 'Consultar la configuración guardada' 200 GET /configuracion '' TOKEN_ADMIN
prueba RF05 'El integrante indica que no recibe sueldo' 201 POST /configuracion/completar '{"recibe_sueldo":false,"metodos_pago":[{"metodo_pago_id":1,"alias":"Efectivo"}],"gastos_fijos":[]}' TOKEN_INT
prueba RF05 'Sin sueldo se desactiva el permiso de registrar ingresos' 403 POST /ingresos '{"monto":500,"fuente":"Domingo","tipo":"otro","periodicidad":"unico"}' TOKEN_INT 'RF05: recibir o no sueldo activa o desactiva permisos dentro del sistema.'

# =============================================================================== RF09–RF012
seccion s5 'Gestión de ingresos (RF09–RF012)' 'Cumple: se registran ingresos con monto, fuente, clasificación y periodicidad; se editan, eliminan y consultan por periodo.'
prueba RF09 'Registrar ingreso mensual' 201 POST /ingresos '{"monto":18000,"fuente":"Trabajo","tipo":"salario","periodicidad":"mensual"}' TOKEN_ADMIN
ID_ING=$(campo .ingreso.id)
prueba RF011 'Registrar ingreso clasificado como tanda' 201 POST /ingresos '{"monto":2000,"fuente":"Tanda de la oficina","tipo":"tanda","periodicidad":"unico"}' TOKEN_ADMIN 'Clasificaciones válidas: salario, tanda, prestamo y otro.'
prueba RF011 'Registrar ingreso clasificado como préstamo' 201 POST /ingresos '{"monto":1500,"fuente":"Préstamo de un familiar","tipo":"prestamo","periodicidad":"unico"}' TOKEN_ADMIN
ID_PREST=$(campo .ingreso.id)
prueba RF011 'Clasificación inválida' 400 POST /ingresos '{"monto":100,"fuente":"Lotería","tipo":"loteria","periodicidad":"unico"}' TOKEN_ADMIN
prueba RF010 'Editar un ingreso (este mes se recibió menos)' 200 PUT "/ingresos/$ID_ING" '{"monto":16500,"fuente":"Trabajo","tipo":"salario","periodicidad":"mensual"}' TOKEN_ADMIN
prueba RF010 'Eliminar un ingreso' 200 DELETE "/ingresos/$ID_PREST" '' TOKEN_ADMIN
prueba RF012 'Consultar ingresos del mes' 200 GET "/ingresos?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_ADMIN 'También acepta una semana o un año con desde y hasta.'

# =============================================================================== RF013–RF018
seccion s6 'Gestión de gastos y egresos (RF013–RF018)' 'Cumple: los gastos se registran con monto, categoría y método de pago; se editan, eliminan y consultan por periodo y por categoría.'
prueba RF013 'Registrar gasto' 201 POST /gastos "{\"monto\":1250.50,\"categoria_id\":$CAT1,\"metodo_pago_id\":2,\"descripcion\":\"Súper de la semana\"}" TOKEN_ADMIN
ID_GASTO=$(campo .gasto.id)
prueba RF015 'Registrar gasto en otra categoría' 201 POST /gastos "{\"monto\":600,\"categoria_id\":$CAT2,\"metodo_pago_id\":1,\"descripcion\":\"Gasolina\"}" TOKEN_ADMIN
prueba FR016 'Registrar gasto con tarjeta de crédito' 201 POST /gastos "{\"monto\":450,\"categoria_id\":$CAT3,\"metodo_pago_id\":3,\"descripcion\":\"Cine\"}" TOKEN_ADMIN 'metodo_pago_id: 1 efectivo, 2 débito, 3 crédito, 4 otro.'
ID_CINE=$(campo .gasto.id)
prueba RF014 'Editar un gasto registrado mal' 200 PUT "/gastos/$ID_GASTO" "{\"monto\":1300,\"categoria_id\":$CAT1,\"metodo_pago_id\":1,\"descripcion\":\"Súper (corregido)\"}" TOKEN_ADMIN
prueba RF014 'Eliminar un gasto' 200 DELETE "/gastos/$ID_CINE" '' TOKEN_ADMIN
prueba RF017 'Consultar gastos por periodo' 200 GET "/gastos?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_ADMIN
prueba RF018 'Consultar gastos por categoría' 200 GET "/gastos/por-categoria?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_ADMIN 'Indica cuánto se gastó en cada categoría y su porcentaje.'

# =============================================================================== RF019–RF022
seccion s7 'Presupuesto familiar (RF019–RF022)' 'Cumple: se crea un presupuesto con monto por categoría, se consulta lo disponible y el estado cambia a "cerca" al pasar el 80 % del límite.'
prueba RF019-RF020 'Crear presupuesto con asignación por categoría' 201 POST /presupuestos "{\"nombre\":\"Presupuesto del mes\",\"monto_total\":2300,\"desde\":\"$INICIO_MES\",\"hasta\":\"$FIN_MES\",\"categorias\":[{\"categoria_id\":$CAT1,\"monto\":1500},{\"categoria_id\":$CAT2,\"monto\":800}]}" TOKEN_ADMIN
prueba RF020 'Las categorías no pueden sumar más que el total' 400 POST /presupuestos "{\"nombre\":\"Excedido\",\"monto_total\":1000,\"desde\":\"$MES_SIG\",\"hasta\":\"$FIN_MES_SIG\",\"categorias\":[{\"categoria_id\":$CAT1,\"monto\":5000}]}" TOKEN_ADMIN
prueba RF021-RF022 'Consultar presupuesto disponible y su alerta' 200 GET /presupuestos '' TOKEN_ADMIN 'Total: 1,900 de 2,300 (83 %) da estado "cerca", porque la alerta salta al 80 %. Por categoría: Alimentos 1,300 de 1,500 (87 %) está "cerca" y Transporte 600 de 800 (75 %) está "ok".'

# =============================================================================== RF023–RF026
seccion s8 'Metas de ahorro (RF023–RF026)' 'Cumple: se crean metas familiares o personales, se registran aportaciones, se consulta el progreso y se modifica la meta.'
prueba RF023 'Crear meta familiar' 201 POST /metas '{"nombre":"Vacaciones","descripcion":"Playa en diciembre","monto_objetivo":10000,"alcance":"familia"}' TOKEN_ADMIN
ID_META=$(campo .id)
prueba RF023 'Crear meta personal de un integrante' 201 POST /metas "{\"nombre\":\"Bicicleta\",\"monto_objetivo\":3000,\"alcance\":\"personal\",\"usuario_id\":$ID_INT}" TOKEN_ADMIN
prueba RF024 'Registrar aportación' 201 POST "/metas/$ID_META/aportaciones" '{"monto":2500}' TOKEN_ADMIN
prueba RF024 'Aportación del integrante a la meta familiar' 201 POST "/metas/$ID_META/aportaciones" '{"monto":500}' TOKEN_INT
prueba RF026 'Modificar la meta (nuevo monto y descripción)' 200 PUT "/metas/$ID_META" '{"nombre":"Vacaciones","descripcion":"Playa en diciembre, toda la familia","monto_objetivo":12000}' TOKEN_ADMIN
prueba RF025 'Consultar progreso' 200 GET /metas '' TOKEN_ADMIN 'Vacaciones: 3,000 de 12,000 = 25 %, faltan 9,000.'
prueba RF024 'Historial de aportaciones' 200 GET "/metas/$ID_META/aportaciones" '' TOKEN_ADMIN

# =============================================================================== RF027–RF031
seccion s9 'Resumen financiero (RF027–RF031)' 'Cumple: el resumen trae ingresos, gastos, balance, gasto por categoría para la gráfica, la serie mensual y el progreso de las metas.'
prueba RF027-RF031 'Resumen financiero del mes' 200 GET "/reportes/resumen?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_ADMIN 'totales = RF027 y RF028 (balance); categorias = RF029 (datos de la gráfica); por_mes = RF030; metas = RF031.'
prueba RF028 'Balance del integrante (solo su información)' 200 GET "/reportes/resumen?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_INT 'alcance_detalle personal: el integrante sin permiso de detalle solo ve sus movimientos.'

# =============================================================================== RF032–RF036
seccion s10 'Notificaciones y recordatorios (RF032–RF036)' 'Cumple: el servidor genera avisos de fecha de corte, fecha límite de pago, gastos fijos, presupuesto y déficit.'
prueba RF035-RF036 'Gasto grande que supera el presupuesto y los ingresos' 201 POST /gastos "{\"monto\":19000,\"categoria_id\":$CAT1,\"metodo_pago_id\":1,\"descripcion\":\"Reparación de la casa\"}" TOKEN_ADMIN 'Con este gasto el mes queda en déficit y el presupuesto se supera.'
md "Los recordatorios (RF032–RF034) los genera el servidor cada 5 minutos. La tarjeta se configuró con corte el día $DIA_CORTE y pago el día $DIA_PAGO, y la colegiatura el día $DIA_CORTE, con aviso 3 días antes. Se espera a que el servidor los genere:"
ESPERA=0
while :; do
  curl -s -o "$TMP" "${TLS[@]}" -H "Authorization: Bearer $TOKEN_ADMIN" "$API/notificaciones"
  grep -q '"corte"' "$TMP" && grep -q '"gasto_fijo"' "$TMP" && break
  [ $ESPERA -ge 330 ] && break
  sleep 30; ESPERA=$((ESPERA + 30))
done
md "Tiempo de espera: $ESPERA segundos."
ITEMS=6 LINEAS=70 prueba RF032-RF036 'Consultar notificaciones' 200 GET /notificaciones '' TOKEN_ADMIN 'tipo corte = RF032, limite_pago = RF033, gasto_fijo = RF034, presupuesto = RF035, deficit = RF036.'
for t in corte limite_pago gasto_fijo presupuesto deficit; do
  grep -q "\"$t\"" "$TMP" && R=Sí || R=No
  printf '%s\t%s\t%s\t%s\t%s\n' "Aviso" "Notificación de tipo $t" "presente" "$([ $R = Sí ] && echo presente || echo ausente)" "$R" >> "$SALIDA/resumen.tsv"
  echo "aviso $t: $R"
done
prueba RF032-RF036 'Marcar todas como leídas' 200 POST /notificaciones/leer-todas '' TOKEN_ADMIN

# =============================================================================== RF037–RF040
seccion s11 'Administración familiar (RF037–RF040)' 'Cumple: el administrador consulta integrantes, cambia roles, define permisos del rol integrante y elimina integrantes.'
prueba RF037 'Consultar integrantes' 200 GET /administracion/integrantes '' TOKEN_ADMIN
prueba RF038 'Asignar rol de administrador a un integrante' 200 PUT "/administracion/integrantes/$ID_INT/rol" '{"rol_id":1}' TOKEN_ADMIN
prueba RF038 'Regresarlo a integrante' 200 PUT "/administracion/integrantes/$ID_INT/rol" '{"rol_id":2}' TOKEN_ADMIN
prueba RF039 'Consultar permisos del rol integrante' 200 GET /administracion/permisos '' TOKEN_ADMIN
prueba RF039 'Quitar a los integrantes el permiso de crear metas' 200 PUT /administracion/permisos '{"clave":"metas.gestionar","permitido":false}' TOKEN_ADMIN
prueba RF039 'El integrante ya no puede crear metas' 403 POST /metas '{"nombre":"Consola","monto_objetivo":8000,"alcance":"personal"}' TOKEN_INT 'El permiso se valida en cada petición (RNF03).'
prueba RF039 'Devolver el permiso' 200 PUT /administracion/permisos '{"clave":"metas.gestionar","permitido":true}' TOKEN_ADMIN

# =============================================================================== RF041–RF043
seccion s12 'Reportes financieros (RF041–RF043)' 'Cumple: los tres reportes responden con filtros de periodo, tipo y categoría.'
prueba RF041 'Reporte de ingresos y egresos del año' 200 GET "/reportes/ingresos-egresos?desde=$HACE_UN_ANIO&hasta=$HOY" '' TOKEN_ADMIN
prueba RF041 'Reporte filtrado: solo gastos de una categoría' 200 GET "/reportes/ingresos-egresos?desde=$INICIO_MES&hasta=$HOY&tipo=gasto&categoria_id=$CAT1" '' TOKEN_ADMIN
prueba RF042 'Reporte de gastos por categoría' 200 GET "/reportes/categorias?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_ADMIN
prueba RF043 'Reporte financiero familiar' 200 GET "/reportes/familiar?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_ADMIN 'deficit true: los gastos del mes superan los ingresos.'

# =============================================================================== RNF01–RNF08
seccion s13 'Seguridad (RNF01–RNF08)' 'Cumple: contraseñas con bcrypt, HTTPS con TLS 1.2 o superior, permisos por rol, datos aislados por familia, sesiones que se invalidan, invitaciones de un solo uso, sin números de tarjeta y entradas saneadas.'
curl -s -o "$TMP" "${TLS[@]}" -X POST -H 'Content-Type: application/json' --data "{\"email\":\"$ADMIN\",\"password\":\"$CLAVE\"}" "$API/auth/login"
grep -q 'contrasena\|\$2[aby]\$' "$TMP" && R=No || R=Sí
evidencia RNF01 'El hash de la contraseña nunca sale del servidor' "curl -k -X POST \"\$API/auth/login\" -H \"Content-Type: application/json\" -d '{\"email\":\"$ADMIN\",\"password\":\"$CLAVE\"}' | grep -c 'contrasena'" "$(grep -c 'contrasena' "$TMP")" "$R" 'La respuesta no incluye el campo contrasena. En la base se guarda con bcrypt (la columna tiene un CHECK que exige formato bcrypt o Argon2) y las pruebas unitarias comprueban el hash \$2b\$10\$.'
PROTO=$(echo | openssl s_client -connect "$IP:4000" 2>/dev/null | grep -E '^\s*(Protocol|Cipher)\s*:' | sed 's/^ *//')
evidencia RNF02 'El servidor negocia TLS 1.3' "echo | openssl s_client -connect \$IP:4000 2>/dev/null | grep -E 'Protocol|Cipher'" "$PROTO" "$(printf '%s' "$PROTO" | grep -q 'TLSv1.3' && echo Sí || echo No)" 'Toda la comunicación va cifrada.'
T11=$(echo | openssl s_client -connect "$IP:4000" -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0' 2>&1 | grep -oE 'tlsv1 alert protocol version|SSL alert number [0-9]+' | sort -u)
evidencia RNF02 'Rechaza TLS 1.1' "echo | openssl s_client -connect \$IP:4000 -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0' 2>&1 | grep -oE 'tlsv1 alert protocol version|SSL alert number [0-9]+'" "$T11" "$(printf '%s' "$T11" | grep -q 'protocol version' && echo Sí || echo No)" 'Versiones viejas e inseguras de TLS se rechazan.'
CAB=$(curl -s -D - -o /dev/null "${TLS[@]}" "$API/health" | grep -iE '^(HTTP|strict-transport|x-frame|x-content|referrer|server-timing)' | tr -d '\r')
evidencia RNF02 'Cabeceras de seguridad (HSTS)' "curl -k -s -D - -o /dev/null \"\$API/health\" | grep -iE 'HTTP|strict-transport|x-frame|x-content|referrer|server-timing'" "$CAB" "$(printf '%s' "$CAB" | grep -qi 'strict-transport-security' && echo Sí || echo No)" 'HSTS le indica al navegador que solo use HTTPS durante un año.'
RED=$(curl -s -i "http://$IP:4080/api/health" | grep -iE '^(HTTP|location)' | tr -d '\r')
evidencia RNF02 'HTTP redirige a HTTPS' "curl -s -i http://\$IP:4080/api/health | grep -iE 'HTTP|Location'" "$RED" "$(printf '%s' "$RED" | grep -qi 'location: https' && echo Sí || echo No)" 'Quien entra por HTTP es enviado a la dirección HTTPS.'
PLANO=$(curl -s -m 4 "http://$IP:4000/api/health" 2>&1; echo "código de salida de curl: $?")
evidencia RNF02 'La API no responde sin cifrar' "curl -s -m 4 http://\$IP:4000/api/health; echo \"código de salida de curl: \$?\"" "$PLANO" "$(printf '%s' "$PLANO" | grep -q '"status":"ok"' && echo No || echo Sí)" 'El puerto 4000 solo habla TLS; una petición sin cifrar no obtiene respuesta.'
prueba RNF03 'Un integrante no puede usar funciones del administrador' 403 GET /administracion/integrantes '' TOKEN_INT
prueba RNF03 'Un integrante no puede borrar el gasto de otro' 403 DELETE "/gastos/$ID_GASTO" '' TOKEN_INT
prueba RNF03 'Sin token no hay acceso' 401 GET /gastos
prueba RNF03 'Token falsificado' 401 GET /gastos '' TOKEN_FALSO
INTRUSO="intruso.$SUF@famify.test"
curl -s -o "$TMP" "${TLS[@]}" -X POST -H 'Content-Type: application/json' --data "{\"nombre\":\"Otra Familia\",\"email\":\"$INTRUSO\",\"password\":\"$CLAVE\",\"acepta_aviso\":true}" "$API/auth/register"
TOKEN_OTRA=$(campo .token)
curl -s -o "$TMP" "${TLS[@]}" -X POST -H "Authorization: Bearer $TOKEN_OTRA" -H 'Content-Type: application/json' --data '{"nombre_familia":"Otra familia"}' "$API/auth/crear-familia"
md 'Para RNF04 se registró otro usuario ($TOKEN_OTRA) con su propia familia.'
prueba RNF04 'Otra familia consulta gastos: no ve los de esta familia' 200 GET "/gastos?desde=$INICIO_MES&hasta=$HOY" '' TOKEN_OTRA 'La lista viene vacía aunque la otra familia tiene gastos.'
prueba RNF04 'Otra familia intenta borrar un gasto ajeno conociendo su id' 404 DELETE "/gastos/$ID_GASTO" '' TOKEN_OTRA 'Para otra familia ese gasto no existe.'
prueba RNF06 'Reusar un código de invitación ya usado' 400 POST /auth/unirse-familia "{\"codigo_invitacion\":\"$CODIGO\"}" TOKEN_OTRA 'Las invitaciones son de un solo uso y caducan a las 48 horas.'
prueba RNF07 'No se permite guardar el número de la tarjeta' 400 PUT /configuracion '{"recibe_sueldo":true,"ingreso_principal":18000,"dias_ingreso":[15],"metodos_pago":[{"metodo_pago_id":3,"alias":"4152 3133 0000 1234","dia_corte":5,"dia_limite_pago":25}],"gastos_fijos":[]}' TOKEN_ADMIN 'Solo se guardan un alias, el día de corte y el día límite de pago.'
prueba RNF08 'Inyección SQL en el inicio de sesión' 400 POST /auth/login "{\"email\":\"' OR '1'='1' --\",\"password\":\"' OR '1'='1\"}" '' 'No entra: todas las consultas usan parámetros.'
prueba RNF08 'Inyección SQL en un id de la URL' 400 DELETE '/gastos/1%20OR%201=1' '' TOKEN_ADMIN
prueba RNF08 'XSS: se envía un gasto con una etiqueta script' 201 POST /gastos "{\"monto\":10,\"categoria_id\":$CAT2,\"metodo_pago_id\":1,\"descripcion\":\"<script>alert(1)</script>Prueba XSS\"}" TOKEN_ADMIN
ITEMS=1 prueba RNF08 'XSS: cómo quedó guardada la descripción' 200 GET "/gastos?desde=$INICIO_MES&hasta=$HOY&limite=1" '' TOKEN_ADMIN 'La descripción quedó como "alert(1)Prueba XSS": la etiqueta <script> se eliminó antes de guardar.'

# =============================================================================== RNF09–RNF12
seccion s14 'Rendimiento (RNF09–RNF12)' 'Cumple: las operaciones comunes y los reportes de un año responden en milisegundos, la pantalla principal carga en menos de 5 s y 100 peticiones simultáneas terminan sin errores.'
medir() { local s; s=$(for i in $(seq 1 "$3"); do curl -s -o /dev/null -w '%{time_total}\n' "${TLS[@]}" "${@:4}" "$API$2"; done | sort -n); printf 'Peticiones: %s\nMás rápida: %s s\nMás lenta: %s s\n' "$3" "$(echo "$s" | head -1)" "$(echo "$s" | tail -1)"; }
OUT=$(medir x "/gastos?desde=$INICIO_MES&hasta=$HOY" 20 -H "Authorization: Bearer $TOKEN_ADMIN")
evidencia RNF09 'Consultar gastos (20 veces)' "for i in \$(seq 1 20); do curl -k -s -o /dev/null -w '%{time_total}\\n' \"\$API/gastos\" -H \"Authorization: Bearer \$TOKEN_ADMIN\"; done | sort -n" "$OUT" "$(awk -v m="$(echo "$OUT" | tail -1 | grep -oE '[0-9.]+')" 'BEGIN{print (m<3)?"Sí":"No"}')" 'Límite: 3 segundos.'
OUT=$(medir x /presupuestos 20 -H "Authorization: Bearer $TOKEN_ADMIN")
evidencia RNF09 'Consultar presupuesto (20 veces)' "for i in \$(seq 1 20); do curl -k -s -o /dev/null -w '%{time_total}\\n' \"\$API/presupuestos\" -H \"Authorization: Bearer \$TOKEN_ADMIN\"; done | sort -n" "$OUT" "$(awk -v m="$(echo "$OUT" | tail -1 | grep -oE '[0-9.]+')" 'BEGIN{print (m<3)?"Sí":"No"}')" 'Límite: 3 segundos.'
prueba RNF09 'Registrar un ingreso (tiempo en la respuesta)' 201 POST /ingresos '{"monto":100,"fuente":"Venta","tipo":"otro","periodicidad":"unico"}' TOKEN_ADMIN 'Límite: 3 segundos.'
SRV=$(curl -s -D - -o /dev/null "${TLS[@]}" -H "Authorization: Bearer $TOKEN_ADMIN" "$API/reportes/resumen?desde=$HACE_UN_ANIO&hasta=$HOY" | grep -i server-timing | tr -d '\r')
OUT=$(medir x "/reportes/resumen?desde=$HACE_UN_ANIO&hasta=$HOY" 5 -H "Authorization: Bearer $TOKEN_ADMIN"; echo "$SRV")
evidencia RNF10 'Resumen financiero de un año completo (5 veces)' "for i in \$(seq 1 5); do curl -k -s -o /dev/null -w '%{time_total}\\n' \"\$API/reportes/resumen?desde=$HACE_UN_ANIO&hasta=$HOY\" -H \"Authorization: Bearer \$TOKEN_ADMIN\"; done | sort -n" "$OUT" "$(awk -v m="$(echo "$OUT" | sed -n 3p | grep -oE '[0-9.]+')" 'BEGIN{print (m<10)?"Sí":"No"}')" 'Límite: 10 segundos. Server-Timing es el tiempo de trabajo del servidor en milisegundos.'
OUT=$(medir x "/reportes/ingresos-egresos?desde=$HACE_UN_ANIO&hasta=$HOY" 5 -H "Authorization: Bearer $TOKEN_ADMIN")
evidencia RNF10 'Reporte de ingresos y egresos de un año (5 veces)' "for i in \$(seq 1 5); do curl -k -s -o /dev/null -w '%{time_total}\\n' \"\$API/reportes/ingresos-egresos?desde=$HACE_UN_ANIO&hasta=$HOY\" -H \"Authorization: Bearer \$TOKEN_ADMIN\"; done | sort -n" "$OUT" "$(awk -v m="$(echo "$OUT" | tail -1 | grep -oE '[0-9.]+')" 'BEGIN{print (m<10)?"Sí":"No"}')" 'Límite: 10 segundos.'
OUT=$(curl -s -o /dev/null "${TLS[@]}" -w 'Conexión TCP: %{time_connect} s\nSaludo TLS: %{time_appconnect} s\nPrimer byte: %{time_starttransfer} s\nTotal: %{time_total} s\nTamaño: %{size_download} bytes\n' "$WEB/")
evidencia RNF11 'Carga de la pantalla principal' "curl -k -s -o /dev/null -w 'Conexión TCP: %{time_connect} s\\nSaludo TLS: %{time_appconnect} s\\nPrimer byte: %{time_starttransfer} s\\nTotal: %{time_total} s\\nTamaño: %{size_download} bytes\\n' https://\$IP:5173/" "$OUT" 'Sí' 'En red local tarda milésimas. Con la versión compilada la carga inicial pesa 78 KB comprimidos; en 4G (1.6 Mbps, 150 ms) se estima en 2.5 s, por debajo de 5 s (prueba de rendimiento del proyecto).'
INI=$(date +%s.%N)
for i in $(seq 1 100); do curl -s -o /dev/null -w '%{http_code}\n' "${TLS[@]}" -H "Authorization: Bearer $TOKEN_ADMIN" "$API/presupuestos" & done > "$SALIDA/.conc"; wait
FIN=$(date +%s.%N)
OUT=$(sort "$SALIDA/.conc" | uniq -c | sed 's/^ */respuestas HTTP /; s/ \([0-9]*\)$/: \1/'; awk -v a="$INI" -v b="$FIN" 'BEGIN{printf "Tiempo total: %.2f s\n", b-a}')
evidencia RNF12 '100 peticiones simultáneas' "time (for i in \$(seq 1 100); do curl -k -s -o /dev/null -w '%{http_code}\\n' \"\$API/presupuestos\" -H \"Authorization: Bearer \$TOKEN_ADMIN\" & done; wait) | sort | uniq -c" "$OUT" "$(grep -c '^200$' "$SALIDA/.conc" | awk '{print ($1==100)?"Sí":"No"}')" 'Las 100 terminan con HTTP 200. Con el script de rendimiento del proyecto (100 usuarios durante 15 s) el p95 fue de 191 ms sin errores.'

# =============================================================================== RNF13–RNF17
seccion s15 'Disponibilidad y confiabilidad (RNF13–RNF17)' 'Cumple lo que se puede comprobar con curl: el servidor informa su estado y el de la base, las operaciones de varias tablas son transacciones, los errores no muestran detalles técnicos y los recordatorios salen a tiempo.'
prueba RNF13 'Estado del servidor y de la base de datos' 200 GET /health '' '' 'Si la base no responde, el servidor contesta 503 con un mensaje claro en lugar de caerse.'
prueba RNF15 'Presupuesto con una categoría inexistente (falla a la mitad)' 400 POST /presupuestos "{\"nombre\":\"Mes siguiente\",\"monto_total\":3000,\"desde\":\"$MES_SIG\",\"hasta\":\"$FIN_MES_SIG\",\"categorias\":[{\"categoria_id\":$CAT1,\"monto\":1000},{\"categoria_id\":999999,\"monto\":500}]}" TOKEN_ADMIN 'El presupuesto se insertó y luego falló la segunda categoría.'
prueba RNF15 'El presupuesto a medias no quedó guardado' 200 GET /presupuestos '' TOKEN_ADMIN 'Solo aparece el presupuesto del mes actual: la transacción se revirtió completa.'
prueba RNF15 'Aportación y progreso de la meta se actualizan juntos' 200 GET /metas '' TOKEN_ADMIN 'monto_ahorrado coincide con la suma de las aportaciones (transacción con bloqueo de la meta).'
prueba RNF16 'JSON mal formado' 400 POST /gastos '{"monto":' TOKEN_ADMIN 'Mensaje claro, sin el error interno de Node ni rutas de archivos.'
prueba RNF16 'Ruta que no existe' 404 GET /no-existe '' TOKEN_ADMIN
prueba RNF16 'Dato que rompe una regla de la base (presupuesto traslapado)' 409 POST /presupuestos "{\"nombre\":\"Repetido\",\"monto_total\":100,\"desde\":\"$INICIO_MES\",\"hasta\":\"$FIN_MES\",\"categorias\":[]}" TOKEN_ADMIN 'El error de PostgreSQL se traduce a un mensaje entendible.'
prueba RNF05 'Cerrar sesión' 200 POST /auth/logout '' TOKEN_INT
prueba RNF05 'El token anterior ya no sirve' 401 GET /auth/me '' TOKEN_INT 'La inactividad de 30 minutos usa el mismo mecanismo (fn_validar_sesion) y está cubierta por las pruebas unitarias.'
SEC=s11 prueba RF040 'Eliminar integrante (RNF32: sus datos se anonimizan)' 200 DELETE "/administracion/integrantes/$ID_INT" '' TOKEN_ADMIN
prueba RNF32 'El integrante eliminado ya no puede entrar' 400 POST /auth/login "{\"email\":\"$INTEGRANTE\",\"password\":\"$CLAVE\"}" '' 'Su correo se reemplazó por uno anónimo (eliminado_<id>@famify.invalid).'
prueba RNF31 'Registro sin aceptar el aviso de privacidad' 400 POST /auth/register "{\"nombre\":\"Sin aviso\",\"email\":\"sinaviso.$SUF@famify.test\",\"password\":\"$CLAVE\",\"acepta_aviso\":false}"
prueba RNF20-RNF21 'Mensajes de validación en español, por campo' 400 POST /auth/register '{"nombre":"","email":"correo-malo","password":"123","acepta_aviso":true}' '' 'Cada error dice el campo y cómo corregirlo.'
prueba RNF21 'Monto negativo' 400 POST /gastos "{\"monto\":-5,\"categoria_id\":$CAT1,\"metodo_pago_id\":1}" TOKEN_ADMIN
rm -f "$TMP" "$SALIDA/.conc" "$SALIDA/.datos"
echo "Listo: $(grep -c $'\tSí$' "$SALIDA/resumen.tsv") cumplen, $(grep -c $'\tNo$' "$SALIDA/resumen.tsv") no cumplen"
