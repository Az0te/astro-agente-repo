# Paso 1: Análisis del objeto

[← Índice](../SKILL.md) · Anterior: [Índice](../SKILL.md) · Siguiente: [Paso 2: Inventario](02-inventario.md)

**Por qué.** El tipo de objeto decide las máscaras, el estirado, si se separan estrellas y si hacen falta tomas cortas/HDR. Procesar sin haber fijado "cuál es el tema" lleva a realzar lo que no importa y a destruir lo que sí (una nebulosa oscura con un estirado pensado para una nebulosa de emisión, por ejemplo).

**Qué hay que responder antes de tocar nada.** "Antes de procesar, clasificar el objeto y fijar qué es 'el tema' (aescaffre, target-taxonomy): tipo de señal (banda ancha, dominada por Hα, dual), zonas (núcleo–halo, filamentos, multizona), papel de las estrellas (son el objeto / contexto / distracción) y meta de señal débil (IFN, halo exterior, filamentos). Eso decide máscaras, estirado, si se separan estrellas y si hacen falta tomas cortas/HDR."

**Estrellas masivas, halos y bloat.** No se decide "a ojo": hay tres diagnósticos que no hay que confundir:

| Síntoma | Diagnóstico | Dónde se arregla |
|---|---|---|
| Fondo más azul que rojo antes de calibrar | Color del cielo y de la cámara sin calibrar, **no** blue bloat | SPCC (Paso 12) |
| Estrellas más grandes en el azul que en R/G | Blue bloat (dispersión/aberración cromática, reflexiones del filtro dual) | BXT Correct Only (Paso 11) y, si no basta, [Anexo E: blue bloat](../anexos/E-parametros-detalle.md#blue-bloat-y-halos-azules) |
| Anillos de color alrededor de una estrella brillante | Halo: nubes finas/calima en algunos subs, o reflejo instrumental | Quitar subs (Paso 3) o restar halo (Fase No Lineal 8) |
| Estrella brillante con núcleo blanco sin detalle | Saturación: en OSC los canales saturan a distinto nivel y el rojo suele saturar antes | Tomas cortas / HDRComposition (Paso 6) |

"Lo mejor es no generarlos: tomas cortas y HDR para las estrellas brillantes, y descartar subs con halos de nubes finas (índice de halo por sub)."

**Checklist del análisis**

1. Tipo de objeto y "el tema" ([Anexo D](../anexos/D-flujos-por-tipo-objeto.md): galaxia, emisión, reflexión, oscura, planetaria, resto de supernova, cúmulo, IFN).
2. ¿Hay banda estrecha? Sin ella no hay paletas.
3. Estrella más brillante del campo y magnitud: decide si hacen falta tomas cortas y a qué exposición.
4. ¿El objeto llena el campo o se difumina en el fondo? (M31, nebulosas extensas, polvo): riesgo de anillo oscuro en la corrección de gradiente y de que la IA se coma el objeto.
5. ¿Hay IFN/polvo? Desconfiar de MGC y de cualquier extractor agresivo.
6. Régimen de muestreo: submuestreado / bien muestreado / sobremuestreado (drizzle 2x), que condiciona BXT, NXT y nitidez.

**Código: estado de partida del master**

```javascript
// Estado del master: canales, bits, astrometría y estadísticas por canal.
var w = ImageWindow.windowById("MasterLight");
if (!w || w.isNull) throw new Error("No existe MasterLight");
var v = w.mainView, img = v.image, out = [];
out.push("id=" + v.id + "  canales=" + img.numberOfChannels +
         "  bits=" + img.bitsPerSample + "  color=" + img.isColor);
out.push("astrometria=" + w.hasAstrometricSolution);
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   out.push("canal " + c + ": mediana " + img.median() +
            "  max " + img.maximum() + "  MAD " + img.MAD());
}
img.resetSelections();
out.join("\n");
```

**Control.** La mediana de un master lineal está en torno a 0,001–0,02 (con pedestal puede pasar de 0,01: el de LDN 1235 da 0,0102). Si es mucho mayor (> 0,05), la imagen ya está estirada y no es la entrada correcta. Máximos por canal muy distintos = saturación desigual, no fallo de color.
