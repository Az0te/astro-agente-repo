// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotAgent.h - Modelos, configuración, pasos de la guía y prompts.
//
// Esta parte no tiene interfaz gráfica. Las llamadas a los modelos se lanzan
// desde PiCopilotInterface como procesos externos asíncronos:
//   - Claude: Claude Code en modo no interactivo (claude -p), que ya tiene el
//     MCP de PixInsight y puede ejecutar los pasos sobre la imagen.
//   - ChatGPT y modelos locales: API OpenAI-compatible (chat/completions) por
//     HTTP con curl.exe. Devuelven texto y, si procede, llamadas JSON a funciones
//     de la guía que el usuario puede ejecutar desde PiCopilot (nunca código).
// ----------------------------------------------------------------------------

#ifndef __PiCopilotAgent_h
#define __PiCopilotAgent_h

#include <pcl/String.h>
#include <pcl/StringList.h>

#include <vector>

namespace pcl
{

// ----------------------------------------------------------------------------

struct PiCopilotModel
{
   String name;      // Texto en el ComboBox
   String type;      // "claude" | "codex" | "openai"
   String endpoint;  // URL de chat/completions (sólo "openai")
   String model;     // Identificador del modelo (sólo "openai")
   String keyEnv;    // Variable de entorno con la clave API (opcional)
   bool   builtin = false;

   bool IsClaude() const { return type == "claude"; }
   bool IsCodex() const { return type == "codex"; }
   // Agentes con herramientas (MCP de PixInsight): trabajan sobre la imagen ellos mismos.
   bool IsAgent() const { return IsClaude() || IsCodex(); }

   // Claude o un endpoint que no es local: habilita "Resolución Completa".
   bool IsCloud() const;
};

// ----------------------------------------------------------------------------

struct PiCopilotStep
{
   String label;        // Texto del botón
   String file;         // Archivo de la guía, relativo a la carpeta guia/
   bool   linear;       // Fase lineal / no lineal
   bool   needsImage;   // Requiere una vista activa
   bool   comparative;  // Lanza comparativas y genera un dossier

   static const std::vector<PiCopilotStep>& Linear();
   static const std::vector<PiCopilotStep>& NonLinear();
};

// ----------------------------------------------------------------------------

class PiCopilotConfig
{
public:

   std::vector<PiCopilotModel> models;
   int    currentModel = 0;
   String guideDir;     // .../astro-agente-repo/guia
   String workDir;      // Dossiers y archivos temporales
   String claudePath;   // claude.exe
   String claudeArgs;   // Argumentos extra para claude -p
   String dataDirs;               // Carpetas de datos para Claude, separadas por ';'
   String uiLanguage = "es";      // idioma de la interfaz: "es" | "en"
   bool   autoRun = true;         // ejecutar sin preguntar el script de la respuesta a un Prompt (Rafael, 7 nov 2026)
   bool   internet = true;        // búsquedas externas: WebSearch/WebFetch de Claude y web.js de la guía (Rafael, 8 nov 2026)

   // Fichero marca ~/.picopilot/sin-internet: lo crea el módulo con la casilla desmarcada y web.js lo respeta
   // (también cuando la función llega por el MCP y se ejecuta en el runner).
   void WriteInternetFlag() const;

   // Configurar IA: cada paso tiene una puntuación (valor base de la tabla
   // + ajuste del usuario). Si es >= threshold se usa el modelo inferior
   // (más barato); si es menor, el superior. Sólo Claude y ChatGPT.
   int    threshold = 95;
   std::vector<std::pair<String, int>> adjustments;   // clave de paso -> ajuste
   String claudeLow, claudeHigh;  // p. ej. "sonnet" / "opus"
   String openaiLow, openaiHigh;  // Codex: vacío = el modelo por defecto de Codex

   // Límites para que Claude no se quede probando sin resultados.
   int    maxTurnsStep = 80;      // --max-turns de un paso (0 = sin límite)
   int    maxTurnsFull = 400;     // --max-turns de Resolución Completa
   int    maxRetries = 3;         // intentos fallidos seguidos antes de parar

   void Load();
   void Save() const;

   const PiCopilotModel& Current() const;

   int  Adjustment( const String& stepKey ) const;
   void SetAdjustment( const String& stepKey, int delta );
   void ResetAI();   // valores por defecto de Configurar IA

