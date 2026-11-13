# SASpro falso para probar SetiAstroPilot sin la aplicación: documentos con deshacer, DocManager y run_command con
# unos pocos procesos hechos en numpy (abe, stat_stretch, ghs, remove_green, cosmic_clarity, graxpert, plate_solve).
# No imita los algoritmos de SASpro: solo su forma de trabajar (apply_edit, undo, run_command(target_doc=...)).
import os
import uuid

import numpy as np


class Doc:
    def __init__(self, img, nombre, metadata=None):
        self.image = np.asarray(img, dtype=np.float32)
        self.metadata = dict(metadata or {})
        self.metadata.setdefault("display_name", nombre)
        self.uid = uuid.uuid4().hex
        self._undo, self._redo = [], []

    def display_name(self):
        return self.metadata["display_name"]

    def apply_edit(self, new_image, metadata=None, step_name="Edit"):
        self._undo.append((self.image, dict(self.metadata), step_name))
        self._redo.clear()
        self.image = np.asarray(new_image, dtype=np.float32)

    def can_undo(self): return bool(self._undo)
    def can_redo(self): return bool(self._redo)
    def last_undo_name(self): return self._undo[-1][2] if self._undo else None

    def undo(self):
        if not self._undo:
            return None
        img, meta, n = self._undo.pop()
        self._redo.append((self.image, dict(self.metadata), n))
        self.image, self.metadata = img, meta
        return n

    def redo(self):
        if not self._redo:
            return None
        img, meta, n = self._redo.pop()
        self._undo.append((self.image, dict(self.metadata), n))
        self.image, self.metadata = img, meta
        return n


class DocManager:
    def __init__(self):
        self._docs, self.activo = [], None

    def all_documents(self): return list(self._docs)
    def get_active_document(self): return self.activo
    def get_focused_base_document(self): return self.activo

    def open_array(self, img, metadata=None, title=None):
        d = Doc(img, title or "sin_titulo", metadata)
        self._docs.append(d)
        self.activo = d
        return d

    def open_path(self, path):
        if path.lower().endswith(".npy"):
            img = np.load(path)
        else:
            raise RuntimeError("El falso solo abre .npy")
        return self.open_array(img, {"file_path": path}, os.path.splitext(os.path.basename(path))[0])


class App:
    def __init__(self):
        self.doc_manager = DocManager()
        self.lineas = []

    def _log(self, m):
        self.lineas.append(m)
        print(m, flush=True)


def _poli(img, grado):
    p = img if img.ndim == 3 else img[:, :, None]
    h, w, c = p.shape
    yy, xx = np.mgrid[0:h:8, 0:w:8].astype(np.float64)
    xx, yy = xx / w - 0.5, yy / h - 0.5
    Y, X = np.mgrid[0:h, 0:w].astype(np.float64)
    X, Y = X / w - 0.5, Y / h - 0.5
    out = np.empty_like(p)
    for k in range(c):
        z = p[::8, ::8, k].astype(np.float64)
        m = z < np.percentile(z, 60)
        T = [np.ones_like(xx)]
        TT = [np.ones_like(X)]
        for g in range(1, grado + 1):
            for i in range(g + 1):
                T.append(xx ** (g - i) * yy ** i)
                TT.append(X ** (g - i) * Y ** i)
        A = np.stack([t[m] for t in T], 1)
        co, *_ = np.linalg.lstsq(A, z[m], rcond=None)
        mod = sum(a * t for a, t in zip(co, TT))
        out[:, :, k] = p[:, :, k] - mod + np.median(mod)
    return out if img.ndim == 3 else out[:, :, 0]


def _stat(img, objetivo, enlazado):
    p = img if img.ndim == 3 else img[:, :, None]
    out = np.empty_like(p)
    meds = np.median(p, axis=(0, 1))
    for k in range(p.shape[2]):
        m = float(meds.mean() if enlazado else meds[k])
        x = np.clip(p[:, :, k], 0, 1)
        out[:, :, k] = ((m - 1) * objetivo * x) / (m * (objetivo + x - 1) - objetivo * x + 1e-9)
    out = np.clip(out, 0, 1)
    return out if img.ndim == 3 else out[:, :, 0]


