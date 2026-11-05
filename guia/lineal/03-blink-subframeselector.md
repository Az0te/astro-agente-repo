# Paso 3: Blink / SubframeSelector

[← Índice](../SKILL.md) · Anterior: [Paso 2: Inventario](02-inventario.md) · Siguiente: [Paso 4: Preprocesado](04-preprocesado.md)

**Por qué.** Las métricas no lo detectan todo: "las métricas no detectan errores de guiado concretos ni **halos alrededor de estrellas brillantes por nubes finas o calima**; quitar esos subs antes de integrar (si no, el halo queda en el master)". Y al contrario: quitar subs buenos cuesta señal (√N), así que el criterio no puede ser "descartar por debajo de un número".

**Blink (obligatorio, no sustituible por métricas)**

- Quitar subs con halos por nubes finas o calima.
- **No** quitar subs con trazas de satélite: "las elimina el rechazo".
- Mover los descartes **fuera de las carpetas LIGHT** (`<objeto>/_rechazados/<noche>/`), "porque WBPP añade directorios de forma recursiva, y guardar la lista de movimientos".

**SubframeSelector (umbrales de partida, orientativos)**

| Métrica | Excelente | Quitar |
|---|---|---|
| FWHM | < 2,2" | > 3,5" |
| Excentricidad | < 0,42 | > 0,65 |
| Estrellas detectadas | — | < ½ del mejor sub = nube fina (puede dar FWHM engañosamente bueno) |

Escala del sub = 206,265·píxel(µm)/focal(mm).

**Criterio NOVA:** "descartar primero por pocas estrellas (< 20), excentricidad > 0,66, gradiente fuerte o cielo > 3× el de la sesión, y luego ordenar por `FWHM·(1 + excentricidad)` y quitar el ~10 % peor; son valores de ingeniería, no óptimos". No mezclar en un mismo ranking paneles, filtros o exposiciones distintas.

**En una llamada (PixInsight 1.9.6+, ImageAnalysis)** (`herramientas/preproceso.js`): `seleccionarSubs(carpeta o lista, { csv })` mide los subs con ImageAnalysis (sin abrir ventanas, ~1 s por sub) y, dentro de cada grupo de carpeta, filtro y exposición, rechaza por FWHM > cuartil inferior + 50 %, excentricidad > mediana + 0,10 o extinción por nubes con z robusto > 2,5. Con FWHM entre +35 y +50 % , excentricidad entre +0,07 y +0,10 o nubes con z entre 1,5 y 2,5 los aprueba, pero los lista en `dudosos` para que decida el usuario. En subs crudos CFA la excentricidad sube cuando las estrellas son más pequeñas: en M31 los subs de mejor FWHM tenían +0,08. Devuelve el número de aprobados y `lista_aprobados` (fichero con una ruta por línea, para WBPP), rechazados con su motivo, pesos (PSF Signal Weight relativo) y los subs con trazos (sólo anotados). ImageAnalysis sustituye a SubframeSelector.

```javascript
eval(File.readTextFile("<ruta de guia>/herramientas/preproceso.js"));   // en el nivel superior del script
JSON.stringify(seleccionarSubs("<carpeta LIGHT de una noche>", { csv: "<carpeta>/seleccion.csv" }));
```

Comprobado con subs crudos CFA (nov 2026):

