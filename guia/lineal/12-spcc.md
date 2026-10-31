# Paso 12: SPCC

[← Índice](../SKILL.md) · Anterior: [Paso 11: BlurX correct only](11-bxt-correct-only.md) · Siguiente: [Paso 13: BlurX completo](13-bxt-completo.md)

**Por qué.** El color no se inventa: "El color sale de SPCC (o, sin SPCC, de BackgroundNeutralization + ColorCalibration). Si SPCC no se puede aplicar, se para.". SPCC compara el flujo medido en las estrellas con un catálogo espectrofotométrico y deduce la calibración de los canales; por eso necesita estrellas bien perfiladas (Paso 11), solución astrométrica y datos lineales.

**Requisitos, uno por uno**

| Requisito | Detalle |
|---|---|
| Solución astrométrica | Sin ella falla: "The image has no valid astrometric solution" |
| Datos lineales | "SPCC sólo sobre datos lineales. Nunca calibrar una imagen ya estirada" |
| Curvas de cámara y filtros | Usar el **icono del usuario** (`ProcessInstance.fromIcon("SPCC_RGB")`, o el de su filtro), que ya trae las curvas y la referencia de blanco |
| `new` sin más | "Un `new SpectrophotometricColorCalibration` sin más usa curvas genéricas, no las de la cámara" |
| Referencia de blanco | `P.whiteReferenceName`; "Average Spiral Galaxy" ya es el valor por defecto. `P.whiteReferenceSpectrum` es la tabla de datos (longitud de onda, valor), **no** el nombre: da "Parsing 32-bit floating point expression: conversion error" |
| OSC | Curva QE 'Ideal' (las curvas de filtro ya incluyen la QE del sensor) y elegir bien el filtro dual band |
| Mono | Curva QE real del sensor y los filtros de la rueda |
| Narrowband | `SPCC_HA_O3_5nn`; en mono, combinar S,H,O (o H,O,O) en RGB, SPCC en modo narrowband con longitud de onda y ancho de cada filtro, y volver a extraer los canales |

**Si SPCC falla.** "Si SPCC falla, SCNR como recurso (aescaffre 0,65 en verde; nosotros preferimos suave)". No es una alternativa válida a la calibración: es un recurso estético posterior.

**Código**

```javascript
var v = View.viewById("MasterLight");
if (v.isNull) throw new Error("No existe MasterLight");
var w = ImageWindow.windowById("MasterLight");
if (!w.hasAstrometricSolution) throw new Error("Sin WCS: SPCC fallaría");

var spcc = ProcessInstance.fromIcon("SPCC_RGB");   // trae curvas de cámara y filtros
if (spcc === null) throw new Error("Falta el icono SPCC_RGB en el workspace");
if (!spcc.executeOn(v)) throw new Error("SPCC falló");

// Verificación: medianas de cielo por canal tras SPCC (deben quedar parecidas)
var img = v.image, out = [];
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   out.push("canal " + c + " mediana " + img.median());
}
img.resetSelections();
out.join("\n");
```

**Control.** "Comprobar la calibración de color con Statistics: medianas de R, G y B en previews de cielo limpio parecidas tras BackgroundNeutralization/SPCC; si un canal se aparta, revisar la referencia de fondo antes de seguir". Un fondo más azul que rojo **después** de SPCC ya no es "color del cielo sin calibrar": es un problema a investigar (gradiente, flats, extinción).