def _caja(x, r):
    pad = [(r, r), (r, r)] + ([(0, 0)] if x.ndim == 3 else [])
    c = np.pad(x, pad, mode="reflect").astype(np.float64).cumsum(0).cumsum(1)
    c = np.pad(c, [(1, 0), (1, 0)] + ([(0, 0)] if x.ndim == 3 else []))
    k = 2 * r + 1
    return ((c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)).astype(np.float32)


def run_command(ctx, cid, preset, target_doc=None):
    d = target_doc or ctx.app.doc_manager.activo
    img = d.image
    if cid == "abe":
        out = _poli(img, int(preset.get("degree", 2)))
        if preset.get("rbf"):
            out = out - (_caja(out, 6) - _caja(out, 20)) * 0.02
    elif cid == "stat_stretch":
        out = _stat(img, float(preset.get("target_median", 0.25)), bool(preset.get("linked", True)))
    elif cid == "ghs":
        out = np.arcsinh(img * 200) / np.arcsinh(200)
    elif cid == "remove_green" and img.ndim == 3:
        out = img.copy()
        out[:, :, 1] = np.minimum(img[:, :, 1], (img[:, :, 0] + img[:, :, 2]) / 2)
    elif cid == "cosmic_clarity" and preset.get("mode") == "denoise":
        f = float(preset.get("denoise_luma", 0.5))
        out = img * (1 - f) + _caja(img, 1) * f
    elif cid == "graxpert":
        if os.environ.get("SAS_FALSO_SIN_GRAXPERT"):
            return None          # como cuando falta el programa: no cambia nada
        out = _poli(img, 3) if preset.get("op") == "background" else _caja(img, 1)
    elif cid == "plate_solve":
        d.metadata["wcs_header"] = {"CTYPE1": "RA---TAN"}
        return None
    else:
        return None
    d.apply_edit(out, step_name=cid)
    return None


class Ctx:
    """Lo que usa SetiAstroPilot del ScriptContext de SASpro."""

    def __init__(self, app):
        self.app = app

    def log(self, m): self.app._log(f"[Script] {m}")
    def base_document(self): return self.app.doc_manager.activo
    def active_document(self): return self.app.doc_manager.activo

    def get_document(self, k):
        for d in self.app.doc_manager._docs:
            if d.uid == k or d.display_name().lower() == str(k).lower():
                return d
        return None

    def get_document_by_view_name(self, k): return self.get_document(k)

    def list_views(self):
        return [{"name": d.display_name(), "uid": d.uid} for d in self.app.doc_manager._docs]

    def activate_view(self, k):
        d = self.get_document(k)
        if d:
            self.app.doc_manager.activo = d
        return bool(d)

    def open_new_document(self, img, metadata=None, name=None):
        return self.app.doc_manager.open_array(img, metadata, name)

    def run_command(self, cid, preset=None, **kw):
        return run_command(self, cid, dict(preset or {}), **kw)

    def save_image(self, img, filename, original_format=None, bit_depth=None, **kw):
        a = np.asarray(img)
        if original_format in ("jpg", "png", "tif"):
            from PIL import Image
            x = (np.clip(a, 0, 1) * 255).astype(np.uint8)
            Image.fromarray(x).save(filename)
        else:
            with open(filename, "wb") as f:
                np.save(f, a)


def imagen_sintetica(w=1600, h=1100, semilla=1):
    """Galaxia + estrellas + gradiente lineal + ruido, en 0–1 y lineal (mediana ~0,02)."""
    rng = np.random.default_rng(semilla)
    Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
    fondo = 0.02 + 0.01 * (X / w) + 0.006 * (Y / h)
    gal = 0.08 * np.exp(-(((X - w * 0.55) / (w * 0.12)) ** 2 + ((Y - h * 0.5) / (h * 0.07)) ** 2))
    img = np.repeat((fondo + gal)[:, :, None], 3, axis=2)
    img[:, :, 1] *= 1.08
    for _ in range(300):
        x, y = rng.integers(0, w), rng.integers(0, h)
        a = rng.uniform(0.02, 0.6)
        r = 2.0
        y0, y1, x0, x1 = max(0, y - 8), min(h, y + 9), max(0, x - 8), min(w, x + 9)
        img[y0:y1, x0:x1, :] += (a * np.exp(-((X[y0:y1, x0:x1] - x) ** 2 + (Y[y0:y1, x0:x1] - y) ** 2) / (2 * r * r)))[:, :, None]
    img += rng.normal(0, 0.002, img.shape).astype(np.float32)
    return np.clip(img, 0, 1).astype(np.float32)
