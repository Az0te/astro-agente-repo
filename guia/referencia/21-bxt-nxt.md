# BXT y NXT: sacarles todo el partido (revisión oct 2026)
Hasta ahora sólo se usó BXT completo (IC 63, halos 0,00) y NXT en una o dos pasadas con denoise fijo (0,75; LDN 1235 con separación de color). Quedaban sin usar: Correct Only, PSF manual, ajustes por objeto, iteraciones, separación HF/LF y, sobre todo, **elegir los parámetros con medidas**.
## Orden lineal (OSC)
Recorte → ImageSolver (usuario) → **BXT Correct Only** → copiar astrometría → corrección de gradiente (**GraXpert IA** por defecto, que ya devuelve la astrometría copiada; SPFC antes sólo si se usa MGC) → SPCC → (HDR con la corta si procede) → **BXT completo** → SXT (`unscreen=false`) → **NXT** sobre la starless (y suave sobre las estrellas si hace falta) → estirado → NXT final suave opcional.
- **Nunca NR antes de BXT** (RC-Astro): el ruido fino es información para la deconvolución. BXT siempre antes de SXT (usa las estrellas como referencia de PSF).
- BXT y NXT sólo en lineal para la deconvolución; NXT funciona también en no lineal (se entrenó con imágenes estiradas): pasada final suave tras estirar es válida.
## BlurXTerminator
- **Correct Only** corrige astigmatismo, coma, desenfoque de guiado, FWHM distinta por canal y aberración cromática sin tocar lo no estelar. Mejora las estrellas que mide SPCC. En IC 63 los FWHM por canal (R 4,4 / G 3,7 / B 4,0 px) indicaban que habría servido.
- **Variante sólo Correct Only** (sin pasada completa): cúmulos, campos estelares, datos de SNR bajo o cuando la pasada completa crea textura.
- **Valores de partida por objeto** (dosieres de la comunidad, contrastar con la rejilla):
  | Objeto | Sharpen stars | Sharpen nonstellar |
  |---|---|---|
  | Galaxias | 0,15–0,20 | 0,20–0,35 |
  | Nebulosas grandes | 0,25–0,40 | 0,50–0,70 |
  | Cúmulos / campo estelar | 0,20–0,30 | 0,00–0,20 |
  | SNR bajo | 0,10–0,20 | 0,10–0,25 |
  Con drizzle 2x (sobremuestreo) tomar el extremo bajo del rango no estelar. Por encima de ~0,8 en datos con ruido aparecen texturas "crujientes".
- **PSF manual** (Automatic PSF off, diámetro = FWHM medido; SPFC deja `PCL:SPFC:FWHMx/FWHMy`): campos con pocas estrellas, nebulosa que llena el campo o deconvolución de una starless. Un valor aproximado basta.
- **Núcleos saturados en color lineal:** BXT puede dejarlos casi blancos. En estrellas como γ Cas, pasar BXT sobre la HDR (larga + corta) o enmascarar los núcleos saturados.
- **Gusanos:** si BXT los crea (no estelar alto), NXT los acentúa: bajar BXT, no subir NXT.
- Para mono LRGB/SHO: BXT sobre el RGB combinado mejor que por canal (la red entiende las relaciones de color); Correct Only por canal sólo si las aberraciones difieren mucho.
## NoiseXTerminator
- **Parámetros que no usábamos:** `iterations` (más iteraciones conservan mejor el detalle débil y limpian el moteado de gran escala; 2–5), separación **HF/LF** (moteado de fondo = baja frecuencia; ajustar la escala poniendo temporalmente LF a 0 con vista previa), **tile overlap** 0,50 si aparecen bloques. Confirmar los nombres PJSR con `describe_process NoiseXTerminator` antes de usarlos.
- **Partida:** denoise 0,70–0,80 (no el 0,90 por defecto), detail 0,10–0,20 (más alto crea halos oscuros en estrellas), iterations 2–3; separación de color con croma > luminancia (LDN 1235: croma 0,90, luminancia 0,40, detail 0,25). Pasada final post-estirado 0,50–0,70.
- Síntomas: fondo moteado o "piel de naranja" = denoise demasiado alto o pocas iteraciones; halos oscuros en estrellas = detail alto; aspecto de cera = una pasada fuerte (mejor varias suaves, ver `05-flujos-astro-photographie.md`).
- NXT no sustituye a la señal: con poca integración, mejor menos denoise que un fondo plano artificial.
## Rejilla de variantes con medidas (lo que más rinde con el watcher)
1. Recorte representativo de ~1500 px con objeto débil, fondo y alguna estrella brillante (más rápido que la imagen entera y por debajo del corte de 60 s).
2. **BXT:** nonstellar 0,25 / 0,45 / 0,65 (estrellas fijo 0,25–0,30). Medir: FWHM mediano de estrellas, ringing (perfil radial de la estrella más brillante, cambios de signo > 0,01), gusanos al 100 %, contraste en cajas del objeto.
3. **NXT** (sobre la starless de la BXT ganadora): denoise 0,50 / 0,70 / 0,85 × iterations 2 / 5, y una variante con separación de color. Medir en cajas fijas:
   - σ del cielo: bajar un 50–80 %, nunca a cero (fondo muerto).
   - Contraste de una zona débil (polvo, IFN, filamento): no debe bajar más de ~5 %.
   - Imagen residual (antes − después): sólo ruido; si se ven filamentos, polvo o bordes, se llevó señal.
   - FWHM de estrellas en la imagen con estrellas (si se aplica allí): no debe subir.
4. Plancha de recortes al 100 % con el mismo STF y CSV de métricas en `<versión>/tests/`; elegir la ganadora y anotar los valores en el dossier y en la tabla de abajo.
5. Aplicar la ganadora a la imagen entera (esperar con `watcher_status`: NXT ≈ 30 s, BXT más).
## Resultados de la rejilla
| Objeto | BXT CO | BXT stars / nonstellar | NXT denoise / detail / iter / separación | Notas |
|---|---|---|---|---|
| IC 63 v4 (previo) | no | ? / ? (halos 0,00) | 0,5–0,8 + 0,75 + 0,30 | sin rejilla |
| LDN 1235 (previo) | no | sin registro | croma 0,90 / lum 0,40 / det 0,25 | 0,75 por igual dio plástico |
## Sobre los dosieres recibidos (oct 2026)
De cuatro dosieres sobre BXT/NXT generados con IA que circularon en oct 2026, dos (BXT "exhaustivo" y NXT "dosier exhaustivo") coinciden con RC-Astro y se han usado. Los otros dos tienen errores: uno pone SPCC antes de la extracción de gradiente (choca con MGC, cuya cadena es SPFC → MGC → SPCC) y otro inventa un parámetro "Linear/Non-linear" de NXT, cifras de rendimiento sin fuente y la regla de "sólo en lineal". No usarlos como referencia.
