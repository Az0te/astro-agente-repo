# Anexo I: cómo se hace cada paso en Siril

[← Índice](../SKILL.md)

Bajo demanda: sólo hace falta con el servidor **sirilastropilot** conectado (Siril 1.4 con el script SirilAstroPilot lanzado). Las fichas dicen **qué** hacer y con **qué criterios**; aquí sólo está **con qué herramienta o comando de Siril**. Los nombres de las medidas son los mismos que en las fichas.

<a id="arranque"></a>
## Arranque en Siril (leer con SKILL.md)

**Entorno.** Siril 1.4 con el script SirilAstroPilot lanzado (puente) y el servidor MCP `sirilastropilot`, o el chat de SirilAstroPilot. Cada herramienta es una entrada del manifiesto de Siril, con sus parámetros. El agente no escribe comandos de Siril salvo con `comandoSiril` (lista blanca).

**Herramientas por paso** (en negrita las que comparan; el elegido se pone con `aplicarCandidato`)

| Paso | Herramientas |
|---|---|
| L1 Análisis | `analizarMaster`, `estrellas`; con internet `documentarObjeto`, `simbad`, `wikipedia`, `leerWeb` |
| L2 Inventario | `inventarioSubs` (sólo cabeceras) |
| L3–L4 Selección, calibración y apilado | `revisarCalibracion` → **`apilarCandidatos`** (deja el master cargado) |
| L5 Recorte | `recortarBordes` |
| L8 Astrometría | `resolverAstrometria` |
| L9 Gradiente | **`gradienteCandidatos`** → `aplicarCandidato` |
| L11 / L13 Deconvolución | `nitidezLineal` (solo corregir o completa) |
| L12 Color | `listaSPCC` → `calibrarColor` |
| L14 Ruido suave | **`reducirRuidoCandidatos`** → `aplicarCandidato` |
| L15 Estrellas | **`estrellasCandidatos`** → `aplicarCandidato`, o `separarEstrellas` |
| NL1 Estirado | **`estirarCandidatos`** → `aplicarCandidato` |
| NL2 Paleta (banda estrecha) | **`paletasCandidatos`** → `aplicarCandidato` |
| NL3 Verde | `quitarVerde` |
| NL5 Realces | **`contrasteCandidatos`**, **`saturacionCandidatos`** → `aplicarCandidato` |
| NL6 Ruido final | **`reducirRuidoCandidatos`** → `aplicarCandidato` |
| NL9 Recombinación | `recombinarEstrellas` |
| NL10 Exportación | `exportarFinal` |
| Sin herramienta | L6, L7, L10, L16, L17, NL4, NL7, NL8, NL11: la ficha, con `comandoSiril` para lo que esté en la lista blanca |

**Siempre disponibles:** `ping`, `imagen` (datos de la imagen cargada), `estadisticas`, `previa`, `registro` (consola de Siril), `abrirImagen`, `guardarImagen`, `deshacer`, `rehacer`, `comandoSiril`, `estado` (trabajos largos), `medirRendimiento`.

**Internet.** `documentarObjeto` (identifica el objeto por OBJECT o por la astrometría y junta tipo, señal esperada, resumen y estrellas brillantes del campo), `simbad`, `wikipedia` y `leerWeb` (sólo https). Sólo con la casilla Internet del chat marcada; si no, se niegan: no reintentar.

**Guardar.** Siril abre XISF pero no lo guarda: las versiones van en `.fit` (32 bits en coma flotante, como el master).

## Cómo funciona

- Siril tiene **una sola imagen cargada**: no hay vistas ni ids. Las herramientas trabajan siempre sobre ella; valores en 0–1, coordenadas como en pantalla.
- Las herramientas **…Candidatos** comparan sin tocar la imagen: aplican cada candidato, lo miden, lo guardan aparte (con una miniatura del resultado y otra de lo que quita, para la galería del chat) y dejan la imagen como estaba. El elegido se pone con `aplicarCandidato(id)` (exactamente el que se midió, con deshacer). Si la imagen cambió entre medias, se niega.
- Las que cambian la imagen dejan deshacer (`deshacer`, `rehacer`). Guardar cada versión con `guardarImagen` (nunca sobre el master) antes del paso siguiente.
- `previa` da un JPG con el autoestirado de Siril (o un recorte al 100 % con `rect`) para mirar; en lineal, por canal (un master sin calibrar sale azul o verde con el enlazado); `estadisticas` mide; `registro` enseña la consola de Siril cuando algo falla.
- `comandoSiril` ejecuta un comando de procesado de una lista blanca (nada que cargue, guarde o lance scripts). Sólo para lo que no tenga herramienta.
- Programas externos que se usan si están instalados: GraXpert (fondo), StarNet2 y StarX (estrellas), y la IA de RC Astro por su programa de línea de comandos (`rc-astro`: StarX, NoiseX, BlurX, con la licencia que ya se tenga).

