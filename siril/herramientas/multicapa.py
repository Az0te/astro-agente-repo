# SirilAstroPilot — varios masters del mismo objeto: alinearlos, separar un dual band y combinar con el RGB.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# alinearMasters: registra varios masters (de noches o filtros distintos) contra el primero con los comandos de
#   secuencia de Siril (convert, setref, register, seqapplyreg -framing=min) y deja copias alineadas y recortadas a la
#   zona común en la carpeta pedida. Los ficheros del usuario no se tocan.
# desmezclarDualBand: de un master OSC con filtro dual band (Hα + OIII), capa Hα = canal rojo y capa OIII = media de
#   verde y azul (los dos ven OIII en una matriz Bayer), en lineal, como ficheros FITS mono.
# combinarCandidatos: sobre el RGB lineal cargado, compara formas de añadir la banda estrecha (sumar el exceso de Hα al
#   rojo, y opcionalmente el de OIII al azul y al verde) con varias intensidades; mide el contraste ganado en la
#   nebulosa, el ruido y la dominante del cielo y el cambio de color de las estrellas; recomienda. Patrón de candidatos
#   de pasos.py: la imagen no cambia hasta aplicarCandidato(id).

import re
import shutil
import time
from pathlib import Path

import numpy as np

import herramientas as H
import pasos as P

ALINEADO = H.DATOS / "alineado"
_r = H._r


def _a_crudo(q, info, crudo):
    """Pantalla (fila 0 arriba) → array de Siril con el tipo y la forma del original."""
    x = q if info["top_down"] else q[:, ::-1, :]
    return P._a_siril(np.clip(x, 0, 1), crudo.dtype).reshape(crudo.shape)


def _transformaciones(ruta_seq):
    """Matriz de registro (líneas «R… H a b c d e f g h i») de cada imagen: desplazamiento y giro respecto a la referencia."""
    out = []
    for linea in Path(ruta_seq).read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"R\d+\s+(?:\S+\s+){6}H\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)", linea)
        if m:
            a, b, c, d, e, f = (float(x) for x in m.groups())
            out.append({"dx_px": _r(c, 1), "dy_px": _r(f, 1), "giro_grados": _r(float(np.degrees(np.arctan2(d, a))), 2),
                        "escala": _r(float(np.hypot(a, d)), 4)})
    return out


def _mascara_datos(L, b=8):
    """True donde hay datos. Sin datos = bloques b×b planos (sin ruido: relleno constante del apilado o del registro), por
    debajo de media mediana y conectados con el borde. Así no cuentan las nebulosas oscuras (tienen ruido), los núcleos
    saturados (planos pero altos) ni manchas interiores. 11 nov 2026: con «< 2 % de la mediana» no se veía el relleno de
    un apilado (un valor bajo pero no 0) y con «< 25 %» se marcaban nebulosas oscuras del interior."""
    L = np.nan_to_num(np.asarray(L, dtype=np.float64), nan=0.0, posinf=1.0, neginf=0.0)
    H_, W_ = L.shape
    med = float(np.median(L[::4, ::4]))
    d = L[:, 1:] - L[:, :-1]
    ruido = 1.4826 * float(np.median(np.abs(d[::4, ::4]))) / np.sqrt(2)
    hb, wb = H_ // b, W_ // b
    blk = L[:hb * b, :wb * b].reshape(hb, b, wb, b)
    sd, mn = blk.std(axis=(1, 3)), blk.mean(axis=(1, 3))
    vacio = ((sd < 0.2 * max(ruido, 1e-12)) & (mn < 0.5 * med)) | (mn < 1e-6)
    c = np.zeros_like(vacio)
    c[0, :], c[-1, :] = vacio[0, :], vacio[-1, :]
    c[:, 0] |= vacio[:, 0]
    c[:, -1] |= vacio[:, -1]
    for _ in range(hb + wb):                           # crecer desde el borde por bloques vacíos contiguos
        n = c.copy()
        n[1:] |= c[:-1]; n[:-1] |= c[1:]; n[:, 1:] |= c[:, :-1]; n[:, :-1] |= c[:, 1:]
        n &= vacio
        if (n == c).all():
            break
        c = n
    datos = np.ones((H_, W_), bool)
    datos[:hb * b, :wb * b] = ~np.kron(c, np.ones((b, b), bool))
    return datos


