# Pruebas de Famify

| Tipo | Dónde | Cómo se corre | Qué necesita |
|---|---|---|---|
| Unitarias del servidor (119) | `server/test/` | `cd server && npm test` | Nada: la base de datos se simula, no toca PostgreSQL |
| Unitarias del cliente (23) | `client/src/*.test.ts(x)` | `cd client && npm test` | Nada |
| De sistema desde Kali (77) | `pruebas/kali/pruebas-famify.sh` | `./pruebas-famify.sh <IP>` | Servidor y cliente encendidos |
| Rendimiento RNF09–RNF12 | `server/scripts/prueba-rendimiento.cjs` | `cd server && npm run prueba:rendimiento` | Servidor encendido |

## 1. Pruebas unitarias (en Windows)

```powershell
cd server; npm test
```

```powershell
cd client; npm test
```

Las del servidor usan el corredor de pruebas de Node (`node:test`). La base de datos se reemplaza por una simulada (`server/test/apoyo/bd-falsa.ts`), así que no se necesita PostgreSQL y nunca se modifican datos. Las del cliente usan Vitest.

| Archivo | Qué prueba |
|---|---|
| `server/test/validaciones.test.ts` | Validación de gastos, ingresos, periodos y el cuestionario (RF05–RF018, RNF07, RNF21) |
| `server/test/seguridad.test.ts` | Sanitización XSS (RNF08), HTTPS/HSTS (RNF02), Server-Timing (RNF09), errores sin detalles (RNF16) |
| `server/test/auth.test.ts` | Registro y login (RF01), bcrypt (RNF01), aviso de privacidad (RNF31), sesiones (RNF05), familia e invitaciones (RF02–RF04, RNF06) |
| `server/test/servicios.test.ts` | Presupuesto y alertas (RF021–RF022), metas (RF025), reportes y déficit (RF027–RF043), roles (RF039) |
| `server/test/rutas.test.ts` | Rutas de todos los módulos: aislamiento por familia (RNF04), permisos (RNF03), transacciones (RNF15), administración (RF037–RF040) |
| `client/src/formato.test.ts` | Pesos MXN y fechas DD/MM/AAAA (RNF23) |
| `client/src/api.test.ts` | Comunicación con el servidor, errores claros y sesión expirada |
| `client/src/Comunes.test.tsx` | Gráficas de barras accesibles (RF029, RF031, RNF22) y aviso de privacidad (RNF31) |

## 2. Preparar el servidor (en Windows)

Para no tocar la base `famify`, las pruebas de sistema se hacen contra la base `famify_pruebas`.

```powershell
cd server; $env:DB_NAME='famify_pruebas'; $env:RESPALDOS_ACTIVOS='false'; npm run dev
```

```powershell
cd client; npm run dev
```

Para saber la IP que debes usar desde Kali, corre `ipconfig` en Windows. Si Kali está en una VM de VMware con NAT, usa la IP del adaptador "VMware Network Adapter VMnet8". Si está en modo puente (bridge), usa la IP de tu red local.
El firewall de Windows debe permitir los puertos 4000, 4080 y 5173.

## 3. Preparar Kali

```bash
sudo apt update && sudo apt install -y curl jq openssl nmap
```

```bash
git clone https://github.com/jorgealvarezmanilla7838-svg/Famify-app.git && cd Famify-app && git switch pruebas/unitarias-y-kali
```

Para validar el certificado en lugar de usar `-k`, copia `server/certs/famify.crt` de Windows a Kali. Por ejemplo, con una carpeta compartida o con `scp`.

## 4. Prueba automática completa desde Kali

```bash
chmod +x pruebas/kali/pruebas-famify.sh
```

```bash
./pruebas/kali/pruebas-famify.sh 192.168.1.71
```

Con el certificado copiado:

```bash
CERT=famify.crt ./pruebas/kali/pruebas-famify.sh 192.168.1.71
```

