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

**Informe del checkpoint**

- Solución astrométrica, bits por muestra, si es color, mediana y máximo por canal y número de pasos del historial.

**Cómo hacerlo:** en PixInsight, [Anexo J](../anexos/J-pixinsight/lineal.md#lineal-17); en Siril, [Anexo I](../anexos/I-siril.md).

La carpeta es la real de la versión (junto al master); el nombre del objeto sale de OBJECT, del nombre del master o se pregunta al usuario.

**Guardado.** "Guardar también capas lineales intermedias (incluida la HDR y sus máscaras) para poder rehacer sin repetir todo". Antes de estirar, `window.purge()` de las vistas temporales: "cada imagen RGB f32 de ~11k×7k ocupa ~1 GB y cada paso añade historial de deshacer. Cerrar vistas temporales y usar `window.purge()` tras pasos pesados".

**Estado para la fase no lineal.** La fase lineal termina aquí: escribir `<carpeta de la versión>/estado.md` y cerrar la sesión. La fase no lineal empieza en una sesión nueva leyendo `SKILL.md`, `perfil.md` y este fichero, sin nada de la fase lineal.

```markdown
# Estado al final de la fase lineal: <objeto> <versión>
- Ficheros: <ruta del master lineal guardado>; estrellas lineales: <ruta o "no separadas">; starless: <ruta>; otros (Hα, OIII, HDR, máscaras): <rutas>
- Datos: <cámara, filtros, tiempo total, combinación prevista (RGB, HOO, Hα+RGB…)>
- Hecho (según el historial): <gradiente: método y parámetros>; BXT CO; SPCC <filtros/QE>; BXT <valores>; SXT; NXT <valor> sobre <vista>
- Medidas del checkpoint: medianas R/G/B <…>; % recortado por canal <…>; WCS <sí/no>; FWHM por canal <…>
- Decisiones y avisos: <lo que el usuario eligió, lo que falló o quedó dudoso, lo que no se debe repetir>
- Siguiente: Paso 1 no lineal (estirado) sobre <vista/fichero>
```

---