def alinearMasters(siril, ficheros, carpeta=None, referencia=1):
    """Paso 5 lineal: alinea los masters contra el de 'referencia' (1 = el primero) y los recorta a la zona común."""
    if isinstance(ficheros, str):
        ficheros = [x.strip() for x in ficheros.split(";") if x.strip()]
    fs = [H._ruta(f, "ficheros") for f in ficheros]
    if len(fs) < 2:
        raise ValueError("alinearMasters necesita al menos dos ficheros.")
    for f in fs:
        if not f.is_file():
            raise FileNotFoundError(f"No existe {f}.")
    destino = H._ruta(carpeta, "carpeta") if carpeta else fs[0].parent / "alineados"
    destino.mkdir(parents=True, exist_ok=True)
    trabajo = ALINEADO / time.strftime("%Y%m%d_%H%M%S")
    ent, proc = trabajo / "entrada", trabajo / "proc"
    ent.mkdir(parents=True, exist_ok=True)
    proc.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    for i, f in enumerate(fs, 1):                      # FITS de trabajo m_0000N (XISF leídos con lectura propia)
        siril.cmd("load", H._arg_cmd(H.ruta_legible(f)[0]))
        siril.cmd("save", H._arg_cmd(ent / f"m_{i:05d}"))
    siril.cmd("cd", H._arg_cmd(ent))
    siril.cmd("convert", "m", "-out=../proc")
    siril.cmd("cd", H._arg_cmd(proc))
    siril.cmd("setref", "m", str(int(referencia)))
    siril.cmd("register", "m")
    siril.cmd("seqapplyreg", "m", "-framing=min")
    hechos = sorted(proc.glob("r_m_*.fit*"))
    if len(hechos) != len(fs):
        raise RuntimeError(f"Sólo se alinearon {len(hechos)} de {len(fs)} masters: alguno no tiene estrellas suficientes en "
                           "común con la referencia. Mira el registro de Siril.")
    salidas = []
    for f, h in zip(fs, hechos):
        dst = destino / f"{f.stem}_alin.fit"
        k = 2
        while dst.exists():
            dst = destino / f"{f.stem}_alin_{k}.fit"
            k += 1
        shutil.copy2(h, dst)
        salidas.append(str(dst))
    try:
        from apilado import _fichero_seq
        tr = _transformaciones(_fichero_seq(proc, "m"))
    except Exception:
        tr = []
    # Recorte común con datos en TODOS: seqapplyreg deja el marco común, pero cada master puede traer sus propias cuñas
    # de apilado (11 nov 2026: el RGB tenía 84/36/32/120 px sin datos y el dual band 8; quedaban dentro y el gradiente las
    # detectaba). Máscara de datos de cada uno, intersección, rectángulo sin cuñas y mismo recorte para todos.
    siril.cmd("load", H._arg_cmd(Path(salidas[0])))
    info0 = H._info(siril)
    datos, cabeceras, arrs = None, [], []
    for s in salidas:
        siril.cmd("load", H._arg_cmd(Path(s)))
        cabeceras.append(siril.get_image_fits_header() or "")
        a = P._leer_fichero(siril, Path(s), info0)
        arrs.append(a)
        m = _mascara_datos(a.mean(axis=0))
        datos = m if datos is None else (datos & m)
    x0, y0, x1, y1 = P._rect_con_datos(datos, info0["ancho"], info0["alto"])
    if (x1 - x0) < info0["ancho"] * 0.5 or (y1 - y0) < info0["alto"] * 0.5:
        raise RuntimeError(f"La zona común con datos es menor que la mitad ({x1 - x0}×{y1 - y0}): ¿están bien alineados?")
    for s, a, cab in zip(salidas, arrs, cabeceras):
        rec = np.ascontiguousarray(a[:, y0:y1, x0:x1], dtype=np.float32)
        siril.save_image_file(rec if rec.shape[0] > 1 else rec[0], cab, str(s))
    siril.cmd("load", H._arg_cmd(Path(salidas[0])))
    # Los originales ya tienen su versión alineada: dejan de contar como «masters abiertos sin alinear» (IC 1396, 14 nov
    # 2026: el RGB abierto para analizarlo frenaba el gradiente de las capas unidas después de alinear).
    for f in fs:
        for k in [k for k, v in H.MASTERS_ABIERTOS.items() if H._clave(v) == H._clave(f) or k == H._clave(f)]:
            H.MASTERS_ABIERTOS.pop(k, None)
    info = H._info(siril)
    if (info["ancho"], info["alto"]) != (x1 - x0, y1 - y0):
        raise RuntimeError(f"El recorte común no se aplicó ({info['ancho']}×{info['alto']} en vez de {x1 - x0}×{y1 - y0}).")
    _anotar_alineados(salidas)
    return {"alineados": salidas, "referencia": str(fs[int(referencia) - 1]), "transformaciones": tr,
            "recorte_comun": {"rect_en_el_alineado": [x0, y0, x1, y1], "quita_px": {"izquierda": x0, "arriba": y0,
                              "derecha": info0["ancho"] - x1, "abajo": info0["alto"] - y1}},
            "tam_comun": [info["ancho"], info["alto"]], "segundos": _r(time.perf_counter() - t0, 1),
            "nota": "Alineados y recortados todos al mismo rectángulo con datos en todos (sin cuñas): no hace falta "
                    "recortarBordes en ninguno. Queda cargado el primero. Sigue con cada master por su fase lineal; el dual "
                    "band, separado con desmezclarDualBand."}


# Respuesta de cada canal del IMX571 (ASI2600MC) a cada raya, la misma que SetiAstroPilot y el dosier de PixInsight de
# IC 1396 (emulando DBXtract). Con dos rayas por filtro y tres canales se separan por mínimos cuadrados (pseudoinversa).
RESPUESTA_IMX571 = {"Ha": (0.80, 0.11, 0.04), "OIII": (0.04, 0.93, 0.50), "SII": (0.74, 0.13, 0.05),
                    "Hb": (0.01, 0.67, 0.70)}
FILTROS_DUAL = [(("s2hb", "shb", "siihb", "s2-hb"), ("SII", "Hb")),
                (("s2o3", "so3", "siioiii", "s2-o3"), ("SII", "OIII")),
                (("hao3", "ha-o3", "haoiii", "l-extreme", "l-enhance", "alp-t", "dual"), ("Ha", "OIII"))]


def _rayas_del_filtro(texto):
    t = (texto or "").lower().replace(" ", "").replace("_", "").replace("/", "").replace("-", "")
    for claves, rayas in FILTROS_DUAL:
        if any(k.replace("-", "") in t for k in claves):
            return rayas
    return None


