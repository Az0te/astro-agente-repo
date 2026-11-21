"""Regenera el índice de tokens de guia/SKILL.md (fichas lineales y no lineales + su apartado del Anexo J).

Uso (desde la raíz del repo):  python pruebas/guia/indice_tokens.py          (reescribe el índice)
                                python pruebas/guia/indice_tokens.py --ver    (sólo enseña las cifras)

Cuenta con tiktoken (cl100k_base) si está instalado; si no, caracteres / 3,5. Las dos son aproximadas: el tokenizador
de cada modelo (Claude, Qwen…) da cifras algo distintas, pero sirven para repartir el contexto. Reescribe el bloque que
va desde «## Índice» hasta la línea «**Cómo en cada programa».
"""
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
GUIA = RAIZ / "guia"
SKILL = GUIA / "SKILL.md"
J = GUIA / "anexos" / "J-pixinsight"

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    CONTADOR = "tiktoken cl100k_base"

    def tokens(t):
        return len(_enc.encode(t))
except Exception:  # sin tiktoken o sin su tabla descargada
    CONTADOR = "caracteres / 3,5"

    def tokens(t):
        return round(len(t) / 3.5)


def redondear(n):
    return int(round(n / 10.0)) * 10


FICHAS = {
    "lineal": [
        ("1 Análisis del objeto", "01-analisis-del-objeto"), ("2 Inventario", "02-inventario"),
        ("3 Selección de subs", "03-blink-subframeselector"), ("4 Preprocesado", "04-preprocesado"),
        ("5 Alineado y recorte", "05-staralignment-crop"), ("6 HDR", "06-hdr-composition"),
        ("7 Extracción de canales", "07-extraccion-canales"), ("8 Astrometría", "08-plate-solve"),
        ("9 Gradiente", "09-correccion-gradiente"), ("10 Combinación RGB / NB, la inyección tras el 16", "10-combinacion-rgb-nb"),
        ("11 Deconvolución de corrección", "11-bxt-correct-only"), ("12 Calibración de color", "12-spcc"),
        ("13 Deconvolución completa", "13-bxt-completo"), ("14 Ruido suave", "14-noisex-suave"),
        ("15 Estrellas y ruido de la starless", "15-starx"), ("16 Sustracción de continuo", "16-linearfit-continuo"),
        ("17 Checkpoint", "17-checkpoint"),
    ],
    "no-lineal": [
        ("1 Estirado", "01-estirado"), ("2 LRGB / paleta", "02-lrgb-paleta"), ("3 Quitar verde", "03-scnr"),
        ("4 Máscaras", "04-mascaras"), ("5 Realces", "05-boost"), ("6 Ruido final", "06-noisex"),
        ("7 Nitidez", "07-nitidez"), ("8 Estrellas", "08-estrellas"), ("9 Recombinación", "09-recombinacion"),
        ("10 Recorte y exportación", "10-recorte-exportacion"), ("11 Dossier", "11-dossier"),
    ],
}


def apartados_j(fase):
    """{ 'lineal-01': tokens, … } partiendo el anexo J de la fase por sus anclas."""
    texto = (J / f"{fase}.md").read_text(encoding="utf-8")
    trozos = re.split(r'(?=<a id="(?:lineal|no-lineal)-\d\d"></a>)', texto)
    r = {}
    for t in trozos:
        m = re.match(r'<a id="((?:lineal|no-lineal)-\d\d)"></a>', t)
        if m:
            r[m.group(1)] = tokens(t)
    return r


def arranque_j():
    texto = (GUIA / "anexos" / "J-pixinsight.md").read_text(encoding="utf-8")
    ini = texto.find('<a id="arranque"></a>')
    fin = texto.find("## Nombres neutros")
    return tokens(texto[ini:fin if fin > 0 else None])


def bloque():
    lineas = [f"## Índice (cargar sólo el paso en curso; tokens aproximados, contados con {CONTADOR}; «J» = su apartado del Anexo J)", ""]
    lineas.append(f"**Se lee siempre:** SKILL.md ~{redondear(tokens(SKILL.read_text(encoding='utf-8')))} · arranque del "
                  f"[Anexo J](anexos/J-pixinsight.md#arranque) ~{redondear(arranque_j())}. **Con 32k de contexto, no cargar más de "
                  f"una ficha y su apartado de J a la vez.** Cifras regeneradas con `pruebas/guia/indice_tokens.py`.")
    lineas.append("")
    for fase, titulo in (("lineal", "Lineal"), ("no-lineal", "No lineal")):
        aj = apartados_j(fase)
        partes = []
        for etiqueta, base in FICHAS[fase]:
            n = tokens((GUIA / fase / f"{base}.md").read_text(encoding="utf-8"))
            ancla = f"{fase}-{base[:2]}"
            j = f" (J ~{redondear(aj[ancla])})" if ancla in aj else ""
            partes.append(f"[{etiqueta}]({fase}/{base}.md) ~{redondear(n)}{j}")
        lineas.append(f"**{titulo}:** " + " · ".join(partes))
        lineas.append("")
    return "\n".join(lineas) + "\n"


def main():
    nuevo = bloque()
    if "--ver" in sys.argv:
        print(nuevo)
        return
    s = SKILL.read_text(encoding="utf-8")
    ini = s.index("## Índice")
    fin = s.index("**Cómo en cada programa")
    s2 = s[:ini] + nuevo + s[fin:]
    if s2 != s:
        SKILL.write_text(s2, encoding="utf-8")
        # La línea «Se lee siempre» incluye el tamaño de SKILL.md, que acaba de cambiar: una pasada más lo estabiliza.
        s3 = SKILL.read_text(encoding="utf-8")
        s4 = s3[: s3.index("## Índice")] + bloque() + s3[s3.index("**Cómo en cada programa"):]
        SKILL.write_text(s4, encoding="utf-8")
    print(f"Índice regenerado ({CONTADOR})")
    print(bloque())


if __name__ == "__main__":
    main()