## Preprocesado y apilado

| Paso | Herramienta | Con qué en Siril | Medidas que devuelve |
|---|---|---|---|
| 2 Inventario | `inventarioSubs` | cabeceras FITS (IMAGETYP o carpeta) | grupos por tipo, filtro, exposición, gain, offset, binning, tamaño y noche; avisos |
| 4 Calibración | `revisarCalibracion` | — | darks, flats y bias (o darks de flats) de cada grupo de lights; qué falta o no encaja |
| 3–4 Apilado | `apilarCandidatos` | `convert`, `stack` (masters), `calibrate` (`-cc=dark`, y `-cfa -equalize_cfa -debayer` en OSC), `register -2pass`, `seqapplyreg -filter-incl`, `stack … rej` con rechazo winsorized, ESD generalizado o ajuste lineal, con y sin `-weight=wfwhm` | por sub: FWHM ponderada, redondez, estrellas y fondo (se descartan los que pasan de k MAD, como mucho un 30 %); por master: ruido de fondo, FWHM, estrellas, píxeles calientes sueltos |

Trabaja en una carpeta propia (`~/.sirilastropilot/apilado/<proyecto>`) con enlaces a los subs: los ficheros del usuario no se tocan. Con varios grupos de lights se apila uno cada vez (`grupo`); combinarlos es el Paso 10. Es un trabajo largo: el estado del puente enseña el progreso.

## Fase lineal

| Paso | Herramienta | Con qué en Siril | Medidas que devuelve |
|---|---|---|---|
| 1 Análisis | `analizarMaster` | cabecera, estadísticas, detección de estrellas | escala, lineal, fondo 3×3, bordes sin datos (p95 por lado, `cunas_pct`), FWHM y redondez |
| 5 Recorte | `recortarBordes` | `crop` | rectángulo sin cuñas, píxeles quitados por lado |
| 8 Astrometría | `resolverAstrometria` | `platesolve` (catálogo local de Gaia si está instalado: `catalogo: "localgaia"`) | resuelta, AR/Dec, focal, píxel |
| 9 Gradiente | `gradienteCandidatos` → `aplicarCandidato` | `subsky` polinomio 1 y 2, `subsky -rbf`, GraXpert IA | `copia_objeto`, `objeto_quitado_pct`, `gradiente_restante`, `irregularidad_cielo`, `objeto_campo_pct` |
| 11/13 Deconvolución | `nitidezLineal` | BlurX por `rc-astro bxt` (solo corregir o completa) | FWHM y redondez antes y después |
| 12 Color | `listaSPCC`, `calibrarColor`, `equilibrarColor` | `spcc` (sensor de la cabecera o del perfil, filtro y blanco con los nombres que da `listaSPCC`); `pcc` con `fotometrica: true`; sin catálogo, fondo neutro + blanco medio de las estrellas | cielo por canal antes y después, `dominante_cielo_pct`; en el equilibrado, `factores_rgb`, estrellas usadas y su dispersión de color |
| 14 Ruido suave | `reducirRuidoCandidatos` | `denoise` a 0,5 / 0,7 / 1,0 (DA3D sólo si es rápido o se pide) y NoiseX 0,5, 0,3 ×2 y 0,5 ×2 por `rc-astro nxt` (si está) | `ruido_rel`, `ruido_grueso_rel`, `detalle_perdido_pct`; ★ = la que más ruido quita con ≤ 2 % de detalle perdido y sin recortes |
| 15 Estrellas | `estrellasCandidatos` → `aplicarCandidato` | StarNet2 (ejecutable directo) y StarX (`rc-astro sxt`) | `restos_estrellas_pct`, `agujeros_pct`, `objeto_quitado_pct`; ruta de la capa de estrellas |
| 15 Estrellas (uno solo) | `separarEstrellas` | `starnet` de Siril o StarNet2 directo | starless cargada, capa de estrellas en fichero |

Notas de la fase lineal:

