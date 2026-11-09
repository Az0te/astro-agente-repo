# Paso 12: SPCC

[← Índice](../SKILL.md) · Anterior: [Paso 11: BlurX correct only](11-bxt-correct-only.md) · Siguiente: [Paso 13: BlurX completo](13-bxt-completo.md)

**Por qué.** El color no se inventa: "El color sale de SPCC (o, sin SPCC, de BackgroundNeutralization + ColorCalibration). Si SPCC no se puede aplicar, se para.". SPCC compara el flujo medido en las estrellas con un catálogo espectrofotométrico y deduce la calibración de los canales; por eso necesita estrellas bien perfiladas (Paso 11), solución astrométrica y datos lineales.

**Requisitos, uno por uno**

| Requisito | Detalle |
|---|---|
| Solución astrométrica | Sin ella falla: "The image has no valid astrometric solution" |
| Datos lineales | "SPCC sólo sobre datos lineales. Nunca calibrar una imagen ya estirada" |
| Curvas de cámara y filtros | `pxSPCC()` de `herramientas/procesos.js`: carga las curvas por su nombre desde la base de filtros de PixInsight (`filters.xspd`). Los nombres de filtro y QE de cada equipo están en el perfil |
| `new` sin más | "Un `new SpectrophotometricColorCalibration` sin más usa curvas genéricas, no las de la cámara" |
| Referencia de blanco | `P.whiteReferenceName`; "Average Spiral Galaxy" ya es el valor por defecto. `P.whiteReferenceSpectrum` es la tabla de datos (longitud de onda, valor), **no** el nombre: da "Parsing 32-bit floating point expression: conversion error" |
| OSC | Curva QE 'Ideal' (las curvas de filtro ya incluyen la QE del sensor) y elegir bien el filtro dual band |
| Mono | Curva QE real del sensor y los filtros de la rueda |
| Narrowband | `SPCC_HA_O3_5nn`; en mono, combinar S,H,O (o H,O,O) en RGB, SPCC en modo narrowband con longitud de onda y ancho de cada filtro, y volver a extraer los canales |

**Si SPCC falla.** "Si SPCC falla, SCNR como recurso (aescaffre 0,65 en verde; nosotros preferimos suave)". No es una alternativa válida a la calibración: es un recurso estético posterior.

**A mano en PixInsight (valores de referencia)**

- Requisitos: solución astrométrica y datos lineales.
- OSC sin filtro con ventana UV/IR-cut: Sony Color Sensor R/G/B-UVIRcut y «Ideal QE curve» (valores por defecto).
- Dual band Hα/OIII 5 nm: modo narrowband con [656,3 nm, 5], [500,7, 5], [500,7, 5] y la QE del sensor.
- Probado el 31 oct 2026 (PixInsight 1.9.6): 2,4 s en 3008×3222; deja PCL:SPCC:WhiteBalanceFactors en la vista.
- Verificación: medianas del cielo por canal parecidas tras SPCC.

**SPCC en una llamada** (`herramientas/color.js`, necesita `procesos.js`): comprueba la solución astrométrica y que la imagen sea lineal, aplica `pxSPCC` con los filtros del perfil sobre una copia y mide el cielo por canal antes y después, en las zonas más oscuras, comparando la diferencia con el ruido. Devuelve los filtros usados, los factores de balance de blancos, `no_cumple` y el control. Una diferencia de más de 0,5 sigmas en el cielo sale como dominante al estirar (nebulosa dual band, nov 2026: 1,1 sigmas en lineal → 19 % azul estirada). Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "calibrarColor", "parametros": {"vista": "MasterLight", "opciones": {"nuevaVista": "MasterLight_spcc", "spcc": {}}}}
]}
```

`spcc`: filtros y QE del perfil. Devuelve los filtros, los factores de balance de blancos, cielo antes y después, `no_cumple` y el control.

**Cielo descompensado tras SPCC** (`neutralizarCielo`, en `color.js`). Si `calibrarColor` da el cielo por encima de 0,5 sigmas, o el estirado sale con dominante en el cielo (> 5 %), se neutraliza el fondo en lineal: BackgroundNeutralization aditiva, que suma a cada canal lo que le falta para igualar su cielo al del canal más alto (no resta, no recorta sombras y no cambia el balance de SPCC más que ese desplazamiento constante). Mide en las mismas zonas que el control del estirado (el 10 % de celdas de 64 px más oscuras); si esas zonas son polvo o nebulosa oscura con color propio, pasar `rect` con un trozo de cielo limpio. Vale sobre la starless lineal, sin rehacer BXT ni SXT. No es un apaño de color: es la neutralización de fondo que la guía ya admite junto a SPCC.

```json
{"llamadas": [
  {"funcion": "neutralizarCielo", "parametros": {"vista": "Starless_dn", "opciones": {"nuevaVista": "Starless_bn"}}}
]}
```

Devuelve el cielo antes y después por canal, lo sumado a cada canal, `no_cumple` y el control.

**Control.** "Comprobar la calibración de color con Statistics: medianas de R, G y B en previews de cielo limpio parecidas tras BackgroundNeutralization/SPCC; si un canal se aparta, revisar la referencia de fondo antes de seguir". Un fondo más azul que rojo **después** de SPCC ya no es "color del cielo sin calibrar": es un problema a investigar (gradiente, flats, extinción).
