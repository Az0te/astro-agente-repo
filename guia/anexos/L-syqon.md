# Anexo L: SyQon Studio en los tres programas

SyQon Studio trae un programa de línea de comandos, `syqon-cli`. PixInsight (`guia/herramientas/syqon.js`), Siril y SASpro (`syqon.py`, el mismo fichero en `siril/herramientas` y `sas/herramientas`) lo usan como un candidato más dentro de las comparativas. Nunca va solo: se mide como los demás y se elige por las medidas (regla «comparar siempre»). Si SyQon Studio no está instalado, o el modelo no tiene licencia (código 4), el candidato aparece en `omitidos` y el paso sigue sin él.

**Dónde busca el programa.** Primero la variable `SQ_EXE` (PixInsight) o `SYQON_EXE` (Siril y SASpro). Después el registro (`HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\syqon-cli.exe`), luego `%LOCALAPPDATA%\Programs\SyQon Studio\syqon-cli.exe` y por último el PATH. `ping` dice la versión y qué modelos gratuitos hay.

| Modelo (gratuito) | Paso | Dónde entra | Cuándo sirve |
|---|---|---|---|
| `deep-gradient` | L9 gradiente | `gradienteCandidatos` en los tres (PixInsight: vista `GC_SYQON` y su modelo) | Solo en lineal. Necesita internet (referencia del cielo de SyQon) y las bases de ASTAP; con la casilla Internet desmarcada va en `omitidos`. Corre en CPU y tarda de 5 s a ~2 min |
| `prism-essential` | L14 / L15 ruido | `ruidoCandidatos` (PixInsight y SASpro) y `reducirRuidoCandidatos` (Siril); en PixInsight también `reducirRuido(metodo: "syqon")` | **Solo en lineal**: con imagen estirada `syqon-cli` da código 2 y se omite |
| `axiom-mini` | L15 estrellas | Siril: `estrellasCandidatos`. PixInsight: `separarEstrellas(motor: "syqon")`. SASpro: `separarEstrellas(motor: "syqon_cli")` | **Solo con la imagen estirada** (`--domain nonlinear`). En lineal se niega: la starless sale plana (`--axiom-stretch auto`) o con una rejilla magenta y la capa de estrellas solo en verde (`identity`) |
| `parallax-nano` | L11 / L13 deconvolución | `bxtCandidatos` (PixInsight) y `deconvolucionCandidatos` (SASpro), como variante **experimental** | En lineal recorta los núcleos a 1,0 desde la etapa de corrección. Se lanza con corrección + deblur, sin reducción y con `--application 0,5`, y se cuentan los píxeles saturados: si son más que en la original, queda descartado. En PixInsight no entra en la recomendación (es de BXT) |

Los modelos de pago (`axiom`, `prism-advanced`/`-ultra`/`-max`, `parallax`) solo se usan si el usuario los pide y la licencia los admite (código distinto de 4).

**Trampas comprobadas (recorte de 1500 px de IC 405, 22 nov 2026).**
- **Orden de filas.** SyQon escribe sus FITS con `ROWORDER = TOP-DOWN` y voltea o no las filas según el fichero de entrada: un FITS de Siril salió volteado y uno escrito con astropy no. Las herramientas no se fían de la cabecera: comparan la salida con la entrada (luminancia reducida, tal cual y volteada) y la dejan en el orden de la entrada. En PixInsight se intercambia en XISF, que no se voltea.
- **Temporales.** Deja ficheros `.syq-export-*` junto a la salida. Se trabaja en una carpeta temporal propia que se vacía al terminar.
- **Códigos de salida.** 0: bien (la salida estándar es la ruta). 2: dominio u opción no válida. 3: ruta. 4: licencia o modelo no disponible. 5 y 6: fallo del modelo (p. ej. «No readable ASTAP D20/D50/D80 catalogue» en `deep-gradient` si no encuentra las bases de ASTAP).
- **Dispositivo.** Prism y Axiom corren por DirectML (GPU; con una Radeon también). Parallax abre DirectML y acaba en CPU. DeepGradient va en CPU.
- **Primeras medidas en el recorte.** Prism dejó el 65 % del ruido sin perder detalle medible: fue el recomendado frente al denoise de Siril, Cosmic Clarity y TGV. DeepGradient dejó más gradiente que el polinomio 1 (`gradiente_restante` 1,4–1,95). Parallax a 0,5 no saturó y apenas cambió la FWHM. Axiom en estirada separó limpio, pero bajó el fondo de la starless un 15 %. Son medidas de un recorte: la comparativa en masters enteros por tipo de objeto está en `D:\Astronomia\Pruebas\SyQon_20261122\comparativa`.
