# sirilpy falso para probar el puente y el MCP sin Siril (solo pruebas: no lo pongas en el path de Siril).
# Imagen sintética lineal RGB float32 con fondo, gradiente, una nebulosa, estrellas y cuñas sin datos.
# Tamaño por defecto 6248×4176 (26 MP); SIRIL_FALSO_TAM=anchoxalto para probar más rápido.
# Los comandos imitan a los de Siril lo justo para probar las herramientas (no son los algoritmos reales).
import contextlib
import enum
import os
import shutil
import tempfile
import time
from types import SimpleNamespace as NS

import numpy as np

__version__ = "falso"


class LogColor(enum.IntEnum):
    DEFAULT = 0
    RED = 1
    SALMON = 2
    GREEN = 3
    BLUE = 4


def ensure_installed(*a, **k):
    return True


def _poli(z, mask, grado):
    h, w = z.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    xx, yy = xx / w - 0.5, yy / h - 0.5
    t = [np.ones_like(xx)]
    for g in range(1, grado + 1):
        for i in range(g + 1):
            t.append(xx ** (g - i) * yy ** i)
    A = np.stack([x[mask] for x in t], 1)
    c, *_ = np.linalg.lstsq(A, z[mask], rcond=None)
    return sum(ci * ti for ci, ti in zip(c, t))


def _ght_funcion(D, b, SP, LP, HP):
    """T(x) del estirado hiperbólico generalizado (b > 0 hiperbólico, b = 0 exponencial, b < 0 «integral»), con tramos
    lineales por debajo de LP y por encima de HP, normalizado a T(0) = 0 y T(1) = 1."""
    if D <= 0:
        return lambda x: x

    def nucleo(x):
        x = np.asarray(x, np.float64)
        d = np.where(x >= SP, x - SP, SP - x)
        if b == 0:
            t = 1 - np.exp(-D * d)
        elif b < 0:                                     # no lo usamos: aproximación logarítmica
            t = np.log1p(D * d)
        else:
            t = 1 - (1 + b * D * d) ** (-1 / b)
        return np.where(x >= SP, t, -t)

    def deriv(x0, h=1e-6):
        return float((nucleo(x0 + h) - nucleo(x0 - h)) / (2 * h))

    tLP, tHP, dLP, dHP = float(nucleo(LP)), float(nucleo(HP)), deriv(LP), deriv(HP)

    def bruto(x):
        x = np.asarray(x, np.float64)
        y = nucleo(x)
        y = np.where(x < LP, tLP + dLP * (x - LP), y)
        return np.where(x > HP, tHP + dHP * (x - HP), y)

    t0, t1 = float(bruto(0.0)), float(bruto(1.0))
    return lambda x: ((bruto(x) - t0) / max(t1 - t0, 1e-12)).astype(np.float32)


