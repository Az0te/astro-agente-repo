# Paso 14: NoiseX suave (opcional)

[← Índice](../SKILL.md) · Anterior: [Paso 13: BlurX completo](13-bxt-completo.md) · Siguiente: [Paso 15: StarX y NXT de la starless](15-starx.md)

**Por qué.** Es una pasada **ligera y opcional** antes de SXT: "NXT ligero opcional después de BXT completo y antes de SXT (denoise 0,50)". No es el denoise principal. Su objetivo es que SXT no confunda ruido con estrellas débiles, sin quitar la información que BXT ya usó. "Nunca NR antes de BXT": aquí ya se ha pasado BXT completo, así que es el primer momento válido.

**Parámetros**

| Parámetro | Valor |
|---|---|
| denoise | 0,50 (pasada ligera) |
| detail | 0,10–0,20 ("más alto crea halos oscuros en estrellas") |
| iterations | 2–3 |
| Separación color | croma > luminancia (nebulosa oscura: croma 0,90, luminancia 0,40, detail 0,25) |
| tile overlap | 0,50 si aparecen bloques |
| Valor por defecto | **No** el 0,90: "denoise 0,70–0,80 (no el 0,90 por defecto)" |

- "`iterations` (más iteraciones conservan mejor el detalle débil y limpian el moteado de gran escala; 2–5), separación **HF/LF** (moteado de fondo = baja frecuencia; ajustar la escala poniendo temporalmente LF a 0 con vista previa), **tile overlap** 0,50 si aparecen bloques." Parámetros del proceso comprobados en 1.9.6: `iterations`, `enable_frequency_separation`, `denoise_high_freq`, `denoise_low_freq`, `frequency_scale`, `overlap`.
- "NXT funciona también en no lineal (se entrenó con imágenes estiradas)". En esta fase, lineal.

**A mano en PixInsight (valores de referencia)**

- NoiseXTerminator: `denoise` 0,50 (pasada ligera antes de SXT), `detail` 0,15, `iterations` 2.

**En una llamada** (`herramientas/ruido.js`): `reducirRuido` aplica NXT sobre una copia y mide los controles de abajo: σ del cielo antes y después, contraste de la zona débil y estructura de la imagen residual (~1–2 = sólo ruido). En nebulosa dual band (nov 2026), NXT 0,50 bajó el ruido del cielo un 43 % con el contraste intacto (−0,5 %). Recomendado para modelos sin herramientas.

```json
{"llamadas": [
  {"funcion": "reducirRuido", "parametros": {"vista": "MasterLight_bxt", "opciones": {"denoise": 0.5, "detail": 0.15, "iterations": 2, "nuevaVista": "MasterLight_nxt"}}}
]}
```

Devuelve las medidas (ruido_baja_pct, contraste_zona_debil_pct, residual_estructura), `no_cumple` y el control.

**Comparar en vez de fijar el valor** (`ruidoCandidatos`, mismo fichero): prueba sobre la misma entrada NXT 0,30 / 0,50 / 0,70, MLDenoise (amount 1,0, con el modelo `.xmlm` del perfil) y MultiscaleTGVDenoise (strength 0,5 y 1,0), con las mismas medidas de `reducirRuido`, y se queda con el que más baja el ruido sin pasar del 80 % entre los que cumplen. Devuelve la tabla en `comparados`. MLDenoise es lento (~7 min en 22 MP; en un drizzle 2x de la 2600MC, mucho más): `metodos: ["nxt", "tgv"]` para dejarlo fuera. En IC 63 sin calibrar (8 nov 2026) ganó NXT 0,70 (−57 %); MLDenoise (−76 %) y TGV (−63 % y −75 %) quitaban más ruido, pero subían el moteado de color más de 0,3.

```json
{"llamadas": [
  {"funcion": "ruidoCandidatos", "parametros": {"vista": "MasterLight_bxt", "opciones": {"nuevaVista": "MasterLight_nxt"}}}
]}
```

Opciones: `metodos`, `niveles`, `tgv`, `amount`, `modelo`. La tabla está en `comparados`.

**Control.** σ del cielo baja poco (es una pasada suave), contraste de una zona débil no baja más de ~5 %, la imagen diferencia (antes − después) debe ser **sólo ruido**. Si aparece aspecto de cera, se ha pasado: bajar denoise o dejarlo para la starless.
