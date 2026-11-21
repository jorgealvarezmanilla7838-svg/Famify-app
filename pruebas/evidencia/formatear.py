"""Formatea una respuesta JSON para la evidencia: sangría, tokens recortados y listas largas resumidas."""
import json
import os
import re
import sys

MAX_ITEMS = int(os.environ.get("MAX_ITEMS", "3"))
MAX_LINEAS = int(os.environ.get("MAX_LINEAS", "40"))


def recortar(valor):
    if isinstance(valor, dict):
        return {k: recortar(v) for k, v in valor.items()}
    if isinstance(valor, list):
        cortada = [recortar(v) for v in valor[:MAX_ITEMS]]
        if len(valor) > MAX_ITEMS:
            cortada.append(f"... ({len(valor) - MAX_ITEMS} elementos más)")
        return cortada
    if isinstance(valor, str) and re.fullmatch(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", valor):
        return valor[:20] + "…(token JWT)"
    return valor


texto = sys.stdin.buffer.read().decode("utf-8", "replace").strip()
try:
    salida = json.dumps(recortar(json.loads(texto)), ensure_ascii=False, indent=2)
except ValueError:
    salida = texto if texto else "(sin cuerpo)"
lineas = salida.splitlines()
if len(lineas) > MAX_LINEAS:
    lineas = lineas[:MAX_LINEAS] + [f"... ({len(lineas) - MAX_LINEAS} líneas más)"]
sys.stdout.buffer.write("\n".join(lineas).encode("utf-8"))
