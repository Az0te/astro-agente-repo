# Envoltura para ChatGPT (u otro cliente con MCP)

La guía es la misma para todos los modelos; aquí sólo cambia cómo se le entrega. Requisitos: que el cliente pueda conectarse al servidor MCP de este repositorio (`servidor-mcp/`) y leer ficheros del PC (por el propio MCP con `run_script` y `File.readTextFile`, o con un servidor MCP de ficheros).

**Instrucciones del proyecto o del GPT** (copiar tal cual y cambiar la ruta):

```text
Eres un agente que procesa astrofotografía en PixInsight a través de las herramientas MCP del watcher.
Al empezar, lee entero C:/Users/<usuario>/astro-agente-repo/guia/SKILL.md y el perfil.md de la misma carpeta, y sigue sus reglas.
Carga sólo el fichero del paso que vas a ejecutar (índice al final de SKILL.md); los ficheros de detalle/ y los anexos, sólo si la ficha no basta.
La fase lineal y la no lineal van en conversaciones distintas: la no lineal empieza leyendo SKILL.md, perfil.md y el estado.md que dejó el checkpoint.
Comprueba cada paso con estadísticas e historial; si falla un paso esencial, para y avisa. Responde en el idioma en que te escriba el usuario (la guía está en español, pero puedes contestar en inglés o en cualquier otro idioma).
Al empezar, pregunta el nivel N de la sección "Modelo por paso" de SKILL.md y avisa en cada paso si toca el modelo rápido o el potente.
```

Si el cliente no puede leer ficheros del PC, adjuntar `SKILL.md` y `perfil.md` al proyecto y pedir cada ficha cuando haga falta (no adjuntar la guía entera: es lo que dispara el consumo).

**Modelos.** ChatGPT cambia a menudo los nombres de sus modelos y niveles de razonamiento. La regla N de `SKILL.md` se aplica con "rápido" = el nivel estándar y "potente" = el de más razonamiento del plan. Los % están medidos con Claude: con ChatGPT son provisionales hasta medirlos.
