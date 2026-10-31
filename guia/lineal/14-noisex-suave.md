# Paso 14: NoiseX suave (opcional)

[← Índice](../SKILL.md) · Anterior: [Paso 13: BlurX completo](13-bxt-completo.md) · Siguiente: [Paso 15: StarX y NXT de la starless](15-starx.md)

**Por qué.** Es una pasada **ligera y opcional** antes de SXT: "NXT ligero opcional después de BXT completo y antes de SXT (denoise 0,50)". No es el denoise principal. Su objetivo es que SXT no confunda ruido con estrellas débiles, sin quitar la información que BXT ya usó. "Nunca NR antes de BXT": aquí ya se ha pasado BXT completo, así que es el primer momento válido.

**Parámetros**

| Parámetro | Valor |
|---|---|
| denoise | 0,50 (pasada ligera) |
| detail | 0,10–0,20 ("más alto crea halos oscuros en estrellas") |
| iterations | 2–3 |
| Separación color | croma > luminancia (LDN 1235: croma 0,90, luminancia 0,40, detail 0,25) |
| tile overlap | 0,50 si aparecen bloques |
| Valor por defecto | **No** el 0,90: "denoise 0,70–0,80 (no el 0,90 por defecto)" |

- "`iterations` (más iteraciones conservan mejor el detalle débil y limpian el moteado de gran escala; 2–5), separación **HF/LF** (moteado de fondo = baja frecuencia; ajustar la escala poniendo temporalmente LF a 0 con vista previa), **tile overlap** 0,50 si aparecen bloques. Confirmar los nombres PJSR con `describe_process NoiseXTerminator` antes de usarlos."
- "NXT funciona también en no lineal (se entrenó con imágenes estiradas)". En esta fase, lineal.

**Código**

```javascript
var v = View.viewById("MasterLight");
if (v.isNull) throw new Error("No existe MasterLight");
var NXT = new NoiseXTerminator;
NXT.denoise = 0.50;       // pasada ligera antes de SXT (confirmar nombres)
NXT.detail = 0.15;
NXT.iterations = 2;
if (!NXT.executeOn(v)) throw new Error("NXT ligero falló");
"NXT 0,50 aplicado";
```

**Control.** σ del cielo baja poco (es una pasada suave), contraste de una zona débil no baja más de ~5 %, la imagen diferencia (antes − después) debe ser **sólo ruido**. Si aparece aspecto de cera, se ha pasado: bajar denoise o dejarlo para la starless.