   // Modelo concreto para un paso (stepKey vacío = Prompt libre: superior).
   // Devuelve el id que hay que pasar al proveedor y deja en 'why' el motivo.
   String TierModel( const PiCopilotModel&, const String& stepKey, String& why ) const;

   // ¿Este modelo admite Configurar IA? (Claude y ChatGPT de serie)
   static bool HasTiers( const PiCopilotModel& );

   // Tabla de pesos: se lee de <guía>/porcentajes_skill.json; si no existe,
   // se usa la copia compilada en el módulo.
   std::vector<std::pair<String, int>> scores;
   String scoresSource;           // archivo leído (vacío = tabla interna)
   String ScoresFile() const;
   void   LoadScores();

   // Valor base de la tabla de pesos para un paso; -1 si no está en la tabla.
   int BaseScore( const String& stepKey ) const;
   static int BuiltinScore( const String& stepKey );

   // Clave del paso "Resolución Completa".
   static String FullKey() { return "completa"; }

   String DossierDir() const;
   String TempDir() const;
   String CurlPath() const;

   // Valores por defecto de las rutas.
   static String DefaultGuideDir();
   static String DefaultWorkDir();
   static String DefaultClaudePath();
   static String DefaultClaudeArgs();
   // Rutas (con /) de los servidores MCP; vacías si no existen.
   String PicopilotMcpServer() const;
   String PicopilotRunner() const;   // mcp/pjsr/picopilot-runner.js, o vacío
};

// ----------------------------------------------------------------------------

struct PiCopilotChatMessage
{
   String role;      // "system" | "user" | "assistant"
   String content;
   String image;     // JPG que acompaña al mensaje (modelos con visión), o vacío
};

// ----------------------------------------------------------------------------

namespace PiCopilotPrompts
{
   String System();

   // Paso individual de la guía. dossierPath sólo se usa en pasos comparativos.
   // newSession: primera tarea de una sesión de Claude (una sesión por fase).
   // secondViewId: segunda capa elegida por el usuario en los pasos que combinan dos imágenes (recombinación).
   String Step( const PiCopilotConfig&, const PiCopilotModel&, const PiCopilotStep&,
                const String& viewId, const String& dossierPath, bool newSession = false,
                const String& secondViewId = String(), const String& dataFolder = String() );

   // Pasos que necesitan una segunda capa: devuelve qué capa es ("capa de estrellas") o vacío.
   String SecondLayer( const PiCopilotStep& );

   // Pasos que trabajan con ficheros (inventario, selección, preprocesado): qué carpeta pedir, o vacío.
   String DataFolder( const PiCopilotStep& );

   // Procesado completo, de la fase lineal a la no lineal.
   String Full( const PiCopilotConfig&, const PiCopilotModel&,
                const String& viewId, const String& dossierPath );

   // Prompt libre escrito por el usuario, con el contexto de la imagen.
   String Free( const PiCopilotConfig&, const PiCopilotModel&, const String& text, const String& viewId, bool firstTurn );

   // Extrae el último bloque ```json con {"llamadas": [...]} de una respuesta (o vacío). El modelo nunca escribe
   // código: sólo propone llamadas a funciones de la guía, que el runner valida contra el manifiesto.
   String ExtractCalls( const String& response );

   // Lista de las funciones del manifiesto de la guía: "- nombre {p1*, p2} (Paso N): resumen" (* = obligatorio).
   // Sin summaries, sólo "- nombre {p1*, p2}" (para los recordatorios, más cortos).
   String FunctionList( const String& guideDir, bool summaries = true );

   // Instrucciones del formato de llamadas para los modelos sin herramientas.
   String CallsFormat();
}

// ----------------------------------------------------------------------------

namespace PiCopilotUtil
{
   String ReadText( const String& path, size_type maxChars = 0 );
   bool   WriteText( const String& path, const String& text );
   String EnvVar( const String& name );
   String NewId();         // id corto para trabajos y archivos
   String NewUUID();       // para --session-id de Claude Code
   String Timestamp();     // HH:MM:SS
   String JoinPath( const String& a, const String& b );
   // Borra las vistas previas (prev_*.jpg, cmp_*.jpg) y scripts temporales (run_*) de la carpeta temporal de
   // PiCopilot, y la página del chat. Al abrir el panel y al limpiar o empezar una conversación.
   void   CleanTemp( const String& tempDir );
}

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiCopilotAgent_h

// ----------------------------------------------------------------------------
// EOF PiCopilotAgent.h
