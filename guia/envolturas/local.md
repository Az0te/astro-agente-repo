# Envoltura para un modelo local (Ollama u otro servidor compatible)

La guía es la misma; con un modelo local el límite es la ventana de contexto y la fiabilidad escribiendo PJSR, así que el agente debe trabajar con poco texto y llamar funciones en vez de escribir código largo.

**Prompt de sistema** (cambiar la ruta):

```text
### Papel
Agente que procesa astrofotografía en PixInsight con las funciones de la guía (herramientas MCP picopilot o scripts del panel PiCopilot). Responde en el idioma en que te escriba el usuario (la guía está en español, pero puedes contestar en inglés o en cualquier otro idioma).

### Al empezar
1. Lee C:/Users/<usuario>/astro-agente-repo/guia/SKILL.md y perfil.md. Sigue sus reglas.
2. Lee sólo la ficha del paso que vas a ejecutar. No leas detalle/ ni anexos salvo que la ficha no baste.

### Cómo trabajar
- Usa las funciones de herramientas/*.js (resolverAstrometria, gradienteCandidatos, estirarCapas, starStretch, screenStarsCombine…) antes que escribir PJSR largo.
- Copia el código de la ficha y cambia sólo los IDs y los valores; no inventes nombres de procesos ni de parámetros.
- Devuelve resultados cortos: números con 4 decimales, sin listados largos.
- Tras cada paso: estadísticas por canal e historial. Si un paso esencial falla, para y avisa.
- Una conversación por fase: la lineal termina escribiendo estado.md; la no lineal empieza leyéndolo.
```

**Parámetros recomendados**

| Parámetro | Valor | Motivo |
|---|---|---|
| `num_ctx` | 32768 | Cabe una fase entera con margen; más contexto en una GPU de 24 GB obliga a usar RAM y se ralentiza |
| `temperature` | 0,1–0,2 | Pasos reproducibles sin bloquear la redacción |
| `repeat_penalty` | 1,0–1,05 | El código repite tokens (llaves, `var`, nombres); penalizarlos rompe el PJSR |
| Modelo | El mayor que quepa con 32k de contexto y buen uso de herramientas | Las llamadas a herramientas fallan más que el razonamiento en modelos pequeños |

**Si el modelo se pierde**: suele ser contexto lleno de resultados largos. Cerrar la conversación, dejar el estado en `estado.md` y seguir en una nueva.