- **Gradiente.** `gradiente_restante` es la inclinación del plano del cielo que queda (después / antes). Cuando la nebulosa ocupa casi todo el campo, el cielo más oscuro también es nebulosa y la cifra no es fiable (en una nebulosa de emisión grande: 0,55–0,75 con modelos limpios): decide por `copia_objeto` y mirando la previa. Con objeto extenso o polvo (más de un 25 % del campo, o `tipo` nebulosa/polvo) el ★ sólo admite modelos que se lleven ≤ 1 % del objeto y, a gradiente parecido, el que menos se lleve.
- **Color.** No pases sensor a `calibrarColor`: lo toma de la cabecera de la imagen y, si no lo dice, del perfil; sólo si el usuario lo dice (un sensor deducido del modelo de cámara puede ser otro: ASI2600MC es IMX571, no IMX533). Si la foto es de otro equipo, `ignorar_perfil: true`. SPCC necesita la astrometría.
  - **DSLR.** La base de SPCC de Siril sólo trae algunas Canon y Nikon (no la EOS 6D, por ejemplo). Si la cámara no está, `fotometrica: true` (PCC: fotometría de estrellas, sin curvas de sensor). Las Canon que sí están llevan el filtro de serie «Canon LPF»; una cámara modificada, «Generic / None».
  - **Sin catálogo.** PCC usa el Gaia local (`siril_cat_healpix8_astro.dat`) si está instalado; SPCC necesita además el catálogo local de espectros (Gaia DR3 xp_sampled), y sirve para sensores como el IMX571, no para cámaras que no están en la base. Si el catálogo en línea no responde, `calibrarColor` aplica solo `equilibrarColor` (fondo neutro + blanco medio de las estrellas no saturadas) y lo avisa: el color es aproximado y hay que decirlo en el informe. No repitas la llamada que falló.
- **Estrellas.** En campos de Vía Láctea `objeto_quitado_pct` sale alto en todos los motores (quitan también estrellas débiles sin resolver): compara motores entre sí y mira un recorte.

## Fase no lineal

| Paso | Herramienta | Con qué en Siril | Medidas que devuelve |
|---|---|---|---|
| 1 Estirado | `estirarCandidatos` → `aplicarCandidato` | `ght -even` (conserva el color) por pasadas cortas (suave y medio: al 60 y 80 % del ruido límite; fuerte: al fallo; y con la simetría en la señal débil), `asinh` al fallo, `autostretch`; punto negro por canal | `cielo`, `ruido_rel`, `separacion`, `dominante_cielo_pct`, `cero_pct`, `alto_pct`, `no_cumple` |
| 2 Paleta | `paletasCandidatos` → `aplicarCandidato` | desde la dual band cargada (Hα = R, OIII = media de G y B) o desde ficheros de capas estiradas: HOO, HOO suave, HOO con OIII realzado, HOO dinámica, SHO con SII | `separacion_tonos_grados`, `verde_residual_pct`, `sat_objeto`, `dominante_cielo_pct` |
| 3 SCNR | `quitarVerde` | `rmgreen` (sólo si el verde del cielo sobra) | cielo RGB antes y después |
| 5 Contraste | `contrasteCandidatos` → `aplicarCandidato` | `clahe` 1,5 y 2,5; `wavelet` + `wrecons` (escalas medias); `unsharp` | `contraste_ganado_pct`, `ruido_rel`, recortes |
| 5 Saturación | `saturacionCandidatos` → `aplicarCandidato` | `satu` 0,25 / 0,5 / 0,75 con factor de fondo 1 | `sat_objeto`, `sat_cielo`, `dominante_cielo_pct`, recortes |
| 6 Ruido | `reducirRuidoCandidatos` | como en el Paso 14 lineal, pero mucho más suave: `denoise` 0,3 / 0,5 y NoiseX 0,3, 0,5 y 0,3 ×2 | mismo criterio, y ninguna puede dejar menos del 50 % del ruido del cielo (fondo muerto) |
| 9 Recombinación | `recombinarEstrellas` | screen 1 − (1 − a)(1 − k·b) o suma, con la capa de estrellas del Paso 15 | `aporte_estrellas_pct`, fondo antes y después, recortes |
| 10 Exportación | `exportarFinal` | `savetif` (16 bits) y `savejpg` 95 | rutas y tamaños; no sobrescribe (_2, _3…) |

Notas de la fase no lineal:

- **Estirado.** El punto negro por canal (`negro_por_canal`, por defecto) evita que una dominante pequeña del lineal se haga grande al restar mucho fondo (nebulosa de emisión grande: de 1,5 % a 8,7 % con un punto negro común; 0,0 % por canal).
- **Recombinación.** La capa de estrellas sale lineal del Paso 15: con la starless ya estirada, `recombinarEstrellas` avisa y, con `estirar_estrellas: true`, la estira con arcsinh hasta que el p90 de los píxeles de estrella sea ≈ 0,10.
- **Contraste.** CLAHE da mucho contraste pero sube el ruido del cielo (nebulosa de emisión grande: ×1,3–1,55); el límite por defecto es ×1,25.

## Pasos sin herramienta propia en Siril

Preprocesado y apilado (fase lineal 2–4, 6–7), combinación de canales (lineal 10), HDR, máscaras (no lineal 4), núcleo de galaxias y dossier: con los scripts y comandos de Siril a mano (`comandoSiril` para lo que esté en la lista blanca), siguiendo los criterios de la ficha.
