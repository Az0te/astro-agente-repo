# Paso 11: BlurX correct only

[← Índice](../SKILL.md) · Anterior: [Paso 10: Combinación RGB / NB](10-combinacion-rgb-nb.md) · Siguiente: [Paso 12: SPCC](12-spcc.md)

**Por qué.** "**Correct Only** corrige astigmatismo, coma, desenfoque de guiado, FWHM distinta por canal y aberración cromática sin tocar lo no estelar. Mejora las estrellas que mide SPCC.". Se hace **antes de SPCC** porque SPCC mide el color de las estrellas: si las estrellas están deformadas y con halos cromáticos, la calibración se hace sobre un perfil equivocado. Y se hace en **lineal**, porque la deconvolución sólo tiene sentido sobre datos sin estirar.

**Qué corrige y qué no**

| Sí | No |
|---|---|
| Astigmatismo, coma, desenfoque de guiado | No toca lo no estelar en modo Correct Only |
| FWHM distinta por canal (diagnóstico de blue bloat) | No sustituye a la corrección de gradiente |
| Aberración cromática longitudinal y lateral | No es un denoise |

**Variantes documentadas**

- "**Variante sólo Correct Only** (sin pasada completa): cúmulos, campos estelares, datos de SNR bajo o cuando la pasada completa crea textura."
- "Si las aberraciones difieren por canal: Correct Only por canal (ChannelExtraction), recombinar y BXT de nuevo (ojo: deconvolución independiente por canal puede desequilibrar colores)."
- "Para mono LRGB/SHO: BXT sobre el RGB combinado mejor que por canal (la red entiende las relaciones de color); Correct Only por canal sólo si las aberraciones difieren mucho."

**Diagnóstico previo (¿hace falta halos negativos?)**

- "En IC 63 los FWHM por canal (R 4,4 / G 3,7 / B 4,0 px) indicaban que habría servido."
- SPFC deja en la vista `PCL:SPFC:FWHMx/FWHMy` por canal: "en IC63 v4 (R 4,4 / G 3,7 / B 4,0 px) no había blue bloat y se usó halos 0,00".
- Regla: "Usar −0,30 sólo si hay blue bloat y comprobar anillos oscuros al 100 % alrededor de estrellas brillantes".

**Astrometría.** "BlurXTerminator elimina la solución astrométrica de la vista (aescaffre): tras BXT, `copyAstrometricSolution` desde el master original antes de SPFC/SPCC". Matiz del mismo archivo: "BXT, en cambio, la conservó en PI 1.9.5: comprobar `hasAstrometricSolution` en vez de suponer". Tras BXT CO: volver a resolver con `blindSolve` (más simple) o copiar la solución.

**Código**

```javascript
var v = View.viewById("MasterLight");
if (v.isNull) throw new Error("No existe MasterLight");
var BXT = new BlurXTerminator;
// nombres leídos de instancias guardadas (oct 2026); confirmar con describe_process cuando el módulo RCAstroSuite esté cargado
BXT.correct_only = true;
BXT.auto_nonstellar_psf = true;   // o PSF manual: false y nonstellar_diameter = FWHM medido
if (!BXT.executeOn(v)) throw new Error("BXT Correct Only falló");

// Comprobar/restaurar la astrometría antes de SPCC
var w = ImageWindow.windowById("MasterLight");
if (!w.hasAstrometricSolution) {
   var r = blindSolve("MasterLight");      // v8; con el clasico, que lo resuelva el usuario
   if (!r) throw new Error("Sin WCS tras BXT: no seguir a SPCC");
}
"BXT CO + WCS OK";
```

**Control.** Comparar el perfil de una estrella brillante antes/después (FWHM por canal más parecido, sin anillos). Ringing = 0 (contar cambios de signo de la derivada del perfil radial con amplitud > 0,01; ver [Anexo B](../anexos/B-checklist-entrega.md)). `hasAstrometricSolution === true` antes de seguir.