def _fondo_por_canal(p):
    """Percentil 0,2 de cada canal en binning 16×16: fondo que se resta antes de separar las rayas."""
    c, h, w = p.shape
    h16, w16 = h // 16 * 16, w // 16 * 16
    b = p[:, :h16, :w16].reshape(c, h16 // 16, 16, w16 // 16, 16).mean(axis=(2, 4))
    return [float(np.percentile(b[i], 0.2)) for i in range(c)]


def desmezclarDualBand(siril, fichero=None, carpeta=None, nombre=None, filtro=None, quitar_patron=True):
    """Paso 7 lineal: separa las dos rayas de un master OSC dual band (HaO3 → Hα y OIII; S2Hb → SII y Hβ; S2O3 → SII y
    OIII), en lineal, como FITS mono. Con el filtro reconocido (nombre, FILTER o 'filtro'), por mínimos cuadrados con la
    respuesta del IMX571 tras restar el fondo de cada canal (como DBXtract); si no, Hα = rojo y OIII = (verde + azul)/2.
    Con 'fichero', al terminar vuelve a dejar cargada la imagen que había (11 nov 2026: dejaba cargado el dual band, el
    modelo creyó que seguía el RGB y le hizo gradiente, astrometría, color y estirado al dual band)."""
    previa, crudo_previo, huella_previa = None, None, None
    if fichero:
        try:
            previa = siril.get_image_filename()
            crudo_previo = P._crudo(siril)
            huella_previa = P._huella(crudo_previo)
        except Exception:
            previa = None
        siril.cmd("load", H._arg_cmd(H._ruta(fichero, "fichero")))
    if fichero and recorte_revisado(str(H._ruta(fichero, "fichero"))) is False:
        if previa:
            siril.cmd("load", H._arg_cmd(Path(previa)))
        raise RuntimeError("Este dual band viene de masters alineados sin revisarRecorte: haz antes revisarRecorte(ficheros de los alineados) y desmezcla el *_rec.fit. Si separas antes, las capas quedan con las franjas de borde y hay que recortarlas a mano igual que el RGB (IC 405, 19 nov 2026).")
    info = H._info(siril)
    if info["canales"] != 3:
        raise RuntimeError("desmezclarDualBand necesita el master dual band en color (3 canales).")
    crudo = P._crudo(siril)
    p = P._de_siril(crudo)                             # orden de filas de Siril: se guarda igual
    if not P._lineal(P._pantalla(crudo, info)):
        raise RuntimeError("El dual band parece estirado: se separa en lineal (Paso 7, antes del gradiente y del color).")
    cab = siril.get_image_fits_header() or ""
    mf = re.search(r"FILTER\s*=\s*'([^']*)'", cab)
    rayas = _rayas_del_filtro(filtro or f"{Path(fichero or info.get('fichero') or '').stem} {mf.group(1) if mf else ''}")
    if rayas is None:
        capas = (("Ha", p[0].astype(np.float32)), ("OIII", (0.5 * (p[1] + p[2])).astype(np.float32)))
        metodo = "Hα = rojo; OIII = (verde + azul) / 2 (filtro no reconocido: pasa filtro='HaO3', 'S2Hb' o 'S2O3')"
    else:
        A = np.array([RESPUESTA_IMX571[x] for x in rayas], dtype=np.float64).T
        Pi = np.linalg.pinv(A)
        q = p - np.array(_fondo_por_canal(p), dtype=np.float32)[:, None, None]
        capas = []
        for i, raya in enumerate(rayas):
            c = Pi[i, 0] * q[0] + Pi[i, 1] * q[1] + Pi[i, 2] * q[2]
            c = c - float(np.percentile(c[::8, ::8], 0.1)) + 1e-4
            capas.append((raya, np.clip(c, 0, 1).astype(np.float32)))
        metodo = "mínimos cuadrados con la respuesta del IMX571 (" + "; ".join(
            f"{x} = " + " ".join(f"{Pi[i, j]:+.4f}·{'RGB'[j]}" for j in range(3)) for i, x in enumerate(rayas)) + ")"
    if quitar_patron:                      # malla de 2 px de la matriz Bayer (se ve tras un denoise fuerte; 15 nov 2026)
        limpias, pct = [], []
        for etiqueta, capa in capas:
            pt = P._patron_2px(capa)
            hp = capa - P._caja(capa, 1)
            pct.append(f"{etiqueta} {_r(100.0 * float(np.std(pt[::3, ::3])) / max(float(np.std(hp[::3, ::3])), 1e-12), 2)} %")
            limpias.append((etiqueta, np.clip(capa - pt, 0, 1).astype(np.float32)))
        capas = limpias
        metodo += "; quitado el patrón fijo de 2 px de la matriz Bayer (" + ", ".join(pct) + " de la escala fina)"
    base = Path(fichero).stem if fichero else (nombre or "dualband")
    destino = H._ruta(carpeta, "carpeta") if carpeta else (Path(fichero).parent if fichero else H.DATOS / "capas")
    destino.mkdir(parents=True, exist_ok=True)
    out = {}
    for etiqueta, capa in capas:
        ruta = destino / f"{base}_{etiqueta}.fit"
        k = 2
        while ruta.exists():
            ruta = destino / f"{base}_{etiqueta}_{k}.fit"
            k += 1
        siril.save_image_file(capa, cab, str(ruta))
        H.GUARDADOS.add(H._clave(ruta))             # capa de un master, no otro master (freno del Paso 5)
        c = P._cielo(capa[np.newaxis])
        ruido = c["ruido_rel"] * c["cielo"]
        senal = float(np.percentile(capa[::3, ::3], 99.5)) - c["cielo"]
        out[etiqueta] = {"fichero": str(ruta), "cielo": c["cielo"], "ruido": _r(ruido, 6),
                         "senal_p995_en_ruidos": _r(senal / max(ruido, 1e-9), 1)}
        _anotar_origen(ruta, [fichero or info.get("fichero")])
    cargada = H._info(siril).get("fichero")
    if previa and Path(previa).is_file():
        siril.cmd("load", H._arg_cmd(Path(previa)))
        if crudo_previo is not None and P._huella(P._crudo(siril)) != huella_previa:
            P._restaurar(siril, crudo_previo)              # tenía cambios sin guardar: se reponen
        cargada = previa
    return {"capas": out, "metodo": metodo,
            "imagen_cargada": cargada,
            "nota": f"Queda cargada: {Path(cargada).name if cargada else '¿?'}. Capas lineales: cada una sigue la fase "
                    "lineal (gradiente, ruido suave) abriéndola con abrirImagen. Con varios dual band, las capas de la misma "
                    "raya se juntan con unirCapas. Para combinar con el RGB: combinarCandidatos(ha, oiii) con el RGB lineal "
                    "cargado y ya calibrado de color; para una paleta, paletasCandidatos con todas las rayas."}


# --- revisión del recorte: obligatoria antes del gradiente (igual que SetiAstroPilot) ---------------------------
# Rafael (16 nov 2026): «hay que checkear bien los recortes antes de seguir con los gradientes». IC 1396: franjas de
# cobertura parcial (más ruido, menos subs) de hasta 128 px; el gradiente se ajustaba mal y la esquina salió cian.

def _esquinas_jpg(p, ruta, lado=256):
    from PIL import Image
    q = p
    if P._lineal(p[:, ::8, ::8]):
        med = np.median(p[:, ::8, ::8], axis=(1, 2), keepdims=True)
        mad = np.median(np.abs(p[:, ::8, ::8] - med), axis=(1, 2), keepdims=True) * 1.4826
        q = np.clip((p - (med - 2.8 * mad)) / np.maximum(12 * mad, 1e-9), 0, 1)
    c, h, w = q.shape
    L = min(lado, h // 2, w // 2)
    trozos = [q[:, :L, :L], q[:, :L, w - L:], q[:, h - L:, :L], q[:, h - L:, w - L:]]
    lienzo = np.zeros((3, 2 * L + 4, 2 * L + 4), np.float32)
    for k, t in enumerate(trozos):
        t3 = np.repeat(t, 3, axis=0) if t.shape[0] == 1 else t
        y, x = (k // 2) * (L + 4), (k % 2) * (L + 4)
        lienzo[:, y:y + L, x:x + L] = t3
    Image.fromarray((np.clip(np.moveaxis(lienzo, 0, -1), 0, 1) * 255).astype(np.uint8)).save(ruta, quality=90)
    return str(ruta)


def revisarRecorte(siril, ficheros, carpeta=None, aplicar=True, margen=8, umbral_ruido=1.25):
    """Paso 5b lineal (OBLIGATORIO antes del gradiente): revisa los bordes de los masters alineados (cobertura por el
    ruido en cada canal, franjas de 8/32/64 px frente al interior, mosaico de esquinas), propone el recorte común (lo
    peor de cada lado + margen) y, con aplicar, guarda <nombre>_rec.fit recortados igual. La imagen cargada no cambia.
    Igual que revisarRecorte de SetiAstroPilot."""
    if isinstance(ficheros, str):
        ficheros = [x.strip() for x in ficheros.split(";") if x.strip()]
    fs = [H._ruta(f, "ficheros") for f in ficheros]
    previa = None
    try:
        previa = siril.get_image_filename()
    except Exception:
        pass
    if not previa:
        siril.cmd("load", H._arg_cmd(H.ruta_legible(fs[0])[0]))
    info = H._info(siril)
    lados = {"izquierda": 0, "derecha": 0, "arriba": 0, "abajo": 0}
    datos, por_fichero, forma = [], {}, None
    for f in fs:
        d = P._leer_fichero(siril, H.ruta_legible(f)[0], info)          # orden de filas de Siril
        disp = d if info["top_down"] else d[:, ::-1, :]                    # fila 0 arriba
        if forma is None:
            forma = disp.shape[1:]
        elif disp.shape[1:] != forma:
            raise RuntimeError(f"{f.name} mide {disp.shape[2]}×{disp.shape[1]} y el primero {forma[1]}×{forma[0]}: alinéalos antes.")
        cob = {}
        for i in range(disp.shape[0]):
            for k, v in P._cobertura_ruido(disp[i], umbral=umbral_ruido).items():
                cob[k] = max(cob.get(k, 0), v)
        for k in lados:
            lados[k] = max(lados[k], cob[k])
        por_fichero[f.name] = {"cobertura_ruido_px": cob, "franjas_antes": P._franjas_borde(disp)}
        try:
            cab = siril.load_image_from_file(str(H.ruta_legible(f)[0])).header or ""
        except Exception:
            cab = ""
        datos.append((f, d, disp, cab))
    h, w = forma
    m = int(margen)
    x0, x1 = lados["izquierda"] + m, w - lados["derecha"] - m
    y0, y1 = lados["arriba"] + m, h - lados["abajo"] - m
    if (x1 - x0) < 0.7 * w or (y1 - y0) < 0.7 * h:
        raise RuntimeError(f"El recorte propuesto deja menos del 70 % ({x1 - x0}×{y1 - y0} de {w}×{h}): revisa los masters "
                           f"(cobertura por lado: {lados}).")
    destino = H._ruta(carpeta, "carpeta") if carpeta else fs[0].parent
    destino.mkdir(parents=True, exist_ok=True)
    prev = H.DATOS / "previas"
    prev.mkdir(parents=True, exist_ok=True)
    salidas, fallos = [], []
    for f, d, disp, cab in datos:
        rec_disp = np.ascontiguousarray(disp[:, y0:y1, x0:x1], dtype=np.float32)
        fr = P._franjas_borde(rec_disp)
        por_fichero[f.name]["franjas_despues"] = fr
        por_fichero[f.name]["esquinas_jpg"] = _esquinas_jpg(rec_disp, prev / f"recorte_{re.sub(r'[^\w.-]', '_', f.stem)}.jpg")
        for lado, filas in fr.items():
            d8 = filas["8px"]
            if max(d8["sigma_rel"]) > 1.5:
                fallos.append(f"{f.name}: franja de 8 px {lado} con ruido ×{max(d8['sigma_rel'])}")
            if rec_disp.shape[0] == 3 and d8["dominante_pct"] > 15:
                fallos.append(f"{f.name}: franja de 8 px {lado} con dominante {d8['dominante_pct']} %")
        if aplicar:
            rec = rec_disp if info["top_down"] else rec_disp[:, ::-1, :]
            dst = destino / f"{f.stem}_rec.fit"
            k = 2
            while dst.exists():
                dst = destino / f"{f.stem}_rec_{k}.fit"
                k += 1
            if not str(cab).strip():
                cab = "SIMPLE  =                    T\nBITPIX  =                  -32\nNAXIS   =                    2\nEND"
            siril.save_image_file(np.ascontiguousarray(rec if rec.shape[0] > 1 else rec[0]), cab, str(dst))
            H.GUARDADOS.add(H._clave(dst))
            salidas.append(str(dst))
            _anotar_origen(dst, [f])
    if aplicar:
        e = _estado()
        e["alineados"] = [_raiz(s) for s in salidas]
        e["recorte_ok"] = [_raiz(s) for s in salidas] if not fallos else []
        _guardar_estado(e)
    return {"pasa": not fallos, "fallos": fallos, "cobertura_por_lado_px": lados, "margen_px": m,
            "recorte": [x0, y0, x1, y1], "quita_px": {"izquierda": x0, "derecha": w - x1, "arriba": y0, "abajo": h - y1},
            "tam": [x1 - x0, y1 - y0], "recortados": salidas, "por_fichero": por_fichero,
            "nota": ("Mira los mosaicos de esquinas (esquinas_jpg) antes de seguir. Usa los *_rec.fit para todo lo demás. "
                     "Si los masters llevaban astrometría, vuelve a resolver el RGB recortado antes del color.") if not fallos else
                    "NO PASA: revisa los fallos y las esquinas; sube el margen o recorta a mano antes del gradiente."}


def recorte_revisado(fuente):
    """True si la fuente viene de masters que pasaron revisarRecorte; False si viene de la última alineación sin revisar;
    None si no se sabe (otro trabajo)."""
    try:
        e = _estado()
        if not e.get("alineados") or not fuente:
            return None
        raices = _raices(fuente, e)
        if any(a in r for r in raices for a in (e.get("recorte_ok") or [])):
            return True
        return False if any(a in r for r in raices for a in e["alineados"]) else None
    except Exception:
        return None


# --- procedencia: qué masters alineados acaban en cada capa (igual que SetiAstroPilot) ---------------------
# IC 1396 (14 nov 2026): las versiones de Siril y SASpro usaron sólo el RGB y el HaO3; el SHb y el SO3 quedaron fuera
# sin que nada avisara. alinearMasters guarda qué alineó; desmezclar y unirCapas, de qué ficheros sale cada capa; y
# combinar, combinarRGB y paletas avisan del master alineado que no entra.

def _estado_ruta():
    return H.DATOS / "trabajo" / "procedencia.json"


def _estado():
    import json
    try:
        return json.loads(_estado_ruta().read_text(encoding="utf-8"))
    except Exception:
        return {"alineados": [], "origen": {}}


def _guardar_estado(e):
    import json
    r = _estado_ruta()
    r.parent.mkdir(parents=True, exist_ok=True)
    r.write_text(json.dumps(e, ensure_ascii=False, indent=1), encoding="utf-8")


def _raiz(nombre):
    s = Path(str(nombre)).name
    for ext in (".xisf", ".fits", ".fit", ".fts", ".tif", ".tiff"):
        if s.lower().endswith(ext):
            s = s[: -len(ext)]
    return s.lower()


# Guarda inyección frente a paleta (20 nov 2026): con un master RGB de banda ancha alineado, la guía pide inyectar la banda
# estrecha en el RGB (combinarCandidatos); dos pasadas eligieron paleta igualmente aunque el prompt lo decía. Se decide por
# el filtro del nombre del master alineado (FILTER-NoFilter, L, RGB… frente a Ha, OIII, HaO3, SiO3, dual band…).
_NB = __import__("re").compile(r"(ha|o3|oiii|s2|sii|hb|dual|duo|tri|quad|lex|lultimate|nbz|alp|enhance)", __import__("re").I)


def _rgb_banda_ancha():
    import re
    for a in (_estado().get("alineados") or []):
        m = re.search(r"filter[-_]([a-z0-9]+)", str(a), re.I)
        f = m.group(1) if m else ""
        if f and not _NB.search(f):
            return a
    return None


def _negar_paleta(forzar, ha=None, oiii=None, vista=None):
    rgb = _rgb_banda_ancha()
    if rgb and not forzar:
        # 21 nov 2026: tras la negativa genérica el modelo rehízo las capas desde cero y exportó el RGB solo. Se le da
        # la llamada exacta con los mismos ids que acaba de pasar.
        llamada = "combinarCandidatos(ha='" + str(ha) + "', oiii='" + str(oiii) + "') con la RGB estirada cargada"
        raise RuntimeError(f"Hay un master RGB de banda ancha alineado ({rgb}): con RGB que aporta color real la guía pide "
                           "inyectar la banda estrecha en el RGB, no componer una paleta (pierde el azul de reflexión y el "
                           "color real). Tus capas ya están listas: NO las rehagas (ni desmezclar, ni gradiente, ni ruido, ni "
                           f"estirado otra vez). Llama ahora a {llamada} y después aplicarCandidato con el recomendado; "
                           "luego estrellas, fondo y exportar. forzar: true sólo si el usuario ha pedido una paleta.")


def _anotar_alineados(ficheros):
    try:
        e = _estado()
        e["alineados"] = [_raiz(f) for f in ficheros]
        e["recorte_ok"] = []                  # alineación nueva: falta revisarRecorte
        _guardar_estado(e)
    except Exception:
        pass


def _anotar_origen(fichero, fuentes):
    try:
        e = _estado()
        e.setdefault("origen", {})[_raiz(fichero)] = [_raiz(f) for f in fuentes if f]
        _guardar_estado(e)
    except Exception:
        pass


def _raices(nombre, e, prof=0):
    r = _raiz(nombre)
    fuentes = e.get("origen", {}).get(r)
    if not fuentes or prof > 8:
        return {r}
    out = {r}
    for f in fuentes:
        out |= _raices(f, e, prof + 1)
    return out


def aviso_sin_usar(usadas):
    """Aviso si algún master de la última alineación no entra (directa o indirectamente) en los ficheros usados."""
    try:
        e = _estado()
        if not e.get("alineados"):
            return None
        raices = set()
        for v in usadas:
            if v:
                raices |= _raices(v, e)
        usados = [a for a in e["alineados"] if any(a in r for r in raices)]
        if not usados:                  # no se sabe de dónde salen (otra sesión, ficheros sueltos): sin aviso
            return None
        faltan = [a for a in e["alineados"] if a not in usados]
    except Exception:
        return None
    if not faltan:
        return None
    return ("Masters alineados que NO entran en esta combinación: " + ", ".join(faltan) + ". Si llevan señal de estas "
            "rayas, sepáralos (desmezclarDualBand) y júntalos con la capa de la misma raya (unirCapas): más señal, "
            "textura más suave.")


def _ruido_fino(x):
    hp = (x - P._caja(x, 2))[::3, ::3]
    return 1.4826 * float(np.median(np.abs(hp - np.median(hp))))


def unirCapas(siril, ficheros, nombre=None, carpeta=None):
    """Paso 7 lineal: junta capas mono lineales y alineadas de la MISMA raya que salen de masters distintos (OIII del HaO3 y
    del S2O3; SII del S2Hb y del S2O3). Cada una se lleva a la escala y nivel de la de mejor señal/ruido (ajuste ortogonal
    sobre las capas suavizadas, sin estrellas) y se promedian con pesos 1/σ². Guarda un FITS nuevo; la imagen cargada no
    cambia. Igual que unirCapas de SetiAstroPilot (14 nov 2026)."""
    if isinstance(ficheros, str):
        ficheros = [x.strip() for x in ficheros.split(";") if x.strip()]
    fs = [H._ruta(f, "ficheros") for f in ficheros]
    if len(fs) < 2:
        raise ValueError("unirCapas necesita al menos dos ficheros de la misma raya.")
    info = H._info(siril)
    capas = []
    for f in fs:
        d = P._leer_fichero(siril, f, info)
        capas.append((d.mean(axis=0) if d.shape[0] > 1 else d[0]).astype(np.float32))
    forma = capas[0].shape
    for f, c in zip(fs, capas):
        if c.shape != forma:
            raise RuntimeError(f"{f.name} mide {c.shape[1]}×{c.shape[0]} y {fs[0].name} {forma[1]}×{forma[0]}: alinéalas antes.")
        if not P._lineal(c[None, ::8, ::8]):
            raise RuntimeError(f"{f.name} parece estirada: las capas se juntan en lineal.")
    snr = [(float(np.percentile(c[::4, ::4], 99.5)) - float(np.median(c[::4, ::4]))) / max(_ruido_fino(c), 1e-12)
           for c in capas]
    iref = int(np.argmax(snr))
    ref = capas[iref]
    hp = ref - P._caja(ref, 5)
    shp = 1.4826 * float(np.median(np.abs(hp[::4, ::4])))
    util = (np.abs(hp) < 5 * max(shp, 1e-12)) & (ref < float(np.percentile(ref[::4, ::4], 99.8)))
    util = P._caja(util.astype(np.float32), 6) > 0.999
    util[::2, :] = False
    util[:, ::2] = False
    ref_s = P._suave(ref, 16)
    ajustadas, info_c = [], []
    for i, (f, c) in enumerate(zip(fs, capas)):
        if i == iref:
            a, b = 1.0, 0.0
        else:
            c_s = P._suave(c, 16)
            m = util & (c < float(np.percentile(c[::4, ::4], 99.8)))
            x, y = c_s[m].astype(np.float64), ref_s[m].astype(np.float64)
            mx, my = x.mean(), y.mean()
            sxx, syy, sxy = ((x - mx) ** 2).mean(), ((y - my) ** 2).mean(), ((x - mx) * (y - my)).mean()
            a = (syy - sxx + np.sqrt((syy - sxx) ** 2 + 4 * sxy ** 2)) / (2 * sxy) if sxy > 0 else 1.0
            b = my - a * mx
        q = (a * c + b).astype(np.float32)
        ajustadas.append(q)
        info_c.append({"fichero": str(f), "escala": _r(float(a), 4), "nivel": _r(float(b), 6), "snr": _r(snr[i], 1),
                       "ruido": _ruido_fino(q)})
    w = np.array([1.0 / max(x["ruido"], 1e-12) ** 2 for x in info_c])
    w = w / w.sum()
    out = np.zeros(forma, np.float32)
    for wi, q in zip(w, ajustadas):
        out += np.float32(wi) * q
    out = np.clip(out, 0, 1)
    baja = 100.0 * (1 - _ruido_fino(out) / max(info_c[iref]["ruido"], 1e-12))
    for x, wi in zip(info_c, w):
        x["peso_pct"] = _r(100.0 * float(wi), 1)
        x["ruido"] = _r(x["ruido"], 7)
    destino = H._ruta(carpeta, "carpeta") if carpeta else fs[iref].parent
    destino.mkdir(parents=True, exist_ok=True)
    ruta = destino / f"{nombre or (fs[iref].stem + '_unida')}.fit"
    k = 2
    while ruta.exists():
        ruta = destino / f"{nombre or (fs[iref].stem + '_unida')}_{k}.fit"
        k += 1
    # Con cabecera vacía Siril no contesta y sirilpy corta por tiempo (14 nov 2026): la de la capa de referencia.
    try:
        cab = siril.load_image_from_file(str(fs[iref])).header or ""
    except Exception:
        cab = ""
    if not cab.strip():
        cab = "SIMPLE  =                    T\nBITPIX  =                  -32\nNAXIS   =                    2\nEND"
    siril.save_image_file(out.astype(np.float32), cab, str(ruta))
    H.GUARDADOS.add(H._clave(ruta))
    _anotar_origen(ruta, fs)
    return {"fichero": str(ruta), "referencia": str(fs[iref]), "capas": info_c, "ruido_baja_pct": _r(baja, 1),
            "nota": "Capa unida (lineal). Sigue con su gradiente (abrirImagen + gradienteCandidatos) como cualquier capa; "
                    "la imagen cargada no ha cambiado."}


def _excesos(base, nb, cielo_px, estrellas_px, obj_px):
    """Banda estrecha llevada a la escala del canal de banda ancha (cielo restado y ajuste en la nebulosa: mediana del
    cociente canal / banda estrecha donde ésta tiene señal clara, sin estrellas) y exceso sobre el canal: sólo lo que la
    banda estrecha tiene de más, con su mejor relación señal/ruido. Escalar por el ruido del cielo lo multiplicaba por 20
    y quemaba la nebulosa (prueba del 11 nov 2026)."""
    mb, mn = float(np.median(base[cielo_px])), float(np.median(nb[cielo_px]))
    sn = 1.4826 * float(np.median(np.abs(nb[cielo_px] - mn)))
    zona = obj_px & ~estrellas_px & ((nb - mn) > 3 * max(sn, 1e-9))
    if zona.sum() < 500:
        zona = ~estrellas_px & ((nb - mn) > 3 * max(sn, 1e-9))
    k = float(np.median((base[zona] - mb) / np.maximum(nb[zona] - mn, 1e-9))) if zona.sum() >= 100 else 1.0
    k = float(np.clip(k, 0.05, 20))
    nb_n = (nb - mn) * k
    ex = np.clip(nb_n - (base - mb), 0, None)
    # Sólo donde la banda estrecha tiene señal: en el cielo el «exceso» es ruido y sumarlo sesga el fondo (rampa suave
    # entre 1,5 y 3 σ para que no quede borde).
    peso = np.clip(((nb - mn) / max(sn, 1e-9) - 1.5) / 1.5, 0, 1)
    ex = ex * peso
    ex[estrellas_px] = 0                               # las estrellas, del RGB (en banda estrecha salen distintas)
    return ex, _r(k, 4)


def _flujos_estrellas(base, nb, max_n=600):
    """Flujo de apertura (radio 4 px, fondo en el anillo 6–9 px) de las mismas estrellas en el canal de banda ancha y en
    la banda estrecha. Estrellas: máximos locales compactos de la banda estrecha > 15 σ, no saturados en la banda ancha."""
    hp = nb - P._caja(nb, 5)
    s = 1.4826 * float(np.median(np.abs(hp[::4, ::4] - np.median(hp[::4, ::4]))))
    cand = hp > 15 * max(s, 1e-12)
    cand[:12, :] = cand[-12:, :] = False
    cand[:, :12] = cand[:, -12:] = False
    ys, xs = np.nonzero(cand)
    v = hp[ys, xs]
    pico = np.ones(len(ys), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                pico &= v >= hp[ys + dy, xs + dx]
    ys, xs = ys[pico], xs[pico]
    orden = np.argsort(-hp[ys, xs])[: 4 * max_n]
    yy, xx = np.mgrid[-9:10, -9:10]
    rr = np.hypot(yy, xx)
    ap, an = rr <= 4, (rr >= 6) & (rr <= 9)
    fb, fn = [], []
    for j in orden:
        y, x = ys[j], xs[j]
        bb, nn = base[y - 9:y + 10, x - 9:x + 10], nb[y - 9:y + 10, x - 9:x + 10]
        if bb.max() > 0.9:
            continue
        f1 = float((bb[ap] - np.median(bb[an])).sum())
        f2 = float((nn[ap] - np.median(nn[an])).sum())
        if f1 > 0 and f2 > 0:
            fb.append(f1); fn.append(f2)
        if len(fb) >= max_n:
            break
    return np.array(fb), np.array(fn)


def _excesos_estrellas(base, nb, cielo_px, estrellas_px, obj_px):
    """Banda estrecha escalada por las ESTRELLAS (continuo: en las dos capas las estrellas son el mismo continuo, en la
    banda estrecha recortado por el filtro): así lo que la banda estrecha tiene de más en la nebulosa es emisión, y se
    suma con toda su relación señal/ruido. 11 nov 2026: escalada por la propia nebulosa (_excesos), el Hα de un dual band
    en una nebulosa de emisión no aportaba nada (+0–1 %) y la herramienta recomendaba no combinar."""
    fb, fn = _flujos_estrellas(base, nb)
    if len(fb) < 20:
        return _excesos(base, nb, cielo_px, estrellas_px, obj_px)
    k = float(np.median(fb / fn))
    mb, mn = float(np.median(base[cielo_px])), float(np.median(nb[cielo_px]))
    sn = 1.4826 * float(np.median(np.abs(nb[cielo_px] - mn)))
    ex = np.clip((nb - mn) * k - (base - mb), 0, None)
    with np.errstate(over="ignore", invalid="ignore"):
        ex = ex * np.clip(((nb.astype(np.float64) - mn) / max(sn, 1e-9) - 1.5) / 1.5, 0, 1).astype(np.float32)
    ex[estrellas_px] = 0
    # Tope: el exceso puro de un filtro de 5 nm es ~10 veces la nebulosa del RGB (IC 1396: +566 % a ×0,5) y la tapa.
    # Se normaliza para que ×1 como mucho duplique la nebulosa sobre el cielo (×0,5 ≈ +50 %): aporta la estructura y la
    # relación señal/ruido de la banda estrecha sin que domine.
    zona = obj_px & ~estrellas_px
    s_base = float(np.median(base[zona])) - mb if zona.any() else 0.0
    s_ex = float(np.median(ex[zona])) if zona.any() else 0.0
    tope = 1.0
    if s_base > 0 and s_ex > s_base:
        tope = s_base / s_ex
        ex = ex * tope
    return ex, {"k_estrellas": _r(k, 3), "exceso_puro_sobre_rgb": _r(s_ex / s_base, 2) if s_base > 0 else None,
                "tope": _r(tope, 3)}


def combinarCandidatos(siril, ha, oiii=None, intensidades=(0.5, 1.0), con_oiii=True, ruido_max=1.25, tipo=None):
    """Paso 10 lineal: compara cómo añadir Hα (y OIII) al RGB lineal cargado. La imagen no cambia: aplicarCandidato(id)."""
    info = H._info(siril)
    if info["canales"] != 3:
        raise RuntimeError("combinarCandidatos necesita el RGB en color cargado.")
    crudo = P._crudo(siril)
    p = P._pantalla(crudo, info)
    if not P._lineal(p):
        raise RuntimeError("El RGB parece estirado: la banda estrecha se combina en lineal, tras el color (Paso 10).")
    Ha = P._canal_fichero(siril, ha, info, "ha")
    O = P._canal_fichero(siril, oiii, info, "oiii") if oiii else None
    z = P._zonas(p)
    cielo_px, obj_px = z["cielo_px"], z["obj_px"]
    est_px = z.get("est_px", np.zeros(p.shape[1:], bool))
    # ¿Es de verdad banda ancha contra banda estrecha? En la estrecha la nebulosa tiene mucho más contraste sobre las
    # estrellas (dual band 5 nm sobre RGB sin filtro: ×13,7). Si sale ≈ ×1, lo cargado es el propio dual band (11 nov
    # 2026: el modelo procesó el dual band creyendo que era el RGB y combinarlo consigo mismo no aportaba nada).
    def _corr(a, b):
        a, b = a[::8, ::8], b[::8, ::8]
        a, b = (a - a.mean()) / max(float(a.std()), 1e-12), (b - b.mean()) / max(float(b.std()), 1e-12)
        return float((a * b).mean())
    c0, cv = _corr(p[0], Ha), _corr(p[0], Ha[::-1])
    if cv > 0.3 and cv > 3 * max(c0, 0.0):
        raise RuntimeError(f"El RGB cargado está volteado en vertical respecto a la capa Hα (correlación {_r(c0, 2)} directa, "
                           f"{_r(cv, 2)} volteando): un platesolve sin -noflip lo dio la vuelta. Vuelve al RGB de antes de "
                           "resolver (o voltéalo con comandoSiril mirrorx) y repite.")
    _, k_neb = _excesos(p[0], Ha, cielo_px, est_px, obj_px)
    fb, fn = _flujos_estrellas(p[0], Ha)
    if len(fb) >= 20 and k_neb:
        contraste = float(np.median(fb / fn)) / max(float(k_neb), 1e-9)
        if contraste < 1.5:
            raise RuntimeError(
                f"La imagen cargada ({Path(info.get('fichero') or '?').name}) y la capa Hα tienen la misma relación "
                f"nebulosa/estrellas (×{_r(contraste, 2)}): parece el propio dual band, no el RGB de banda ancha. Abre el "
                "RGB (abrirImagen) y comprueba que es el que llevas procesado.")
    exH, kH = _excesos_estrellas(p[0], Ha, cielo_px, est_px, obj_px)
    exO, kO = (_excesos_estrellas(0.5 * (p[1] + p[2]), O, cielo_px, est_px, obj_px) if O is not None
               else (None, None))

    def medir(q):
        rgb = P._cielo_por_canal(q, z["medidas"]["_celdas"])
        dom = 100.0 * (max(rgb) - min(rgb)) / max(float(np.mean(rgb)), 1e-9)
        L = q.mean(axis=0)
        cie = float(np.median(L[cielo_px]))
        ruido = 1.4826 * float(np.median(np.abs(L[cielo_px] - cie)))
        neb = float(np.median(q[0][obj_px])) - float(np.median(q[0][cielo_px])) if obj_px.any() else 0.0
        neb_o = (float(np.median(q[2][obj_px])) - float(np.median(q[2][cielo_px]))) if obj_px.any() else 0.0
        rg = float(np.median(q[0][est_px] / np.maximum(q[1][est_px], 1e-6))) if est_px.any() else None
        return {"nebulosa_rojo": neb, "nebulosa_azul": neb_o, "ruido_cielo": ruido, "dominante_cielo_pct": _r(dom, 1),
                "color_estrellas_rg": rg}

    m0 = medir(p)
    huella = P._huella(crudo)
    grupo = "combinacion"
    P._limpiar_grupo(grupo)
    r = {"antes": {k: _r(v, 6) if isinstance(v, float) else v for k, v in m0.items()},
         "escala_ha": kH, "escala_oiii": kO, "candidatos": [], "errores": []}
    variantes = [(f"Hα en el rojo ×{a:g}", a, 0.0) for a in intensidades]
    if O is not None and con_oiii:
        variantes += [(f"Hα en el rojo ×{a:g} + OIII en verde y azul ×{a:g}", a, a) for a in intensidades]
    for n, (nombre, a, b) in enumerate(variantes, 1):
        try:
            q = p.copy()
            q[0] = q[0] + a * exH
            if b and exO is not None:                  # verde y azul a partes iguales: turquesa, como HOO (con 0,5 en
                q[2] = q[2] + b * exO                  # el verde salía lavanda sobre el Hα, 11 nov 2026)
                q[1] = q[1] + b * exO
            q = np.clip(q, 0, 1)
            m = medir(q)
            gan_h = 100.0 * (m["nebulosa_rojo"] / max(m0["nebulosa_rojo"], 1e-9) - 1)
            gan_o = 100.0 * (m["nebulosa_azul"] / max(m0["nebulosa_azul"], 1e-9) - 1) if b else 0.0
            ruido_x = m["ruido_cielo"] / max(m0["ruido_cielo"], 1e-12)
            cambio_est = (100.0 * (m["color_estrellas_rg"] / m0["color_estrellas_rg"] - 1)
                          if m0["color_estrellas_rg"] and m["color_estrellas_rg"] else 0.0)
            fal = []
            if ruido_x > ruido_max:
                fal.append(f"el ruido del cielo sube ×{_r(ruido_x, 2)} (> ×{ruido_max})")
            if m["dominante_cielo_pct"] >= 5 and m["dominante_cielo_pct"] > m0["dominante_cielo_pct"] + 1:
                fal.append(f"dominante del cielo {m['dominante_cielo_pct']} % (antes {_r(m0['dominante_cielo_pct'], 1)} %)")
            if abs(cambio_est) > 10:
                fal.append(f"el color de las estrellas cambia un {_r(cambio_est, 1)} %")
            res = _a_crudo(q, info, crudo)
            cid = P._guardar_candidato(grupo, n, res, {"nombre": nombre, "comando": nombre, "huella_base": huella})
            r["candidatos"].append({"id": cid, "metodo": nombre,
                                    "metricas": {"nebulosa_halfa_ganada_pct": _r(gan_h, 1), "nebulosa_oiii_ganada_pct": _r(gan_o, 1),
                                                 "ruido_cielo_x": _r(ruido_x, 3), "dominante_cielo_pct": m["dominante_cielo_pct"],
                                                 "color_estrellas_cambio_pct": _r(cambio_est, 1)},
                                    "no_cumple": fal})
        except Exception as e:
            r["errores"].append(f"{nombre}: {e}")
    ok = [x for x in r["candidatos"] if not x["no_cumple"]
          and x["metricas"]["nebulosa_halfa_ganada_pct"] + x["metricas"]["nebulosa_oiii_ganada_pct"] >= 5]
    # Por encima de ×1 se exagera el Hα frente a lo que dicen las estrellas: en IC 405 (19 nov 2026) Qwen eligió
    # ×1,5, la mayor ganancia, y el rojo salió R/G 6 frente a 1,8–2,5 de las referencias. Se recomienda hasta ×1.
    fuerza = {x['id']: a for x, (_, a, _b) in zip(r["candidatos"], variantes)}
    if any(fuerza.get(x["id"], 0) <= 1.0 for x in ok):
        ok = [x for x in ok if fuerza.get(x["id"], 0) <= 1.0]
    if not ok and r["candidatos"] and not any(x["no_cumple"] for x in r["candidatos"]):
        r["recomendado"] = None
        r["motivo"] = ("Ninguna combinación aporta (< 5 % de nebulosa ganada): la banda estrecha no tiene más señal que el RGB "
                       "en estas zonas. Sigue con el RGB tal cual o compón una paleta con las capas (paletasCandidatos).")
    elif ok:
        mejor = max(ok, key=lambda x: (x["metricas"]["nebulosa_halfa_ganada_pct"] + x["metricas"]["nebulosa_oiii_ganada_pct"]))
        r["recomendado"] = mejor["id"]
        mm = mejor["metricas"]
        r["motivo"] = (f"{mejor['metodo']}: la nebulosa gana un {mm['nebulosa_halfa_ganada_pct']} % en Hα"
                       + (f" y un {mm['nebulosa_oiii_ganada_pct']} % en OIII" if mm["nebulosa_oiii_ganada_pct"] else "")
                       + f", con el ruido del cielo ×{mm['ruido_cielo_x']} y las estrellas sin cambiar de color.")
    else:
        r["recomendado"] = None
        r["motivo"] = "Ninguna cumple (ver no_cumple): bajar intensidades o revisar el gradiente y el color de las capas."
    r["leyenda"] = ("Se suma sólo el EXCESO de la banda estrecha sobre el canal de banda ancha, escalada por el ruido del cielo "
                    "y sin las estrellas (que salen del RGB). nebulosa_*_ganada_pct: subida de la nebulosa sobre el cielo en "
                    "rojo (Hα) y azul (OIII). La imagen NO ha cambiado: aplicarCandidato(id).")
    P._asegurar_restaurado(siril, crudo, huella, r)
    aviso = aviso_sin_usar([info.get("fichero"), ha, oiii])
    if aviso:
        r["aviso_masters"] = aviso
    P._galeria(r, info, p, "diferencia")
    return r


def combinarRGB(siril, r, g, b):
    """Paso 10 lineal (mono con rueda): compone una imagen RGB con tres masters mono ya alineados (rojo, verde y azul),
    en lineal y sin escalar ningún canal: el color lo pone después la calibración (SPCC). Sustituye la imagen cargada
    (con deshacer), que debe ser uno de ellos o una imagen del mismo tamaño (para conservar su cabecera y astrometría).
    12 nov 2026 (Tarántula, mono): antes no había forma de componer RGB desde mono con las herramientas de la guía."""
    info = H._info(siril)
    crudo = P._crudo(siril)
    canales = [P._canal_fichero(siril, f, info, n) for f, n in ((r, "rojo"), (g, "verde"), (b, "azul"))]
    q = np.stack(canales).astype(np.float32)
    x = q if info["top_down"] else q[:, ::-1, :]
    P._poner(siril, P._a_siril(np.clip(x, 0, 1), crudo.dtype).reshape((3,) + tuple(crudo.shape[-2:])), "SirilAstroPilot: combinarRGB")
    med = [float(np.median(c[::4, ::4])) for c in canales]
    res = {"rojo": r, "verde": g, "azul": b, "mediana_por_canal": [_r(m, 6) for m in med],
           "nota": "RGB lineal sin calibrar (cada canal tal cual). Siguiente: gradiente, astrometría y calibrarColor (SPCC con los "
                   "filtros de la rueda, mono: true). Guárdala con guardarImagen."}
    aviso = aviso_sin_usar([r, g, b])
    if aviso:
        res["aviso_masters"] = aviso
    return res


LISTA_MULTICAPA = {"alinearMasters": alinearMasters, "revisarRecorte": revisarRecorte,
                   "desmezclarDualBand": desmezclarDualBand, "unirCapas": unirCapas,
                   "combinarCandidatos": combinarCandidatos, "combinarRGB": combinarRGB}