El script recorre 77 comprobaciones: TLS, HSTS, frontend y proxy, registro, familia, invitaciones, configuración, ingresos, gastos, presupuesto, metas, reportes, notificaciones, permisos por rol, aislamiento entre familias, inyección SQL, XSS, administración, cierre de sesión y tiempos de respuesta. Al final muestra cuántas pasaron y cuáles fallaron.

## 5. Comandos manuales en Kali (uno por uno)

Variables (cambia la IP):

```bash
IP=192.168.1.71; API=https://$IP:4000/api; K="-k"
```

### Red y HTTPS (RNF02)

```bash
nmap -Pn -p 4000,4080,5173 $IP
```

```bash
curl $K -i $API/health
```

```bash
echo | openssl s_client -connect $IP:4000 2>/dev/null | grep -E "Protocol|Cipher"
```

```bash
echo | openssl s_client -connect $IP:4000 -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0' 2>&1 | grep "alert protocol version"
```

```bash
curl -i http://$IP:4080/api/health
```

```bash
curl -m 3 http://$IP:4000/api/health; echo "código de salida: $?"
```

```bash
nmap -Pn --script ssl-enum-ciphers -p 4000 $IP
```

### Frontend conectado al backend

```bash
curl $K -s https://$IP:5173 | head -15
```

```bash
curl $K -s https://$IP:5173/api/health | jq
```

Para ver en vivo el tráfico cifrado entre Kali y Famify mientras usas la app en Firefox:

```bash
sudo tcpdump -i any -nn "host $IP and (port 4000 or port 5173)"
```

### Registro, login y familia (RF01–RF04)

```bash
TOKEN=$(curl $K -s -X POST $API/auth/register -H "Content-Type: application/json" -d '{"nombre":"Kali Demo","email":"kali.demo@kali.test","password":"KaliDemo2026","acepta_aviso":true}' | tee /dev/stderr | jq -r .token)
```

```bash
TOKEN=$(curl $K -s -X POST $API/auth/login -H "Content-Type: application/json" -d '{"email":"kali.demo@kali.test","password":"KaliDemo2026"}' | jq -r .token); echo $TOKEN
```

```bash
curl $K -s $API/auth/me -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s -X POST $API/auth/crear-familia -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"nombre_familia":"Familia Kali"}' | jq
```

```bash
curl $K -s -X POST $API/auth/generar-invitacion -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"rol_id":2}' | jq
```

### Configuración (RF05–RF08)

```bash
curl $K -s $API/configuracion/catalogos -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s -X POST $API/configuracion/completar -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"recibe_sueldo":true,"ingreso_principal":18000,"dias_ingreso":[15,30],"metodos_pago":[{"metodo_pago_id":1,"alias":"Efectivo"},{"metodo_pago_id":3,"alias":"Visa","dia_corte":5,"dia_limite_pago":25}],"gastos_fijos":[]}' | jq
```

### Ingresos y gastos (RF09–RF018)

```bash
curl $K -s -X POST $API/ingresos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"monto":18000,"fuente":"Trabajo","tipo":"salario","periodicidad":"mensual"}' | jq
```

```bash
curl $K -s "$API/ingresos" -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s -X POST $API/gastos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"monto":350.50,"categoria_id":1,"metodo_pago_id":2,"descripcion":"Súper"}' | jq
```

```bash
curl $K -s "$API/gastos" -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s "$API/gastos/por-categoria" -H "Authorization: Bearer $TOKEN" | jq
```

### Presupuesto y metas (RF019–RF026)

Las fechas de este presupuesto deben no traslaparse con otro de la familia.

```bash
curl $K -s -X POST $API/presupuestos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"nombre\":\"Mes\",\"monto_total\":8000,\"desde\":\"$(date +%Y-%m-01)\",\"hasta\":\"$(date -d "$(date +%Y-%m-01) +1 month -1 day" +%F)\",\"categorias\":[{\"categoria_id\":1,\"monto\":3000}]}" | jq
```

