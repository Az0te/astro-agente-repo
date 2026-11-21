"""Valida las llamadas del Anexo J (PixInsight) contra guia/herramientas/manifiesto.json.

Uso (desde la raíz del repo):  python pruebas/guia/validar_llamadas_anexo_j.py
Sale con código 1 si algo no casa.

1. Bloques ```json con {"llamadas": [{"funcion", "parametros"}]}: la función existe en el manifiesto (o es
   `estado`, que la da el propio servidor MCP en mcp/src/index.ts), los parámetros de primer nivel existen
   y están los obligatorios, y cada clave de `opciones` (y de los objetos anidados `calibracion` y `wbpp`)
   aparece en la descripción de ese parámetro en el manifiesto.
2. Llamadas en la prosa entre comillas invertidas, `funcion(..., { clave: valor, ... })`: si la función está
   en el manifiesto, cada clave del objeto de opciones tiene que aparecer en la descripción de sus opciones.
"""
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
GUIA = RAIZ / "guia"
MANIFIESTO = GUIA / "herramientas" / "manifiesto.json"
FICHEROS = [GUIA / "anexos" / "J-pixinsight.md", *sorted((GUIA / "anexos" / "J-pixinsight").glob("*.md"))]
DEL_SERVIDOR = {"estado": {"trabajo", "esperar_s"}}
OBJETOS_ANIDADOS = ("opciones", "calibracion", "wbpp")


def cargar_manifiesto():
    m = json.loads(MANIFIESTO.read_text(encoding="utf-8"))
    return {f["nombre"]: f for f in m["funciones"]}


def claves_documentadas(fun, param):
    desc = fun["params"].get("properties", {}).get(param, {}).get("description", "")
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", desc))


def validar_bloque(fun_nombre, parametros, man, donde, errores):
    if fun_nombre in DEL_SERVIDOR:
        for k in parametros:
            if k not in DEL_SERVIDOR[fun_nombre]:
                errores.append(f"{donde}: {fun_nombre} no tiene el parámetro '{k}'")
        return
    f = man.get(fun_nombre)
    if f is None:
        errores.append(f"{donde}: la función '{fun_nombre}' no está en el manifiesto")
        return
    props = f["params"].get("properties", {})
    for k in f["params"].get("required", []):
        if k not in parametros:
            errores.append(f"{donde}: {fun_nombre} sin el parámetro obligatorio '{k}'")
    for k, v in parametros.items():
        if k not in props:
            errores.append(f"{donde}: {fun_nombre} no tiene el parámetro '{k}' (tiene: {', '.join(props)})")
            continue
        if k in OBJETOS_ANIDADOS and isinstance(v, dict):
            doc = claves_documentadas(f, k)
            for kk in v:
                if kk not in doc:
                    errores.append(f"{donde}: {fun_nombre}.{k} no documenta la clave '{kk}'")


def bloques_json(texto):
    for m in re.finditer(r"```json\s*\n(.*?)```", texto, re.S):
        yield texto[: m.start()].count("\n") + 1, m.group(1)


# `funcion(arg, { a: 1, b, c: "x" })` dentro de comillas invertidas
LLAMADA_PROSA = re.compile(r"`([A-Za-z_]\w*)\(([^`]*)\)`")


def claves_objeto(argumentos):
    """Claves de primer nivel del ÚLTIMO objeto {…} de los argumentos (el de opciones)."""
    ini = argumentos.rfind("{")
    if ini < 0:
        return None
    # subir al { de nivel 1 que cierra al final
    nivel, inicio = 0, None
    for i, c in enumerate(argumentos):
        if c == "{":
            if nivel == 0:
                inicio = i
            nivel += 1
        elif c == "}":
            nivel -= 1
    if inicio is None:
        return None
    cuerpo = argumentos[inicio + 1:]
    cuerpo = cuerpo[: cuerpo.rfind("}")] if "}" in cuerpo else cuerpo
    claves, nivel, trozo = [], 0, ""
    for c in cuerpo + ",":
        if c in "{[(":
            nivel += 1
        elif c in "}])":
            nivel -= 1
        if c == "," and nivel == 0:
            t = trozo.strip()
            mm = re.match(r'"?([A-Za-z_]\w*)"?\s*(?::|$)', t)
            if mm and not t.startswith("…") and t not in ("...",):
                claves.append(mm.group(1))
            trozo = ""
        else:
            trozo += c
    return claves


def main():
    man = cargar_manifiesto()
    errores, n_bloques, n_llamadas, n_prosa = [], 0, 0, 0
    for fich in FICHEROS:
        texto = fich.read_text(encoding="utf-8")
        rel = fich.relative_to(RAIZ).as_posix()
        for linea, cuerpo in bloques_json(texto):
            n_bloques += 1
            donde = f"{rel}:{linea}"
            try:
                d = json.loads(cuerpo)
            except json.JSONDecodeError as e:
                errores.append(f"{donde}: JSON inválido ({e})")
                continue
            llamadas = d.get("llamadas") if isinstance(d, dict) else None
            if not isinstance(llamadas, list):
                errores.append(f"{donde}: el bloque no es {{\"llamadas\": [...]}}")
                continue
            for c in llamadas:
                n_llamadas += 1
                if set(c) - {"funcion", "parametros"} or "funcion" not in c:
                    errores.append(f"{donde}: llamada sin la forma {{funcion, parametros}}: {c}")
                    continue
                validar_bloque(c["funcion"], c.get("parametros", {}), man, donde, errores)
        for m in LLAMADA_PROSA.finditer(texto):
            nombre, args = m.group(1), m.group(2)
            if nombre not in man:
                continue
            claves = claves_objeto(args)
            if not claves:
                continue
            n_prosa += 1
            donde = f"{rel}:{texto[: m.start()].count(chr(10)) + 1}"
            props = man[nombre]["params"].get("properties", {})
            obj = "opciones" if "opciones" in props else next((k for k in OBJETOS_ANIDADOS if k in props), None)
            if obj is None:
                continue
            doc = claves_documentadas(man[nombre], obj)
            for k in claves:
                if k not in doc:
                    errores.append(f"{donde}: en la prosa, {nombre}(…, {{ {k} }}) no está en {obj} del manifiesto")
    print(f"{len(FICHEROS)} ficheros, {n_bloques} bloques JSON, {n_llamadas} llamadas, {n_prosa} llamadas en prosa con opciones")
    if errores:
        print(f"{len(errores)} errores:")
        for e in errores:
            print("  - " + e)
        sys.exit(1)
    print("OK: todas las llamadas casan con el manifiesto")


if __name__ == "__main__":
    main()