class SirilInterface:
    def __init__(self):
        ancho, alto = (int(v) for v in os.environ.get("SIRIL_FALSO_TAM", "6248x4176").lower().split("x"))
        rng = np.random.default_rng(1)
        y, x = np.mgrid[0:alto, 0:ancho].astype(np.float32)
        fondo = 0.02 + 0.01 * x / ancho + 0.004 * (y / alto) ** 2
        # SIRIL_FALSO_NEB=grande: nebulosa que llena casi todo el campo (para probar la máscara de cielo del gradiente)
        ax, ay = (0.45, 0.6) if os.environ.get("SIRIL_FALSO_NEB") == "grande" else (0.12, 0.15)
        neb = 0.03 * np.exp(-(((x - 0.45 * ancho) / (ax * ancho)) ** 2 + ((y - 0.5 * alto) / (ay * alto)) ** 2))
        if os.environ.get("SIRIL_FALSO_NEB") == "grande":     # con filamentos (detalle fino para medir el denoise)
            neb = neb * (1 + 0.5 * np.sin(x / 7.0) * np.sin(y / 11.0))
            t = rng.normal(0, 1, (alto + 4, ancho + 4)).astype(np.float32)     # textura fina de 2–3 px
            t = sum(t[i:i + alto, j:j + ancho] for i in range(5) for j in range(5)) / 5.0
            neb = neb * (1 + 0.4 * t)
        tinte = (1.0, 1.15, 0.9)                         # cielo algo verde, como un OSC sin calibrar
        img = np.stack([(fondo + neb * (1.4 if c == 0 else 0.6)) * tinte[c] +
                        rng.normal(0, 0.0015, (alto, ancho)).astype(np.float32) for c in range(3)])
        est = np.zeros((alto, ancho), np.float32)
        for _ in range(max(50, ancho * alto // 90000)):
            cx, cy, a = rng.uniform(20, ancho - 20), rng.uniform(20, alto - 20), rng.uniform(0.02, 0.9)
            x0, y0 = int(cx) - 6, int(cy) - 6
            yy, xx = np.mgrid[y0:y0 + 13, x0:x0 + 13]
            est[y0:y0 + 13, x0:x0 + 13] += a * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / 3.0)
        if os.environ.get("SIRIL_FALSO_TINTE_EST"):        # estrellas con el mismo tinte de cámara que el cielo
            img = img + est[np.newaxis] * np.array(tinte, np.float32)[:, None, None]
        else:
            img = img + est
        img[:, :, :40] = 0                             # 40 px sin datos a la izquierda
        img[:, -25:, :] = 0                             # 25 px abajo (orden de pantalla)
        for i in range(120):                            # cuña inclinada arriba a la derecha (como el registrado)
            img[:, i, ancho - (120 - i) * 3:] = 3e-5
        self.estrellas = est[::-1, :].copy()
        self.img = np.clip(img, 0, 1)[:, ::-1, :].copy().astype(np.float32)   # Siril guarda de abajo arriba (FITS)
        self.hist = ["load sintetica"]
        self.deshechos = []
        self.solved = False
        self.wd = tempfile.mkdtemp(prefix="siril_falso_")
        self._log = "08:00:00: Siril falso\n"

    # --- básico
    def connect(self): return True
    def log(self, t, color=None):
        print("[siril]", t)
        self._log += time.strftime("%H:%M:%S") + ": " + str(t) + "\n"
    def get_siril_log(self): return self._log
    def error_messagebox(self, t, modal=False): print("[error]", t)
    def is_image_loaded(self): return True
    def get_siril_wd(self): return self.wd
    def get_image_shape(self): return self.img.shape
    def get_image_filename(self): return "C:/falso/sintetica.fit"
    def get_image(self, with_pixels=True, preview=False):
        return NS(bitpix=-32, top_down=False, data=self.img if with_pixels else None)
    def get_image_keywords(self):
        return NS(object="Sintética", filter="L", instrume=os.environ.get("SIRIL_FALSO_CAM", "Falsa"), telescop="", bayer_pattern="", exposure=300.0,
                  livetime=36000.0, stackcnt=120, focal_length=530.0, pixel_size_x=3.76, binning_x=1, gain=100,
                  offset=50, ccd_temp=-10.0, ra=315.0 if self.solved else None, dec=60.0 if self.solved else None,
                  pltsolvd=self.solved, date_obs=None)
    def get_image_history(self): return list(self.hist)
    def get_image_fits_header(self, return_as="str"): return "SIMPLE  =                    T"
    def get_image_stats(self, c):
        return NS(median=-999999.0, mad=-999999.0, mean=-999999.0, min=0.0, max=1.0, bgnoise=-999999.0)
    def get_image_pixeldata(self, shape=None, preview=False, linked=False):
        if preview:
            m = np.median(self.img[:, ::8, ::8])
            return (np.clip((self.img - m + 0.01) * 20, 0, 1) * 255).astype(np.uint8)
        return self.img.copy()
    def get_image_stars(self, channel=None):
        time.sleep(0.05)
        return [NS(A=0.5 + i / 100, fwhmx=2.4, fwhmy=2.2, xpos=100.0 + i, ypos=200.0, has_saturated=i == 9)
                for i in range(10)]
    def get_siril_config(self, g, k): return None

    # --- escribir píxeles
    @contextlib.contextmanager
    def image_lock(self):
        yield self
    def undo_save_state(self, t):
        self.hist.append(t)
        return True
    def set_image_pixeldata(self, a):
        assert a.dtype == np.float32 and a.ndim == 3
        self.img = a.copy()
        return True
    def save_image_file(self, data, header=None, filename=None):
        with open(filename, "wb") as f:
            np.save(f, data)
        return True
    def load_image_from_file(self, f, **k):
        with open(f, "rb") as fh:
            return NS(data=np.load(fh))

    # --- comandos
    def cmd(self, *a):
        n, args = a[0], list(a[1:])
        op = {k.split("=")[0]: (k.split("=", 1)[1] if "=" in k else True) for k in args if k.startswith("-")}
        pos = [x for x in args if not x.startswith("-") or x.replace(".", "").replace("-", "").isdigit()]
        im = self.img
        if n == "subsky":
            g = 4 if "-rbf" in op else int(pos[0])
            b = 16
            for c in range(3):
                z = im[c, : im.shape[1] // b * b, : im.shape[2] // b * b]
                zb = z.reshape(z.shape[0] // b, b, z.shape[1] // b, b).mean(axis=(1, 3))
                m = np.median(zb)
                mk = (zb > 0.25 * m) & (zb < m * 1.05)
                mod = _poli(zb.astype(np.float64), mk, g)
                mod = np.kron(mod, np.ones((b, b)))
                full = np.full(im.shape[1:], np.median(mod))
                full[: mod.shape[0], : mod.shape[1]] = mod
                if "-rbf" in op:                        # el "RBF" falso copia un poco la nebulosa
                    full = full + 0.3 * (im[c] - full).clip(0, 0.02)
                im[c] = np.where(im[c] > 1e-4, im[c] - full + np.median(full), im[c])
        elif n == "crop":
            x, y, w, h = (int(v) for v in pos)
            H = im.shape[1]
            self.img = im[:, H - y - h:H - y, x:x + w].copy()
            self.estrellas = self.estrellas[H - y - h:H - y, x:x + w].copy()
        elif n == "platesolve":
            self.solved = True
            self.log("Plate solving succeeded (falso)")
        elif n in ("spcc", "pcc"):
            if not self.solved:
                raise RuntimeError("Command 'spcc' failed: not plate solved")
            cat = next((a.split("=", 1)[1] for a in args if a.startswith("-catalog=")), "nomad" if n == "pcc" else "localgaia")
            if os.environ.get("SIRIL_FALSO_SIN_RED") and cat not in ("localgaia",):
                self.log("URL retrieval failed. libcurl error: [28]")
                self.log("Error: unable to retrieve the remote catalogue from the server at http://tapvizier.u-strasbg.fr/…")
                self.log("Catalog error, no stars identified!")
                raise RuntimeError(f"Command '{n}' failed: Generic error")
            self.log(f"{n}: catálogo {cat} (falso)")
            if n == "pcc" and os.environ.get("SIRIL_FALSO_PCC_IMPRECISO"):
                for l in ("Found a solution for color calibration using 707 stars. Factors:", "K0: 1.000\t(deviation: 0.107)",
                          "K1: 0.774\t(deviation: 0.079)", "K2: 0.831\t(deviation: 0.078)",
                          "The photometric color calibration seems to have found an imprecise solution, consider correcting "
                          "the image gradient first"):
                    self.log(l)
            sky =[np.percentile(im[c][im[c] > 1e-4][::7], 10) for c in range(3)]
            for c in range(3):
                im[c] = im[c] * (np.mean(sky) / sky[c])
            self.log("SPCC: white balance factors applied (falso)")
        elif n == "spcc_list":
            listas = {"oscsensor": ("Sony IMX571", "Sony IMX533", "Canon EOS 60D", "Canon EOS 600D", "Nikon D90", "Nikon D750"),
                      "osclpf": ("Canon LPF", "Nikon D90", "Generic / None", "Baader BCF")}   # como la base real: sin EOS 6D
            for nombre in listas.get(pos[0] if pos else "oscsensor", ()):
                self.log(nombre)
        elif n == "starnet":
            im -= self.estrellas[np.newaxis] * 0.95
            with open(os.path.join(self.wd, "starmask_sintetica.fit"), "wb") as f:
                np.save(f, np.repeat(self.estrellas[np.newaxis] * 0.95, im.shape[0], 0).astype(np.float32))
        elif n == "denoise":                            # suavizado 3×3 (DA3D: 5×5), mezclado con -mod
            r = 2 if "-da3d" in op else 1
            k = 2 * r + 1
            pad = np.pad(im, ((0, 0), (r, r), (r, r)), mode="edge")
            s = sum(pad[:, i:i + im.shape[1], j:j + im.shape[2]] for i in range(k) for j in range(k)) / (k * k)
            m = float(op.get("-mod", 1.0))
            self.img = (m * s + (1 - m) * im).astype(np.float32)
            if "-da3d" in op:
                time.sleep(0.5)
        elif n == "satu":                               # croma × (1 + cantidad) donde la luminancia > mediana·factor
            q = float(pos[0])
            fac = float(pos[1]) if len(pos) > 1 else 1.0
            L = im.mean(axis=0)
            mk = L > np.median(L[::4, ::4]) * fac
            self.img = np.where(mk, L + (im - L) * (1 + q), im).clip(0, 1).astype(np.float32)
        elif n in ("clahe", "unsharp", "wrecons"):      # realce de escala media: im + k·(im − desenfoque)
            if n == "clahe":
                k, rr = (float(pos[0]) - 1) * 0.4, 16
            elif n == "unsharp":
                k, rr = float(pos[1]), max(1, int(float(pos[0])))
            else:
                k, rr = (max(float(x) for x in pos) - 1) * 1.5, 4
            pad = np.pad(im, ((0, 0), (rr, rr), (rr, rr)), mode="edge")
            cs = pad.cumsum(1).cumsum(2)
            cs = np.pad(cs, ((0, 0), (1, 0), (1, 0)))
            w = 2 * rr + 1
            bl = (cs[:, w:, w:] - cs[:, :-w, w:] - cs[:, w:, :-w] + cs[:, :-w, :-w]) / (w * w)
            self.img = np.clip(im + k * (im - bl[:, :im.shape[1], :im.shape[2]]), 0, 1).astype(np.float32)
        elif n == "wavelet":
            pass
        elif n in ("savetif", "savejpg"):
            ruta = pos[0].strip('"') + (".tif" if n == "savetif" else ".jpg")
            with open(ruta, "wb") as f:
                np.save(f, (im[:, ::4, ::4] * (65535 if n == "savetif" else 255)).astype(np.uint16))
        elif n == "ght":
            # Ecuaciones publicadas del estirado hiperbólico generalizado (D efectivo = e^D − 1; b; SP; LP; HP), como Siril.
            # -even / -human: se estira la luminancia y los canales se escalan por T(L)/L (recortando a 1); si no, por canal.
            D = np.expm1(float(op["-D"]))
            b, SP = float(op.get("-B", 0)), float(op.get("-SP", 0))
            LP, HP = float(op.get("-LP", 0)), float(op.get("-HP", 1))
            T = _ght_funcion(D, b, SP, LP, HP)
            x = im.clip(0, 1)
            if "-even" in args or "-human" in args:
                pesos = np.array([0.2126, 0.7152, 0.0722] if "-human" in args else [1 / 3] * 3, np.float32)[:, None, None]
                L = (x * pesos).sum(axis=0) if x.shape[0] == 3 else x[0]
                f = np.where(L > 1e-9, T(L) / np.maximum(L, 1e-9), 0)
                self.img = np.clip(x * f, 0, 1).astype(np.float32)
            else:
                self.img = np.clip(T(x), 0, 1).astype(np.float32)
        elif n == "linstretch":
            bp = float(op["-BP"])
            self.img = ((im - bp) / (1 - bp)).clip(0, 1).astype(np.float32)
        elif n == "asinh":
            # Como Siril: en color, multiplicador común asinh(β·L)/(L·asinh β) con L la media de canales (o -human)
            s = float(pos[0])
            off = float(pos[1]) if len(pos) > 1 else 0.0
            x = np.clip(im - off, 0, 1)
            if x.shape[0] == 3:
                L = x.mean(axis=0)
                f = np.where(L > 1e-9, np.arcsinh(s * L) / (np.maximum(L, 1e-9) * np.arcsinh(s)), 0)
                self.img = np.clip(x * f, 0, 1).astype(np.float32)
            else:
                self.img = (np.arcsinh(s * x) / np.arcsinh(s)).astype(np.float32)
        elif n == "autostretch":
            # MTF enlazado: sombras = mediana + k·MAD (k = −2,8), medio tono para llevar la mediana al objetivo
            k, t = (float(pos[-2]), float(pos[-1])) if len(pos) >= 2 else (-2.8, 0.25)
            x = im.clip(0, 1)
            med = float(np.median(x[:, ::4, ::4]))
            mad = 1.4826 * float(np.median(np.abs(x[:, ::4, ::4] - med)))
            c0 = max(0.0, med + k * mad)
            m = (med - c0) / max(1 - c0, 1e-9)
            mt = (m * (t - 1)) / ((2 * t - 1) * m - t)
            y = np.clip((x - c0) / max(1 - c0, 1e-9), 0, 1)
            self.img = (((mt - 1) * y) / ((2 * mt - 1) * y - mt)).astype(np.float32)
        elif n == "rmgreen":
            im[1] = np.minimum(im[1], (im[0] + im[2]) / 2)
        # --- preprocesado y apilado (lo justo para probar apilado.py)
        elif n == "cd":
            self.cwd = os.path.normpath(os.path.join(getattr(self, "cwd", self.wd), args[0].strip('"')))
        elif n == "convert":
            base = pos[0]
            fs = [f for f in os.listdir(self.cwd) if os.path.isfile(os.path.join(self.cwd, f))]
            out = os.path.normpath(os.path.join(self.cwd, op.get("-out", ".")))
            os.makedirs(out, exist_ok=True)
            self.seqs = getattr(self, "seqs", {})
            self.seqs[base] = len(fs)
            for i, f in enumerate(sorted(fs), 1):                 # como Siril: <base>_NNNNN.fit en la carpeta de salida
                shutil.copy2(os.path.join(self.cwd, f), os.path.join(out, f"{base}_{i:05d}.fit"))
        elif n == "setref":
            pass
        elif n == "calibrate":
            self.seqs["pp_" + pos[0]] = self.seqs.get(pos[0], 0)
            for i in range(self.seqs.get(pos[0], 0)):        # como Siril: pp_<secuencia>_NNNNN.fit en la carpeta actual
                open(os.path.join(self.cwd, f"pp_{pos[0]}_{i + 1:05d}.fit"), "wb").close()
        elif n == "register":
            s = pos[0]
            nf = self.seqs.get(s, 0)
            rr = np.random.default_rng(3)
            self.reg = [NS(fwhm=2.4 + rr.normal(0, 0.05), weighted_fwhm=2.5 + rr.normal(0, 0.05) + (1.5 if i in (3, 7) else 0),
                           roundness=0.9 + rr.normal(0, 0.01), quality=1.0,
                           background_lvl=0.01 + rr.normal(0, 0.0002) + (0.02 if i == 5 else 0),
                           number_of_stars=500 + int(rr.normal(0, 10)) - (300 if i == 7 else 0), H=None) for i in range(nf)]
            # como Siril: los datos de registro van al .seq (texto) y la secuencia NO queda cargada para get_seq()
            lin = ["#Siril sequence file.", f"S '{s}_' 1 {nf} {nf} 5 0 6 0 0 0", "L 3"]
            lin += [f"I {i + 1} 1" for i in range(nf)]
            lin += [f"R1 {r.fwhm:g} {r.weighted_fwhm:g} {r.roundness:g} 0 {r.background_lvl:g} {r.number_of_stars} H 1 0 0 0 1 0 0 0 1"
                    for r in self.reg]
            with open(os.path.join(self.cwd, f"{s}_.seq"), "w", encoding="utf-8") as f:
                f.write("\n".join(lin) + "\n")
        elif n == "seqapplyreg":
            nf = self.seqs.get(pos[0], 0)
            if "-filter-incl" in op:
                with open(os.path.join(self.cwd, f"{pos[0]}_.seq"), encoding="utf-8") as f:
                    nf = sum(1 for x in f if x.startswith("I ") and x.split()[2] == "1")
            self.seqs["r_" + pos[0]] = nf
            for f in sorted(os.listdir(self.cwd)):                # registradas: copias (el falso no mueve píxeles)
                if f.startswith(pos[0] + "_") and f.endswith(".fit"):
                    shutil.copy2(os.path.join(self.cwd, f), os.path.join(self.cwd, "r_" + f))
        elif n == "stack":
            s = pos[0]
            nf = max(1, self.seqs.get(s, 1))
            if len(pos) > 3 and pos[2] == "g" and float(pos[3]) >= 1:
                raise RuntimeError("stack: ESD generalizado necesita fracción de atípicos < 1 (p. ej. 0.3 0.05)")
            factor = {"w": 1.0, "g": 0.97, "l": 1.03, "s": 1.05}.get(pos[2] if len(pos) > 2 else "w", 1.0)
            if "-weight" in op:
                factor *= 0.98
            rr = np.random.default_rng(len(s) + nf)
            h, w = 400, 600
            im = 0.01 + rr.normal(0, 0.002 * factor / np.sqrt(nf), (3, h, w)).astype(np.float32)
            for _ in range(40):
                cy, cx = rr.integers(10, h - 10), rr.integers(10, w - 10)
                im[:, cy - 2:cy + 3, cx - 2:cx + 3] += 0.3
            ruta = os.path.normpath(os.path.join(self.cwd, op.get("-out", s + "_stacked"))) + ".fit"
            os.makedirs(os.path.dirname(ruta), exist_ok=True)
            with open(ruta, "wb") as f:
                np.save(f, im.astype(np.float32))
        elif n == "load":
            with open(args[0].strip('"'), "rb") as f:
                self.img = np.load(f)
        elif n == "save":
            with open(args[0].strip('"') + ".fit", "wb") as f:
                np.save(f, self.img)
        elif n == "lento":
            time.sleep(float(pos[0]))
        self.hist.append(" ".join(a))
        self.log(" ".join(a))

    # --- secuencias (apilado)
    def get_seq(self):
        raise RuntimeError("Error in get_seq(): no sequence is loaded")   # como el Siril real tras comandos de script
    def get_seq_regdata(self, i, canal):
        return self.reg[i]
    def set_seq_frame_incl(self, idx, incl):
        for i in (idx if isinstance(idx, list) else [idx]):
            self.incl[i] = incl

    def undo(self):
        self.deshechos.append(self.hist.pop())
    def redo(self):
        self.hist.append(self.deshechos.pop())
