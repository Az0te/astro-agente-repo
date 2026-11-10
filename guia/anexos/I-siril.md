# Anexo I: cómo se hace cada paso en Siril

[← Índice](../SKILL.md)

Bajo demanda: sólo hace falta con el servidor **sirilastropilot** conectado (Siril 1.4 con el script SirilAstroPilot lanzado). Las fichas dicen **qué** hacer y con **qué criterios**; aquí sólo está **con qué herramienta o comando de Siril**. Los nombres de las medidas son los mismos que en las fichas.

## Cómo funciona

- Siril tiene **una sola imagen cargada**: no hay vistas ni ids. Las herramientas trabajan siempre sobre ella; valores en 0–1, coordenadas como en pantalla.
- Las herramientas **…Candidatos** comparan sin tocar la imagen: aplican cada candidato, lo miden, lo guardan aparte y dejan la imagen como estaba. El elegido se pone con `aplicarCandidato(id)` (exactamente el que se midió, con deshacer). Si la imagen cambió entre medias, se niega.
- Las que cambian la imagen dejan deshacer (`deshacer`, `rehacer`). Guardar cada versión con `guardarImagen` (nunca sobre el master) antes del paso siguiente.
- `previa` da un JPG con el autoestirado de Siril (o un recorte al 100 % con `rect`) para mirar; `estadisticas` mide; `registro` enseña la consola de Siril cuando algo falla.
- `comandoSiril` ejecuta un comando de procesado de una lista blanca (nada que cargue, guarde o lance scripts). Sólo para lo que no tenga herramienta.
- Programas externos que se usan si están instalados: GraXpert (fondo), StarNet2 y StarX (estrellas), y la IA de RC Astro por su programa de línea de comandos (`rc-astro`: StarX, NoiseX, BlurX, con la licencia que ya se tenga).

## Fase lineal

| Paso | Herramienta | Con qué en Siril | Medidas que devuelve |
|---|---|---|---|
| 1 Análisis | `analizarMaster` | cabecera, estadísticas, detección de estrellas | escala, lineal, fondo 3×3, bordes sin datos (p95 por lado, `cunas_pct`), FWHM y redondez |
| 5 Recorte | `recortarBordes` | `crop` | rectángulo sin cuñas, píxeles quitados por lado |
| 8 Astrometría | `resolverAstrometria` | `platesolve` (catálogo local de Gaia si está instalado: `catalogo: "localgaia"`) | resuelta, AR/Dec, focal, píxel |
| 9 Gradiente | `gradienteCandidatos` → `aplicarCandidato` | `subsky` polinomio 1 y 2, `subsky -rbf`, GraXpert IA | `copia_objeto`, `objeto_quitado_pct`, `gradiente_restante`, `irregularidad_cielo`, `objeto_campo_pct` |
| 11/13 Deconvolución | `nitidezLineal` | BlurX por `rc-astro bxt` (solo corregir o completa) | FWHM y redondez antes y después |
| 12 Color | `listaSPCC`, `calibrarColor` | `spcc` (sensor, filtro y blanco del perfil con los nombres que da `listaSPCC`) | cielo por canal antes y después, `dominante_cielo_pct` |
| 14 Ruido suave | `reducirRuidoCandidatos` (con `ia` para NoiseX) | `denoise` a 0,5 / 0,7 / 1,0, DA3D, NoiseX por `rc-astro nxt` | `ruido_rel`, `ruido_grueso_rel`, `detalle_perdido_pct` |
| 15 Estrellas | `estrellasCandidatos` → `aplicarCandidato` | StarNet2 (ejecutable directo) y StarX (`rc-astro sxt`) | `restos_estrellas_pct`, `agujeros_pct`, `objeto_quitado_pct`; ruta de la capa de estrellas |
| 15 Estrellas (uno solo) | `separarEstrellas` | `starnet` de Siril o StarNet2 directo | starless cargada, capa de estrellas en fichero |

Notas de la fase lineal:

- **Gradiente.** `gradiente_restante` es la inclinación del plano del cielo que queda (después / antes). Cuando la nebulosa ocupa casi todo el campo, el cielo más oscuro también es nebulosa y la cifra no es fiable (IC 1396: 0,55–0,75 con modelos limpios): decide por `copia_objeto` y mirando la previa.
- **Color.** SPCC necesita la astrometría. Si el catálogo en línea no responde, instalar el catálogo local con el script de instalación de catálogos de Siril.
- **Estrellas.** En campos de Vía Láctea `objeto_quitado_pct` sale alto en todos los motores (quitan también estrellas débiles sin resolver): compara motores entre sí y mira un recorte.

## Fase no lineal

| Paso | Herramienta | Con qué en Siril | Medidas que devuelve |
|---|---|---|---|
| 1 Estirado | `estirarCandidatos` → `aplicarCandidato` | `ght` por pasadas cortas al fallo, `asinh` al fallo, `autostretch`; punto negro por canal | `cielo`, `ruido_rel`, `separacion`, `dominante_cielo_pct`, `cero_pct`, `alto_pct`, `no_cumple` |
| 3 SCNR | `quitarVerde` | `rmgreen` (sólo si el verde del cielo sobra) | cielo RGB antes y después |
| 5 Contraste | `contrasteCandidatos` → `aplicarCandidato` | `clahe` 1,5 y 2,5; `wavelet` + `wrecons` (escalas medias); `unsharp` | `contraste_ganado_pct`, `ruido_rel`, recortes |
| 5 Saturación | `saturacionCandidatos` → `aplicarCandidato` | `satu` 0,25 / 0,5 / 0,75 con factor de fondo 1 | `sat_objeto`, `sat_cielo`, `dominante_cielo_pct`, recortes |
| 6 Ruido | `reducirRuidoCandidatos` | como en el Paso 14 lineal | si no hay detalle medible, regla prudente: la pasada más suave que baja el ruido del cielo ≥ 20 % |
| 9 Recombinación | `recombinarEstrellas` | screen 1 − (1 − a)(1 − k·b) o suma, con la capa de estrellas del Paso 15 | `aporte_estrellas_pct`, fondo antes y después, recortes |
| 10 Exportación | `exportarFinal` | `savetif` (16 bits) y `savejpg` 95 | rutas y tamaños; no sobrescribe (_2, _3…) |

Notas de la fase no lineal:

- **Estirado.** El punto negro por canal (`negro_por_canal`, por defecto) evita que una dominante pequeña del lineal se haga grande al restar mucho fondo (IC 1396: de 1,5 % a 8,7 % con un punto negro común; 0,0 % por canal).
- **Recombinación.** La capa de estrellas sale lineal del Paso 15: con la starless ya estirada, `recombinarEstrellas` avisa y, con `estirar_estrellas: true`, la estira con arcsinh hasta que el p90 de los píxeles de estrella sea ≈ 0,10.
- **Contraste.** CLAHE da mucho contraste pero sube el ruido del cielo (IC 1396: ×1,3–1,55); el límite por defecto es ×1,25.

## Pasos sin herramienta propia en Siril

Preprocesado y apilado (fase lineal 2–4, 6–7), combinación de canales y paletas (lineal 10, no lineal 2), HDR, máscaras (no lineal 4), núcleo de galaxias y dossier: con los scripts y comandos de Siril a mano (`comandoSiril` para lo que esté en la lista blanca), siguiendo los criterios de la ficha.