```bash
curl $K -s $API/presupuestos -H "Authorization: Bearer $TOKEN" | jq
```

```bash
META=$(curl $K -s -X POST $API/metas -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"nombre":"Vacaciones","monto_objetivo":10000,"alcance":"familia"}' | jq -r .id); echo $META
```

```bash
curl $K -s -X POST $API/metas/$META/aportaciones -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"monto":500}' | jq
```

```bash
curl $K -s $API/metas -H "Authorization: Bearer $TOKEN" | jq
```

### Resumen, reportes y notificaciones (RF027–RF043)

```bash
curl $K -s $API/reportes/resumen -H "Authorization: Bearer $TOKEN" | jq '.totales'
```

```bash
curl $K -s $API/reportes/ingresos-egresos -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s $API/reportes/categorias -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s $API/reportes/familiar -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s $API/notificaciones -H "Authorization: Bearer $TOKEN" | jq
```

### Administración (RF037–RF040)

```bash
curl $K -s $API/administracion/integrantes -H "Authorization: Bearer $TOKEN" | jq
```

```bash
curl $K -s $API/administracion/permisos -H "Authorization: Bearer $TOKEN" | jq
```

### Seguridad (RNF03–RNF08, RNF16)

Sin token (debe dar 401):

```bash
curl $K -s -o /dev/null -w "%{http_code}\n" $API/gastos
```

Token falsificado (debe dar 401):

```bash
curl $K -s -o /dev/null -w "%{http_code}\n" $API/gastos -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwidiI6MX0.falsa"
```

Inyección SQL en el login (debe dar 400, "Correo o contraseña incorrectos"):

```bash
curl $K -s -X POST $API/auth/login -H "Content-Type: application/json" -d "{\"email\":\"' OR '1'='1' --\",\"password\":\"x\"}" | jq
```

Inyección SQL en un id (debe dar 400):

```bash
curl $K -s -X DELETE "$API/gastos/1%20OR%201=1" -H "Authorization: Bearer $TOKEN" | jq
```

XSS: la etiqueta `<script>` se elimina antes de guardar:

```bash
curl $K -s -X POST $API/gastos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"monto":10,"categoria_id":1,"metodo_pago_id":1,"descripcion":"<script>alert(1)</script>Prueba"}' | jq; curl $K -s "$API/gastos" -H "Authorization: Bearer $TOKEN" | jq '.gastos[0].descripcion'
```

Validación con mensaje claro (RNF21):

```bash
curl $K -s -X POST $API/gastos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"monto":-5}' | jq
```

JSON mal formado, sin detalles técnicos (RNF16):

```bash
curl $K -s -X POST $API/gastos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"monto":' | jq
```

Cabeceras de seguridad:

```bash
curl $K -s -D - -o /dev/null $API/health | grep -iE "strict-transport|x-frame|x-content|referrer|server-timing"
```

Escaneo de vulnerabilidades web (opcional):

```bash
nikto -h https://$IP:4000 -ssl
```

### Cierre de sesión (RNF05)

```bash
curl $K -s -X POST $API/auth/logout -H "Authorization: Bearer $TOKEN" | jq; curl $K -s -o /dev/null -w "token después de cerrar sesión: %{http_code}\n" $API/auth/me -H "Authorization: Bearer $TOKEN"
```

### Rendimiento (RNF09, RNF12)

```bash
for i in $(seq 1 20); do curl $K -s -o /dev/null -w "%{time_total}\n" "$API/gastos" -H "Authorization: Bearer $TOKEN"; done | sort -n | tail -1
```

```bash
time (for i in $(seq 1 100); do curl $K -s -o /dev/null -w "%{http_code}\n" $API/presupuestos -H "Authorization: Bearer $TOKEN" & done; wait) | sort | uniq -c
```
