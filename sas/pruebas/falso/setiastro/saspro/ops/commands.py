# Falso de setiastro.saspro.ops.commands para probar SetiAstroPilot sin SASpro (solo get_spec y normalize_cid).
from dataclasses import dataclass, field


@dataclass
class PresetSpec:
    key: str
    type: str
    default: object = None
    min: float = None
    max: float = None
    enum: list = None
    desc: str = ""


@dataclass
class CommandSpec:
    id: str
    name: str = ""
    notes: str = ""
    group: str = "General"
    presets: list = field(default_factory=list)
    examples: list = field(default_factory=list)
    supports_mono: bool = True
    supports_rgb: bool = True
    supports_linear: bool = True
    supports_nonlinear: bool = True


_SPECS = {
    "abe": CommandSpec("abe", "Automatic Background Extraction", group="Background",
                       presets=[PresetSpec("degree", "int", 2, 0, 6), PresetSpec("samples", "int", 120, 20, 100000),
                                PresetSpec("rbf", "bool", True)]),
    "stat_stretch": CommandSpec("stat_stretch", "Statistical Stretch", group="Stretch",
                                presets=[PresetSpec("target_median", "float", 0.25, 0, 1),
                                         PresetSpec("linked", "bool", True)]),
    "remove_green": CommandSpec("remove_green", "Remove Green", presets=[PresetSpec("amount", "float", 1.0, 0, 1)]),
    "cosmic_clarity": CommandSpec("cosmic_clarity", "Cosmic Clarity",
                                  presets=[PresetSpec("mode", "enum", "sharpen", enum=["sharpen", "denoise"])]),
}


def normalize_cid(c):
    return str(c).strip().lower()


def get_spec(c):
    return _SPECS.get(normalize_cid(c))
