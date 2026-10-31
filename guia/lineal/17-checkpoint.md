# Paso 17: Checkpoint

[← Índice](../SKILL.md) · Anterior: [Paso 16: LinearFit / sustracción de continuo](16-linearfit-continuo.md) · Siguiente: [Índice](../SKILL.md)

**Por qué.** Antes de estirar hay que congelar un estado que se pueda comparar: "Trabajar sobre una copia con nombre de versión, nunca sobre el master" y "guardar capas lineales intermedias para poder rehacer sin repetir todo". A partir de aquí todo es irreversible en la práctica (estirado, recortes de altas luces) y el control objetivo se pierde si no hay una referencia.

**Lista de control del checkpoint lineal**

| Control | Umbral |
|---|---|
| Sigue lineal | mediana del orden de 0,001–0,02 (con pedestal puede pasar de 0,01) y ningún estirado en el historial. Los objetivos de fondo 0,10 / 0,15–0,25 son para después de estirar |
| Color del fondo | medianas R, G y B de cielo limpio parecidas tras SPCC |
| Canales recortados | % de píxeles a 1 por canal anotado; ningún paso del procesado ha recortado un canal |
| Solución astrométrica | `hasAstrometricSolution === true` |
| Estrellas | redondas y sin halos anómalos; FWHM por canal comparable |
| Ringing | 0 (cambios de signo de la derivada > 0,01 en el perfil radial) |
| Núcleos | < 2 % de píxeles > 0,93 en el núcleo de 128×128 px y < 10 % en el de 32×32 |
| Ruido | σ de cielo coherente; sin moteado de color |
| Historial | coincide con lo que se cree haber hecho |

**Código: informe del checkpoint**

```javascript
var v = View.viewById("MasterLight_v3");
if (!v || v.isNull) throw new Error("No existe MasterLight_v3");
var w = ImageWindow.windowById("MasterLight_v3"), img = v.image, out = [];
out.push("WCS: " + w.hasAstrometricSolution);
out.push("bits: " + img.bitsPerSample + "  color: " + img.isColor);
for (var c = 0; c < img.numberOfChannels; ++c) {
   img.selectedChannel = c;
   out.push("canal " + c + ": mediana " + img.median() + "  max " + img.maximum());
}
img.resetSelections();
out.push("pasos en historial: " + v.processing.length);
out.join("\n");
```

**Guardado.** "Guardar también capas lineales intermedias (incluida la HDR y sus máscaras) para poder rehacer sin repetir todo". Antes de estirar, `window.purge()` de las vistas temporales: "cada imagen RGB f32 de ~11k×7k ocupa ~1 GB y cada paso añade historial de deshacer. Cerrar vistas temporales y usar `window.purge()` tras pasos pesados".

---