| Datos | Resultado |
|---|---|
| LDN 1235, 11-9 (16 subs, 8 descartados a mano en octubre) | Rechaza T0012–T0013 (FWHM), T0028 (nubes; en octubre, "−9 % de estrellas") y T0031 (excentricidad). T0014–T0016 y T0032 salen como dudosos. |
| LDN 1235, 11-9 completa (27 subs) | Rechaza T0012–T0016 (FWHM); T0028–T0029 (nubes), T0031 (excentricidad) y 3 por FWHM salen como dudosos. Con más subs el cuartil inferior baja y la nube de T0028 pesa menos: el resultado depende del conjunto. |
| LDN 1235, 19-9 (35 subs, todos integrados) | Ningún rechazo; 6 dudosos por FWHM (+36 a +49 %). |
| M31, 7-9 (1 de cada 6, 25 subs; FWHM de 4,2 a 1,6 px a lo largo de la noche) | Rechaza los 4 primeros (FWHM) y 1 por nubes; 7 dudosos. Va en la línea del master "amplio" de la v6 (FWHM ≤ 6,1″). |
| IC 1396, 13-9 (dual band 300 s y RGB 30 s) | Separa los dos grupos y no rechaza ninguno. |
| IC 63, 10-10 (120 s y 30 s) | 1 rechazado por nubes y 1 dudoso. |

Los umbrales son de partida: no sustituyen al Blink de halos y nubes finas.

**Índice de halo por sub** (para localizar los subs que forman halos). Receta probada en IC63 v4, γ Cas, 379 subs RGB en ~3 min:

1. Abrir el FITS bruto (CFA) e `IntegerResample −2 (Average)` como luminancia.
2. Localizar la estrella en una copia `resample(1/16)` y centroide de píxeles > 0,5·máx.
3. Anillos en píxeles binados: **interno 15–25, medio 40–70, externo 80–170, cielo 330–400**.
4. Estadístico de cada anillo = **media recortada entre los percentiles 20 y 60** (la mediana de enteros ADU sale cuantizada).
5. Índice = (externo − cielo)/(interno − cielo).

| Resultado | Valor |
|---|---|
| Subs limpios | ≈ 0,017 (muy estable) |
| Umbral en 120 s | 0,022 (≈ +30 %) |
| Umbral en 30 s | 0,03 |
| Casos encontrados | 69/330 subs de 120 s y 2/49 de 30 s con nube fina (hasta ×9) |

En dual band la estrella es débil y la detección falla: usar el **cielo del sub (mediana) > 1,25× la mediana de la sesión** junto con la caída del ala interna.

**Expectativa realista, literal:** "WBPP con pesos PSF Signal Weight ya daba poco peso a los subs nublados. Al reintegrar sin ellos, el halo de γ Cas bajó sólo un 5 % a 6′ y un 35 % a 15′. El halo que queda está en todos los subs limpios (dispersión de óptica/atmósfera + reflexión real): se trata en el procesado, no quitando más subs."

**Código: estadístico de anillo (media recortada p20–p60)**

```javascript
// Media recortada entre los percentiles 20 y 60 de un anillo.
// img: luminancia ya binada; (cx,cy) centroide; radios en píxeles de esa imagen.
function ringTrimmedMean(img, cx, cy, r0, r1) {
   var vals = [], x, y, d2, r0sq = r0 * r0, r1sq = r1 * r1;
   var fila = new Float32Array(img.width);
   for (y = Math.max(0, Math.floor(cy - r1)); y <= Math.min(img.height - 1, Math.ceil(cy + r1)); ++y) {
      img.getSamples(fila, new Rect(0, y, img.width, y + 1), 0);
      for (x = 0; x < img.width; ++x) {
         d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
         if (d2 >= r0sq && d2 < r1sq) vals.push(fila[x]);
      }
   }
   if (vals.length < 20) throw new Error("Anillo con muy pocos píxeles");
   vals.sort(function (a, b) { return a - b; });
   var i0 = Math.floor(vals.length * 0.20), i1 = Math.floor(vals.length * 0.60), s = 0;
   for (var i = i0; i <= i1; ++i) s += vals[i];
   return s / (i1 - i0 + 1);
}
// indice = (ring(externo) - ring(cielo)) / (ring(interno) - ring(cielo))
```

**Control.** Comparar los dudosos con una plancha de recortes de la estrella con el mismo estirado. En los subs cortos (30 s), que son los que darán las estrellas, ser especialmente exigente con halos y FWHM. Revisar en el log de WBPP cuántos subs integró cada grupo: "el SubframeSelector descartó por su cuenta ~65 de 204 subs del dual band".
