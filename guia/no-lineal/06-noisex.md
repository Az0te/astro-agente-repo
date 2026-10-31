# Paso 6: NoiseX

[← Índice](../SKILL.md) · Anterior: [Paso 5: Boost (curvas, contraste, saturación)](05-boost.md) · Siguiente: [Paso 7: Nitidez](07-nitidez.md)

**Por qué.** El NXT principal ya se hizo en lineal sobre la starless (Paso 15 de la fase lineal). El boost ha amplificado el ruido de croma y el moteado de baja frecuencia. Este es el denoise **final**, sobre la capa sin estrellas y ya estirada: aquí sí se puede ser más agresivo que en lineal, porque BXT ya hizo su trabajo. "Si va a haber saturación fuerte, quitar el ruido de croma **antes** de saturar".

**Parámetros**

| Parámetro | Valor |
|---|---|
| Pasada final tras estirar | 0,15–0,30 por defecto; 0,50–0,70 sólo si tras los realces se ve ruido de croma |
| Receta IC 63 v4B | NXT 0,75 bajo la máscara de fondo del LHE + 0,30 global |
| Separación de color | croma 0,90 / luminancia 0,40 (si hay saturación fuerte o el ruido de croma se ve) |
| detail | 0,25 con separación de color |
| Tras LHE/HDRMT en galaxias | NXT final 0,30 ("más suaviza el detalle recuperado") |
| Pasada final muy suave (aescaffre) | 0,15 tras LHE/HDRMT |

- "El ruido de crominancia es mayor y el ojo lo percibe 4–5 veces menos: se puede suavizar más la crominancia que la luminancia (NXT con separación color/frecuencia)."
- "Varias pasadas suaves mejor que una fuerte (una fuerte da aspecto de cera)." Alternativa de aescaffre: denoise 0,20–0,25 y detail 0,15 en lineal antes de SXT, tras estirar la L y tras estirar la RGB, y 0,15 final tras LHE/HDRMT.
- Rangos de partida de reflected-space: denoise ≤ 0,70 y detail ≤ 0,25 (a menudo menos), siempre después de la deconvolución.
- "NXT no sustituye a la señal: con poca integración, mejor menos denoise que un fondo plano artificial."

**Síntomas**

| Síntoma | Causa |
|---|---|
| Fondo moteado o "piel de naranja" | denoise demasiado alto o pocas iteraciones |
| Halos oscuros en estrellas | detail alto |
| Aspecto de cera / plástico | una pasada fuerte |

**Código**

```javascript
var v = View.viewById("Starless");
if (!v || v.isNull) throw new Error("No existe Starless");
var NXT = new NoiseXTerminator;
NXT.denoise = 0.30;        // pasada final suave
NXT.detail = 0.15;
NXT.iterations = 2;        // nombres comprobados en PixInsight 1.9.6 (módulo RCAstroSuite)
if (!NXT.executeOn(v)) throw new Error("NXT final falló");
"NXT final 0,30 sobre starless";
```

**Control.** σ del cielo antes/después (bajar un 50–80 %, nunca a cero: fondo muerto). Contraste de una zona débil (polvo, IFN, filamento): no debe bajar más de ~5 %. Imagen residual: sólo ruido; si se ven filamentos o bordes, se llevó señal.
