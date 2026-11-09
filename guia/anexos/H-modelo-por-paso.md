# Anexo H. Modelo por paso: rápido o potente

Sólo hace falta si la plataforma ofrece varios modelos o niveles de razonamiento y nadie ha elegido ya el modelo (el módulo PiCopilot y PiCopilot Lite en «auto (pesos N)» lo eligen solos: entonces no preguntar por N). Con un modelo local no aplica.

Cada paso se puede hacer con un modelo **rápido** (más barato) o uno **potente**. El % de cada paso es la calidad del rápido respecto al potente haciendo ese paso, **medida con Claude** (Sonnet 5.5 frente a Opus 5.5; nebulosa dual band, noviembre de 2026; rúbrica de 40 puntos: exactitud, completitud, verificación y utilidad).

- Lineal: 1 → 86 · 2 → 97 · 3 → 92 · 4 → 84 · 5 → 84 · 6 → 100 · 7 → 100 · 8 → 100 · 9 → 87 · 10 → 100 (NB) / 95 (RGB) · 11–17 → 95
- No lineal: 1 → 95 · 2 → 95 · 3–10 → 89 · 11 (dossier) → 80 (asignado, sin medir)
- Resolución completa (todos los pasos seguidos en una sola tarea) → 80 (asignado, sin medir)

| Plataforma | Rápido | Potente | % |
|---|---|---|---|
| Claude | Sonnet | Opus | Medidos |
| ChatGPT | Modelo o nivel de razonamiento estándar | El de más razonamiento del plan (Thinking alto o Pro) | Sin medir: usar los de Claude como provisionales |
| Local | No aplica (un solo modelo) | — | — |

**Regla N.** Al empezar, el usuario elige N (0–100): si el % del paso es **> N**, rápido; si es **≤ N**, potente. Si no lo da, preguntarlo una vez; sin respuesta, N = 100 (todo potente). Con Claude, N = 95 pasa al rápido ~18 % del trabajo (ahorro ~7 %, pérdida ~0,2 %) y N = 90 ~50 % (ahorro ~20 %, pérdida ~2 %); el ahorro es de precio por token, no de tokens. Fijo, sea cual sea N: lotes mecánicos de un método ya decidido (calibrar con una herramienta escrita, medir subs, mover ficheros) con el rápido; decisiones de método y cambios en la guía con el potente.

Los % salen de un solo objeto (emisión, OSC dual band) y los pasos lineales 10–17 y no lineales 3–10 se puntuaron en bloque. Pesos en datos: `porcentajes_skill.json` (los ajustes de cada usuario, como su N, no van ahí sino en local).
