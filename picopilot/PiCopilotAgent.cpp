// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotAgent.cpp - Modelos, configuración, pasos de la guía y prompts.
// ----------------------------------------------------------------------------

#include "PiCopilotAgent.h"
#include "PiCopilotI18n.h"
#include "PiCopilotJson.h"

#include <pcl/File.h>
#include <pcl/ImageWindow.h>
#include <pcl/Settings.h>
#include <pcl/StringList.h>
#include <pcl/View.h>

#include <cstdlib>
#include <cstring>
#include <ctime>

namespace pcl
{

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------

String PiCopilotUtil::ReadText( const String& path, size_type maxChars )
{
   try
   {
      if ( !File::Exists( path ) )
         return String();
      String text = File::ReadTextFile( path ).UTF8ToUTF16();
      if ( maxChars > 0 && text.Length() > maxChars )
         text = text.Left( maxChars ) + u"\n[... recortado ...]";
      return text;
   }
   catch ( ... )
   {
      return String();
   }
}

bool PiCopilotUtil::WriteText( const String& path, const String& text )
{
   try
   {
      File::WriteTextFile( path, text.ToUTF8() );
      return true;
   }
   catch ( ... )
   {
      return false;
   }
}

String PiCopilotUtil::EnvVar( const String& name )
{
   if ( name.IsEmpty() )
      return String();
   IsoString n = name.ToUTF8();
   const char* v = ::getenv( n.c_str() );
   return (v != nullptr) ? String::UTF8ToUTF16( v ) : String();
}

String PiCopilotUtil::NewUUID()
{
   return String( IsoString::UUID() );
}

String PiCopilotUtil::NewId()
{
   IsoString u = IsoString::UUID();
   u.DeleteChar( '-' );
   return String( u.Left( 10 ) );
}

String PiCopilotUtil::Timestamp()
{
   std::time_t t = std::time( nullptr );
   std::tm tm;
#ifdef __PCL_WINDOWS
   ::localtime_s( &tm, &t );
#else
   ::localtime_r( &t, &tm );
#endif
   return String().Format( "%02d:%02d:%02d", tm.tm_hour, tm.tm_min, tm.tm_sec );
}

String PiCopilotUtil::JoinPath( const String& a, const String& b )
{
   if ( a.IsEmpty() )
      return b;
   if ( a.EndsWith( '/' ) || a.EndsWith( '\\' ) )
      return a + b;
   return a + '/' + b;
}

void PiCopilotUtil::CleanTemp( const String& tempDir )
{
   static const char* patterns[] = { "prev_*.jpg", "cmp_*.jpg", "run_*.js", "run_*.txt", nullptr };
   for ( int i = 0; patterns[i] != nullptr; ++i )
      try
      {
         FindFileInfo info;
         for ( File::Find f( JoinPath( tempDir, patterns[i] ) ); f.NextItem( info ); )
            if ( !info.IsDirectory() )
               try { File::Remove( JoinPath( tempDir, info.name ) ); } catch ( ... ) {}
      }
      catch ( ... ) {}
   // La página del chat (picopilot_chat.html) no se borra: se reescribe en cada mensaje, y borrarla mientras el
   // visor la carga dejaba "Your file couldn't be accessed" al pulsar Nueva conversación (5 nov 2026).
}

// ----------------------------------------------------------------------------
// Modelos
// ----------------------------------------------------------------------------

bool PiCopilotModel::IsCloud() const
{
   if ( IsAgent() )
      return true;
   String e = endpoint.Lowercase();
   return !(e.Contains( "localhost" ) || e.Contains( "127.0.0.1" ) || e.Contains( "[::1]" ) || e.Contains( "0.0.0.0" ));
}

static std::vector<PiCopilotModel> BuiltinModels()
{
   std::vector<PiCopilotModel> m( 3 );

   m[0].name = "Claude";
   m[0].type = "claude";
   m[0].builtin = true;

   // Codex CLI de OpenAI (codex exec): agente con el MCP de PixInsight, como Claude Code. Sustituye al
   // ChatGPT por HTTP, que sólo proponía scripts (petición de Rafael, 4 nov 2026).
   m[1].name = "Codex";
   m[1].type = "codex";
   m[1].builtin = true;

   // Ollama con qwen38-32k (num_ctx 32768): en la prueba del Paso 9 (4 nov
   // 2026) dio scripts mucho mejores que Strata IQ3_S, que sigue disponible
   // como plantilla en "+".
   m[2].name = "Qwen 3.8 (local)";
   m[2].type = "openai";
   m[2].endpoint = "http://localhost:11434/v1/chat/completions";
   m[2].model = "qwen38-32k";
   m[2].builtin = true;

   return m;
}

// ----------------------------------------------------------------------------
// Pasos de la guía (guia/lineal y guia/no-lineal)
// ----------------------------------------------------------------------------

const std::vector<PiCopilotStep>& PiCopilotStep::Linear()
{
   static const std::vector<PiCopilotStep> steps =
   {
      { u"Análisis del objeto",    "lineal/01-analisis-del-objeto.md",   true, false, false },
      { u"Inventario",             "lineal/02-inventario.md",            true, false, false },
      { u"Blink / SubframeSel.",   "lineal/03-blink-subframeselector.md",true, false, false },
      { u"Preprocesado",           "lineal/04-preprocesado.md",          true, false, false },
      { u"StarAlignment + crop",   "lineal/05-staralignment-crop.md",    true, false, false },
      { u"HDRComposition",         "lineal/06-hdr-composition.md",       true, false, false },
      { u"Extracción de canales",  "lineal/07-extraccion-canales.md",    true, true,  false },
      { u"Plate Solve",            "lineal/08-plate-solve.md",           true, true,  false },
      { u"Corrección de Gradiente","lineal/09-correccion-gradiente.md",  true, true,  true  },
      { u"Combinación RGB / NB",   "lineal/10-combinacion-rgb-nb.md",    true, false, false },
      { u"BXT Correct Only",       "lineal/11-bxt-correct-only.md",      true, true,  false },
      { u"SPCC",                   "lineal/12-spcc.md",                  true, true,  false },
      { u"BXT completo",           "lineal/13-bxt-completo.md",          true, true,  false },
      { u"NoiseX suave",           "lineal/14-noisex-suave.md",          true, true,  false },
      { u"StarX + NXT starless",   "lineal/15-starx.md",                 true, true,  false },
      { u"LinearFit / continuo",   "lineal/16-linearfit-continuo.md",    true, true,  false },
      { u"Checkpoint",             "lineal/17-checkpoint.md",            true, true,  false },
   };
   return steps;
}

const std::vector<PiCopilotStep>& PiCopilotStep::NonLinear()
{
   static const std::vector<PiCopilotStep> steps =
   {
      { u"Estirado",               "no-lineal/01-estirado.md",            false, true, false },
      { u"LRGB / Paleta",          "no-lineal/02-lrgb-paleta.md",         false, true, false },
      { u"SCNR",                   "no-lineal/03-scnr.md",                false, true, false },
      { u"Máscaras",               "no-lineal/04-mascaras.md",            false, true, false },
      { u"Boost",                  "no-lineal/05-boost.md",               false, true, false },
      { u"NoiseX",                 "no-lineal/06-noisex.md",              false, true, false },
      { u"Nitidez",                "no-lineal/07-nitidez.md",             false, true, false },
      { u"Estrellas",              "no-lineal/08-estrellas.md",           false, true, false },
      { u"Recombinación",          "no-lineal/09-recombinacion.md",       false, true, false },
      { u"Recorte y exportación",  "no-lineal/10-recorte-exportacion.md", false, true, false },
      { u"Dossier",                "no-lineal/11-dossier.md",             false, true, false },
   };
   return steps;
}

// ----------------------------------------------------------------------------
// Configuración (Settings de PixInsight)
// ----------------------------------------------------------------------------

String PiCopilotConfig::DefaultGuideDir()
{
   return PiCopilotUtil::JoinPath( File::HomeDirectory(), "astro-agente-repo/guia" );
}

String PiCopilotConfig::DefaultWorkDir()
{
   return PiCopilotUtil::JoinPath( File::HomeDirectory(), "PiCopilot" );
}

String PiCopilotConfig::DefaultClaudePath()
{
   String p = PiCopilotUtil::JoinPath( File::HomeDirectory(), ".local/bin/claude.exe" );
   if ( File::Exists( p ) )
      return p;
   return "claude";
}

String PiCopilotConfig::PicopilotMcpServer() const
{
   // Servidor MCP propio (mcp/dist/picopilot-mcp.mjs), junto a la guía en el mismo repo.
   String g = guideDir.EndsWith( '/' ) || guideDir.EndsWith( '\\' ) ? guideDir.Left( guideDir.Length()-1 ) : guideDir;
   String repo = File::ExtractDirectory( g );
   StringList cands;
   cands << PiCopilotUtil::JoinPath( repo, "mcp/dist/picopilot-mcp.mjs" )
         << PiCopilotUtil::JoinPath( File::ExtractDrive( g ) + repo, "mcp/dist/picopilot-mcp.mjs" )
         << PiCopilotUtil::JoinPath( File::HomeDirectory(), "astro-agente-repo/mcp/dist/picopilot-mcp.mjs" );
   String s;
   for ( const String& c : cands )
      if ( File::Exists( c ) )
      {
         s = File::FullPath( c );
         break;
      }
   if ( s.IsEmpty() )
      return String();
   s.ReplaceString( u"\\", u"/" );
   return s;
}

String PiCopilotConfig::PicopilotRunner() const
{
   // Runner del MCP picopilot (mcp/pjsr/picopilot-runner.js), al lado del servidor.
   String s = PicopilotMcpServer();
   if ( s.IsEmpty() )
      return String();
   s.ReplaceString( u"/mcp/dist/picopilot-mcp.mjs", u"/mcp/pjsr/picopilot-runner.js" );
   return File::Exists( s ) ? s : String();
}

String PiCopilotConfig::ClassicMcpServer()
{
   // Servidor MCP antiguo (derivado de pixinsight-mcp), que necesita el watcher.
   String s = PiCopilotUtil::JoinPath( File::HomeDirectory(), "astro-agente-repo/servidor-mcp/build/index.js" );
   if ( !File::Exists( s ) )
      return String();
   s.ReplaceString( u"\\", u"/" );
   return s;
}

String PiCopilotConfig::DefaultClaudeArgs()
{
   // Herramientas permitidas sin preguntar en modo no interactivo: el MCP de
   // PixInsight y lectura/escritura de archivos (guía y carpeta de trabajo).
   return "--allowedTools mcp__picopilot,Read,Glob,Grep,Write";
}

static String ClassicWatcherSource();

void PiCopilotConfig::Load()
{
   models = BuiltinModels();

   String custom;
   if ( Settings::Read( "Models", custom ) )
   {
      StringList lines;
      custom.Break( lines, '\n', true );
      for ( const String& line : lines )
      {
         StringList f;
         line.Break( f, '\t' );
         if ( f.Length() >= 4 && !f[0].IsEmpty() )
         {
            PiCopilotModel m;
            m.name = f[0];
            m.type = f[1].IsEmpty() ? String( "openai" ) : f[1];
            m.endpoint = f[2];
            m.model = f[3];
            m.keyEnv = (f.Length() > 4) ? f[4] : String();
            models.push_back( m );
         }
      }
   }

   currentModel = 0;
   Settings::Read( "CurrentModel", currentModel );
   if ( currentModel < 0 || currentModel >= int( models.size() ) )
      currentModel = 0;

   if ( !Settings::Read( "GuideDir", guideDir ) || guideDir.IsEmpty() )
      guideDir = DefaultGuideDir();
   if ( !Settings::Read( "WorkDir", workDir ) || workDir.IsEmpty() )
      workDir = DefaultWorkDir();
   if ( !Settings::Read( "ClaudePath", claudePath ) || claudePath.IsEmpty() )
      claudePath = DefaultClaudePath();
   if ( !Settings::Read( "ClaudeArgs", claudeArgs ) )
      claudeArgs = DefaultClaudeArgs();
   // Desde la build 78 el MCP antiguo (mcp__pixinsight) ya no se usa: se cambia por el nuevo (picopilot).
   else if ( claudeArgs.Contains( "mcp__pixinsight" ) )
   {
      claudeArgs.ReplaceString( "mcp__picopilot,mcp__pixinsight", "mcp__picopilot" );
      claudeArgs.ReplaceString( "mcp__pixinsight", "mcp__picopilot" );
   }
   if ( !Settings::Read( "WatcherEnabled", watcherEnabled ) )
      watcherEnabled = false;
   // Build 78: el watcher del MCP antiguo se apaga una vez (se puede volver a encender a mano).
   bool watcherOff78 = false;
   if ( !Settings::Read( "WatcherOff78", watcherOff78 ) || !watcherOff78 )
   {
      watcherEnabled = false;
      Settings::Write( "WatcherOff78", true );
   }
   // Las versiones anteriores guardaban el watcher clásico por defecto: se
   // migra al v8 salvo que el usuario haya elegido otra ruta.
   if ( !Settings::Read( "WatcherSource", watcherSource ) || watcherSource.IsEmpty() ||
        File::FullPath( watcherSource ) == File::FullPath( ClassicWatcherSource() ) )
      watcherSource = DefaultWatcherSource();
   if ( !Settings::Read( "DataDirs", dataDirs ) )
      dataDirs = String();   // la elige el usuario en Configuración (carpetas de datos)

   if ( !Settings::Read( "AutoRun", autoRun ) )
      autoRun = true;
   if ( !Settings::Read( "UILanguage", uiLanguage ) || uiLanguage.IsEmpty() )
      uiLanguage = "es";
   SetPiCopilotEnglish( uiLanguage == "en" );

   LoadScores();

   ResetAI();
   Settings::Read( "AIThreshold", threshold );
   Settings::Read( "ClaudeLow", claudeLow );
   Settings::Read( "ClaudeHigh", claudeHigh );
   Settings::Read( "CodexLow", openaiLow );
   Settings::Read( "CodexHigh", openaiHigh );
   Settings::Read( "MaxTurnsStep", maxTurnsStep );
   Settings::Read( "MaxTurnsFull", maxTurnsFull );
   Settings::Read( "MaxRetries", maxRetries );
   String adj;
   if ( Settings::Read( "AIAdjustments", adj ) )
   {
      StringList items;
      adj.Break( items, ';', true );
      for ( const String& it : items )
      {
         size_type eq = it.FindLast( '=' );
         if ( eq != String::notFound && eq > 0 )
            SetAdjustment( it.Left( eq ), it.Substring( eq+1 ).ToInt() );
      }
   }
}

void PiCopilotConfig::ResetAI()
{
   threshold = 95;
   adjustments.clear();
   claudeLow = "sonnet";
   claudeHigh = "opus";
   openaiLow.Clear();    // Codex: su modelo por defecto
   openaiHigh.Clear();
   maxTurnsStep = 80;
   maxTurnsFull = 400;
   maxRetries = 3;
}

int PiCopilotConfig::Adjustment( const String& stepKey ) const
{
   for ( const auto& a : adjustments )
      if ( a.first == stepKey )
         return a.second;
   return 0;
}

void PiCopilotConfig::SetAdjustment( const String& stepKey, int delta )
{
   for ( auto& a : adjustments )
      if ( a.first == stepKey )
      {
         a.second = delta;
         return;
      }
   if ( delta != 0 )
      adjustments.emplace_back( stepKey, delta );
}

bool PiCopilotConfig::HasTiers( const PiCopilotModel& m )
{
   return m.builtin && (m.IsAgent() || m.keyEnv == "OPENAI_API_KEY");
}

String PiCopilotConfig::TierModel( const PiCopilotModel& m, const String& stepKey, String& why ) const
{
   why.Clear();
   if ( !HasTiers( m ) )
      return m.IsAgent() ? String() : m.model;

   String low = m.IsClaude() ? claudeLow : openaiLow;
   String high = m.IsClaude() ? claudeHigh : openaiHigh;

   if ( stepKey.IsEmpty() )
   {
      why = u"Prompt libre: modelo superior";
      return high;
   }
   int base = BaseScore( stepKey );
   if ( base < 0 )
   {
      why = u"paso sin valor en la tabla: modelo superior";
      return high;
   }
   int score = base + Adjustment( stepKey );
   bool useLow = score > threshold;
   why = String().Format( "%d %s %d", score, useLow ? ">" : "<=", threshold );
   return useLow ? low : high;
}

void PiCopilotConfig::Save() const
{
   String custom;
   for ( const PiCopilotModel& m : models )
      if ( !m.builtin )
         custom << m.name << '\t' << m.type << '\t' << m.endpoint << '\t' << m.model << '\t' << m.keyEnv << '\n';
   Settings::Write( "Models", custom );
   Settings::Write( "CurrentModel", currentModel );
   Settings::Write( "GuideDir", guideDir );
   Settings::Write( "WorkDir", workDir );
   Settings::Write( "ClaudePath", claudePath );
   Settings::Write( "ClaudeArgs", claudeArgs );
   Settings::Write( "WatcherEnabled", watcherEnabled );
   Settings::Write( "WatcherSource", watcherSource );
   Settings::Write( "UILanguage", uiLanguage );
   Settings::Write( "AutoRun", autoRun );
   Settings::Write( "DataDirs", dataDirs );

   Settings::Write( "AIThreshold", threshold );
   Settings::Write( "ClaudeLow", claudeLow );
   Settings::Write( "ClaudeHigh", claudeHigh );
   Settings::Write( "CodexLow", openaiLow );
   Settings::Write( "CodexHigh", openaiHigh );
   Settings::Write( "MaxTurnsStep", maxTurnsStep );
   Settings::Write( "MaxTurnsFull", maxTurnsFull );
   Settings::Write( "MaxRetries", maxRetries );
   String adj;
   for ( const auto& a : adjustments )
      if ( a.second != 0 )
         adj << a.first << '=' << String().Format( "%d", a.second ) << ';';
   Settings::Write( "AIAdjustments", adj );
}

// ----------------------------------------------------------------------------
// Tabla de pesos Sonnet/Opus (proyecto nebulosa dual band)
//
// Valor base de cada paso = calidad de Sonnet en % de la de Opus, medida en
// nebulosa dual band (porcentajes_skill.json, nov 2026). Regla: si la puntuación es
// mayor que N se usa el modelo inferior; si es igual o menor, el superior.
// El paso 10 se midió en dos partes (NB 100, RGB 95): se toma la menor.
// Los pasos sin valor (-1: Dossier, Resolución Completa) usan el superior.
// ----------------------------------------------------------------------------

String PiCopilotConfig::ScoresFile() const
{
   return PiCopilotUtil::JoinPath( guideDir, "porcentajes_skill.json" );
}

void PiCopilotConfig::LoadScores()
{
   // La tabla vive en la guía (guia/porcentajes_skill.json) para poder
   // actualizarla sin recompilar. Claves del tipo "lineal/08-plate-solve" o
   // "lineal/10-combinacion-rgb-nb (parte NB)": se quita el "(...)", se añade
   // ".md" y, si un paso aparece varias veces, se toma el valor menor.
   scores.clear();
   scoresSource.Clear();
   String path = ScoresFile();
   if ( !File::Exists( path ) )
      return;
   JsonValue data;
   String whyNot;
   IsoString raw;
   try
   {
      raw = File::ReadTextFile( path );
   }
   catch ( ... )
   {
      return;
   }
   if ( !JsonValue::Parse( raw, data, whyNot ) )
      return;
   const JsonValue& procs = data["procesos"];
   if ( procs.type != JsonValue::Object )
      return;
   for ( const auto& kv : procs.o )
   {
      const JsonValue& v = kv.second["sonnet_vs_opus"];
      if ( v.type != JsonValue::Number )
         continue;
      String key = kv.first;
      size_type paren = key.Find( '(' );
      if ( paren != String::notFound )
         key = key.Left( paren );
      key.Trim();
      // Los pasos de la guía llevan carpeta ("lineal/..."); claves sueltas
      // como "completa" (Resolución Completa) se usan tal cual.
      if ( key.Contains( '/' ) && !key.EndsWith( ".md" ) )
         key << ".md";
      int value = RoundInt( v.n );
      bool found = false;
      for ( auto& s : scores )
         if ( s.first == key )
         {
            s.second = Min( s.second, value );
            found = true;
         }
      if ( !found )
         scores.emplace_back( key, value );
   }
   if ( !scores.empty() )
      scoresSource = path;
}

int PiCopilotConfig::BaseScore( const String& stepKey ) const
{
   if ( !scores.empty() )
   {
      for ( const auto& s : scores )
         if ( s.first == stepKey )
            return s.second;
      return -1;
   }
   return BuiltinScore( stepKey );
}

int PiCopilotConfig::BuiltinScore( const String& stepKey )
{
   // Respaldo si no se encuentra guia/porcentajes_skill.json.
   static const std::vector<std::pair<const char*, int>> table =
   {
      { "lineal/01-analisis-del-objeto.md",    86 },
      { "lineal/02-inventario.md",             97 },
      { "lineal/03-blink-subframeselector.md", 92 },
      { "lineal/04-preprocesado.md",           84 },
      { "lineal/05-staralignment-crop.md",     84 },
      { "lineal/06-hdr-composition.md",       100 },
      { "lineal/07-extraccion-canales.md",    100 },
      { "lineal/08-plate-solve.md",           100 },
      { "lineal/09-correccion-gradiente.md",   87 },
      { "lineal/10-combinacion-rgb-nb.md",     95 },
      { "lineal/11-bxt-correct-only.md",       95 },
      { "lineal/12-spcc.md",                   95 },
      { "lineal/13-bxt-completo.md",           95 },
      { "lineal/14-noisex-suave.md",           95 },
      { "lineal/15-starx.md",                  95 },
      { "lineal/16-linearfit-continuo.md",     95 },
      { "lineal/17-checkpoint.md",             95 },
      { "no-lineal/01-estirado.md",            95 },
      { "no-lineal/02-lrgb-paleta.md",         95 },
      { "no-lineal/03-scnr.md",                89 },
      { "no-lineal/04-mascaras.md",            89 },
      { "no-lineal/05-boost.md",               89 },
      { "no-lineal/06-noisex.md",              89 },
      { "no-lineal/07-nitidez.md",             89 },
      { "no-lineal/08-estrellas.md",           89 },
      { "no-lineal/09-recombinacion.md",       89 },
      { "no-lineal/10-recorte-exportacion.md", 89 },
      { "no-lineal/11-dossier.md",             80 },
      { "completa",                            80 },
   };
   for ( const auto& t : table )
      if ( stepKey == t.first )
         return t.second;
   return -1;
}

String PiCopilotConfig::BridgeDir()
{
   return PiCopilotUtil::JoinPath( File::HomeDirectory(), ".pixinsight-mcp/bridge" );
}

static String ClassicWatcherSource()
{
   return PiCopilotUtil::JoinPath( File::HomeDirectory(), "pixinsight-mcp/pjsr/pixinsight-mcp-watcher.js" );
}

String PiCopilotConfig::DefaultWatcherSource()
{
   // El watcher v8 (PixInsight 1.9.6+) trae BlindSolver integrado (blindSolve),
   // realces.js y procesos.js; el clásico queda como respaldo.
   String v8 = PiCopilotUtil::JoinPath( File::HomeDirectory(), "astro-agente-repo/watcher/pixinsight-mcp-watcher-v8.js" );
   if ( File::Exists( v8 ) )
      return v8;
   return ClassicWatcherSource();
}

String PiCopilotConfig::McpRunnerPath() const
{
   return PiCopilotUtil::JoinPath( workDir, "mcp/picopilot-mcp-runner.js" );
}

const PiCopilotModel& PiCopilotConfig::Current() const
{
   return models[Range( currentModel, 0, int( models.size() )-1 )];
}

String PiCopilotConfig::DossierDir() const
{
   return PiCopilotUtil::JoinPath( workDir, "dossiers" );
}

String PiCopilotConfig::TempDir() const
{
   return PiCopilotUtil::JoinPath( workDir, "tmp" );
}

String PiCopilotConfig::CurlPath() const
{
   String root = PiCopilotUtil::EnvVar( "SystemRoot" );
   if ( !root.IsEmpty() )
   {
      String p = PiCopilotUtil::JoinPath( root, "System32/curl.exe" );
      if ( File::Exists( p ) )
         return p;
   }
   return "curl";
}

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

static String DossierSchema()
{
   return
   u"{\n"
   u"  \"titulo\": \"Corrección de gradiente - <vista>\",\n"
   u"  \"vista\": \"<id de la vista original>\",\n"
   u"  \"analisis\": \"resumen del análisis previo de la imagen\",\n"
   u"  \"candidatos\": [\n"
   u"    { \"vista\": \"<id exacto de la copia abierta en PixInsight>\",\n"
   u"      \"modelo\": \"<id de la vista con su modelo de fondo (gradiente)>\",\n"
   u"      \"metodo\": \"GraXpert\", \"parametros\": \"sample_free escala 10\",\n"
   u"      \"metricas\": { \"gcStructCopy\": 0.05, \"flat\": 1.2 },\n"
   u"      \"notas\": \"observaciones\" }\n"
   u"  ],\n"
   u"  \"intermedias\": [\"<ids de las demás vistas auxiliares que hayas creado: bases, recortes, binados, SPFC...>\"],\n"
   u"  \"recomendado\": \"<id de la vista recomendada>\",\n"
   u"  \"motivo\": \"por qué es la mejor opción\",\n"
   u"  \"informe\": \"ruta opcional a un dossier .md con imágenes\"\n"
   u"}";
}

static String ViewText( const String& viewId )
{
   return viewId.IsEmpty() ? String( u"(no hay ninguna imagen seleccionada)" ) : u"\"" + viewId + u"\"";
}

String PiCopilotPrompts::System()
{
   return
   u"Eres PiCopilot, un asistente experto en procesado de astrofotografía integrado en PixInsight "
   u"como módulo nativo. Respondes en el idioma en que te escriba el usuario en el Prompt (si escribe en inglés, "
   u"en inglés; en las tareas de los botones de paso y en la interpretación de resultados, en ese mismo idioma de la "
   u"conversación, o en español si no hay ninguno), de forma clara y concisa. Eres fiel a los "
   u"datos: no inventas parámetros ni resultados; si algo no está en la guía o no lo has medido, lo dices.";
}

static String ComparativeBlock( const PiCopilotModel& model, const String& dossierPath )
{
   String s =
   u"\n\nEste paso tiene varias soluciones posibles, así que:\n"
   u"a) Haz primero un análisis de la imagen (tipo y forma del gradiente, si la nebulosa llena el campo, "
   u"si es banda ancha o estrecha).\n"
   u"b) Lanza comparativas SOBRE COPIAS de la imagen con los métodos que la guía considere aplicables "
   u"(GraXpert, MGC, DBE, ABE, GradientCorrection...), cada uno con 2 o 3 valores de su parámetro principal.\n"
   u"c) Mide cada resultado con guia/herramientas/gradcompare.js (gcStructCopy sobre el modelo como medida "
   u"principal; flat, contrast y ring sólo cuando la máscara del objeto sea fiable).\n"
   u"d) No apliques nada sobre la imagen original: el usuario elegirá la copia que prefiera.\n"
   u"e) Como último paso escribe el dossier en JSON (UTF-8) en esta ruta exacta:\n   " + dossierPath +
   u"\n   con esta forma:\n" + DossierSchema() +
   u"\n   En \"vista\" de cada candidato pon el id exacto de la copia abierta en PixInsight y en \"modelo\" el de su "
   u"modelo de fondo. Deja abiertas todas las vistas que listes: PiCopilot muestra cada candidato junto a su modelo "
   u"y, cuando el usuario elige uno, cierra los demás, sus modelos y las intermedias. Usa el prefijo GC_ para todas "
   u"las vistas que crees en la comparativa.";
   if ( !model.IsAgent() )
      // Sin herramientas, los modelos locales fallaban escribiendo el bucle de comparativa a mano; con la
      // función de la guía, Qwen 3.8 lo resolvió 3 de 3 veces (prueba del Paso 9, 4 nov 2026).
      s << u"\n   No escribas tú el bucle de comparativa: usa la función ya hecha gradienteCandidatos() de "
           u"herramientas/gradiente.js (está en la ficha), que crea las copias, ejecuta GraXpert y MGC, los mide y "
           u"escribe el dossier si le pasas la ruta en la opción \"dossier\". Tu script debe cargar gradiente.js con "
           u"eval en el nivel superior, llamar a gradienteCandidatos con la vista, las escalas que elijas y los valores "
           u"del perfil (spfc, mars, mgcOpts), pasar tu análisis en la opción \"analisis\" y escribir el resultado en "
           u"la consola. Si tu análisis previo necesita alguna medida, hazla antes, de forma breve.";
   return s;
}

static String RetryRule( const PiCopilotConfig& cfg );

static String HttpContext( const PiCopilotConfig& cfg, const PiCopilotModel& model )
{
   String contract = PiCopilotUtil::ReadText( PiCopilotUtil::JoinPath( cfg.guideDir, "anexos/A-contrato-api-pjsr.md" ), 12000 );
   // Sin acceso a ficheros, el modelo no puede leer el perfil: se adjunta (filtros, QE, base MARS, ajustes).
   // Sólo a modelos locales: el perfil es privado y no se manda a servicios en la nube.
   String perfil = model.IsCloud() ? String() : PiCopilotUtil::ReadText( PiCopilotUtil::JoinPath( cfg.guideDir, "perfil.md" ), 14000 );
   String s;
   if ( !perfil.IsEmpty() )
      s << u"\n\nPerfil del usuario (equipo, filtros, QE, base MARS y ajustes; úsalo para los valores que la guía "
           u"deja al perfil):\n<<<\n" << perfil << u"\n>>>";
   s <<
   u"\n\nNo tienes acceso directo a PixInsight. Responde con:\n"
   u"1) Una explicación breve del plan, los parámetros elegidos y por qué.\n"
   u"2) Un único bloque ```javascript con un script PJSR (ECMAScript 5) que ejecute la tarea. "
   u"El usuario lo revisará y lo ejecutará desde PiCopilot. Escribe en la consola (console.writeln) "
   u"las medidas antes y después. Sé breve en la explicación para que el script quepa entero.";

   // Rutas reales y trampas vistas en la prueba con Qwen 3.8 (Paso 9, nebulosa dual band):
   // inventaba la ruta de la guía y funciones de PJSR que no existen.
   String guide = cfg.guideDir;
   guide.ReplaceString( "\\", "/" );
   s << u"\n\nRutas reales: la guía está en " << guide << u" y sus herramientas en " << guide << u"/herramientas/ "
        u"(cárgalas con eval(File.readTextFile(ruta)) en el nivel superior del script, nunca dentro de una función)."
     << u"\nCopia el código de la ficha y cambia sólo IDs y valores. No inventes procesos, parámetros ni funciones:"
        u"\n- Renombrar una vista: ventana.mainView.id = \"NuevoId\" (no existe windowId)."
        u"\n- Recorrer ventanas: ImageWindow.windows (array); no existen windowCount ni windowByIndex."
        u"\n- gcStructCopy(base, idModelo) devuelve un objeto {copy, corr}, no un número."
        u"\n- Para crear una carpeta: if (!File.directoryExists(ruta)) File.createDirectory(ruta, true); "
        u"(si ya existe, createDirectory falla)."
        u"\n- Los ejemplos de la guía usan ids genéricos como \"MasterLight\": sustitúyelos siempre por el id "
        u"exacto de la vista objetivo de esta tarea."
        u"\n- Para escribir en la consola: console.writeln(texto) (console.log no existe en PJSR)."
        u"\n- El proceso GraXpert crea GraXpert_sample_free_background_extraction (corregida) y GraXpert_background "
        u"(modelo), con 1, 2... detrás si ya existían: no llevan el nombre de la vista de entrada."
        u"\n- Los procesos que crean ventanas nuevas (GraXpert, MGC) las nombran solos y añaden 1, 2... si ya "
        u"existen: localiza la ventana nueva comparando ImageWindow.windows antes y después.";
   if ( !contract.IsEmpty() )
      s << u"\n\nContrato de la API PJSR que debes respetar:\n<<<\n" << contract << u"\n>>>";
   return s;
}

// Ficha de detalle de un paso (guia/detalle/<fase>-<fichero>), si existe.
static String HelperBlock( const PiCopilotStep& step, const String& viewId, const String& secondViewId );

// Orden final para los modelos sin herramientas. Si el prompt acaba en el bloque de contexto, Qwen 3.8 contestaba
// la mitad de las veces con un JSON de error de API inventado (3 de 6); con esta línea al final, 6 de 6 traen script.
static String ClosingLine()
{
   return u"\n\nResponde ahora con el plan breve y un único bloque ```javascript con el script "
          u"(o, si no está claro qué vista usar, sólo con tu pregunta).";
}

static String DetailFile( const PiCopilotConfig& cfg, const PiCopilotStep& step )
{
   String f = step.file;
   f.ReplaceString( "/", "-" );
   String path = PiCopilotUtil::JoinPath( cfg.guideDir, u"detalle/" + f );
   return File::Exists( path ) ? path : String();
}

// Vistas abiertas en PixInsight, para los modelos sin herramientas: sin esta lista no saben cómo se llama la otra
// capa en los pasos que usan dos (recombinación, combinación de canales...).
// Sólo las del mismo tamaño que la vista objetivo (las demás no se pueden combinar con ella).
static String OpenViewsLine( const String& viewId )
{
   int tw = 0, th = 0;
   {
      View tv = View::ViewById( IsoString( viewId ) );
      if ( !tv.IsNull() )
      {
         ImageVariant ti = tv.Image();
         tw = ti.Width(); th = ti.Height();
      }
   }
   String list;
   int n = 0, others = 0;
   for ( const ImageWindow& w : ImageWindow::AllWindows() )
   {
      if ( w.IsNull() )
         continue;
      ImageVariant img = w.MainView().Image();
      if ( String( w.MainView().Id() ) == viewId )
         continue;
      if ( tw > 0 && (img.Width() != tw || img.Height() != th) )
      {
         ++others;
         continue;
      }
      if ( n++ > 0 )
         list << u", ";
      list << u'"' << String( w.MainView().Id() ) << u"\" (" << String().Format( "%dx%d", img.Width(), img.Height() )
           << (img.NumberOfNominalChannels() >= 3 ? u" RGB" : u" mono") << u')';
      if ( n >= 30 )
         break;
   }
   String s = u"Otras vistas abiertas del mismo tamaño: " + (list.IsEmpty() ? String( u"ninguna" ) : list) + u".";
   if ( others > 0 )
      s << u" (Hay " << String().Format( "%d", others ) << u" más de otro tamaño, que no sirven para combinar con ella.)";
   s << u"\nSi el paso necesita otra capa (estrellas, starless, canal…) y no está claro por el nombre cuál de estas es, "
        u"NO escribas el script: di qué vistas dudas y pregunta cuál usar.\n";
   return s;
}

static String ModelNote()
{
   return u"\nModelo: PiCopilot ya ha elegido el modelo de este paso con la regla N de la guía "
          u"(sección \"Modelo por paso\"); no preguntes por N.";
}

String PiCopilotPrompts::SecondLayer( const PiCopilotStep& step )
{
   if ( step.file == "no-lineal/09-recombinacion.md" || step.file == "no-lineal/01-estirado.md" )
      return u"capa de estrellas";
   return String();
}

String PiCopilotPrompts::DataFolder( const PiCopilotStep& step )
{
   if ( step.file == "lineal/02-inventario.md" )
      return u"Carpeta del objeto (con las noches dentro)";
   if ( step.file == "lineal/03-blink-subframeselector.md" )
      return u"Carpeta de los LIGHT de una noche";
   if ( step.file == "lineal/04-preprocesado.md" )
      return u"Carpeta de la noche (con LIGHT, FLAT y DARK)";
   if ( step.file == "lineal/05-staralignment-crop.md" )
      return u"Carpeta con los masters a alinear";
   if ( step.file == "lineal/06-hdr-composition.md" )
      return u"Carpeta con los masters alineados (larga y corta)";
   if ( step.file == "lineal/10-combinacion-rgb-nb.md" )
      return u"Carpeta con los masters a combinar (L, R, G, B, Hα, OIII...)";
   return String();
}

String PiCopilotPrompts::Step( const PiCopilotConfig& cfg, const PiCopilotModel& model, const PiCopilotStep& step,
                               const String& viewId, const String& dossierPath, bool newSession,
                               const String& secondViewId, const String& dataFolder )
{
   String guideFile = PiCopilotUtil::JoinPath( cfg.guideDir, step.file );
   String phase = step.linear ? u"fase lineal" : u"fase no lineal";

   String s;
   s << u"Tarea de PiCopilot: " << step.label << u" (" << phase << u").\n";
   if ( !dataFolder.IsEmpty() )
   {
      StringList folders;
      dataFolder.Break( folders, '|', true );
      String df;
      for ( String f : folders )
      {
         f.ReplaceString( "\\", "/" );
         df << (df.IsEmpty() ? u"\"" : u", \"") << f << u"\"";
      }
      if ( folders.Length() > 1 )
         s << u"Este paso trabaja con ficheros, no con una vista. " << DataFolder( step ) << u": el usuario ha elegido "
           << String( int( folders.Length() ) ) << u" carpetas: [" << df << u"]. Pásalas todas juntas como lista (las funciones aceptan listas "
           << u"de carpetas) en una sola llamada";
      else
         s << u"Este paso trabaja con ficheros, no con una vista. " << DataFolder( step ) << u", elegida por el usuario: " << df
           << u". Úsala tal cual como carpeta de entrada";
      s << u" (para flats y darks, las subcarpetas FLAT y DARK si existen; la biblioteca de master darks, la del perfil). "
           u"No preguntes por la ruta. No listes la carpeta ni compruebes los ficheros tú: la función lo hace "
           u"(File.listFiles y File.listDirectory no existen en PixInsight).\n";
   }
   else
      s << u"Imagen objetivo en PixInsight: vista " << ViewText( viewId ) << u".\n";
   if ( !secondViewId.IsEmpty() )
      s << u"Segunda capa (" << SecondLayer( step ) << u", elegida por el usuario): vista \"" << secondViewId
        << u"\". Usa exactamente esta; no uses ninguna otra vista abierta.\n";

   if ( model.IsAgent() )
   {
      s << ModelNote() << u"\n";
      if ( newSession )
         s << u"\nEsta es una sesión nueva de la " << phase << u" (la guía usa una sesión por fase)."
           << (step.linear ? String()
                           : String( u" Lee también el estado.md que dejó el checkpoint lineal (Paso 17) en la "
                                     u"carpeta de la versión; si no lo encuentras, dilo y sigue con lo que veas abierto." ))
           << u"\n";
      s << u"\n1) Lee el núcleo de la guía (" << PiCopilotUtil::JoinPath( cfg.guideDir, "SKILL.md" )
        << u") y perfil.md si aún no los has leído en esta sesión, y la ficha del paso (" << guideFile
        << u"). Los ficheros de detalle/ y los anexos, sólo si la ficha no basta. "
           u"Sigue su método predeterminado y sus ajustes de partida.\n"
        << u"2) Ejecuta el paso sobre la vista indicada con las herramientas MCP de PiCopilot (mcp__picopilot__*): "
           u"cada función de la guía es una herramienta con el mismo nombre (analizarMaster, gradienteCandidatos, "
           u"estirarAlFallo...). Si una tarda más de 45 s devuelve un trabajo: recógelo con estado(trabajo). "
           u"Trabaja sobre una copia cuando la guía lo aconseje y no cierres ni sobrescribas la original sin decirlo.\n"
        << u"3) Mide antes y después (estadisticas, previa y las métricas que pida la guía) y comprueba el resultado.\n"
        << u"4) Termina con un resumen breve: qué hiciste, con qué parámetros, qué mediste y qué vistas nuevas existen."
        << RetryRule( cfg );
      if ( step.comparative )
         s << ComparativeBlock( model, dossierPath );
   }
   else
   {
      if ( secondViewId.IsEmpty() )
         s << OpenViewsLine( viewId );
      String guide = PiCopilotUtil::ReadText( guideFile, 24000 );
      if ( !guide.IsEmpty() )
         s << u"\nPaso de la guía (" << step.file << u"):\n<<<\n" << guide << u"\n>>>";
      else
         s << u"\n(No se encontró el archivo de la guía " << guideFile << u".)";
      // Sin acceso a ficheros, el modelo no puede pedir el detalle: se adjunta.
      String detail = DetailFile( cfg, step );
      if ( !detail.IsEmpty() )
         s << u"\n\nDetalle del paso (porqué, medidas y recetas; úsalo si la ficha no basta):\n<<<\n"
           << PiCopilotUtil::ReadText( detail, 16000 ) << u"\n>>>";
      if ( step.comparative )
         s << ComparativeBlock( model, dossierPath );
      s << HelperBlock( step, viewId, secondViewId );
      s << HttpContext( cfg, model ) << ClosingLine();
   }
   return s;
}

// Pasos con una función ya hecha en guia/herramientas: a los modelos sin herramientas se les pide usarla en
// vez de escribir el código. Sin la instrucción explícita la usaban sólo la mitad de las veces; usándola,
// Qwen 3.8 pasó de ~15–18/40 a ~31–33/40 (banco de pruebas del 4 nov 2026).
static String HelperBlock( const PiCopilotStep& step, const String& viewId, const String& secondViewId )
{
   struct Helper { const char* file; const char16_t* call; const char16_t* lib; };
   static const Helper helpers[] =
   {
      { "lineal/01-analisis-del-objeto.md", u"analizarMaster(\"%V\")", u"analisis.js" },
      { "lineal/13-bxt-completo.md", u"bxtCandidatos(\"%V\", { tipo: ... }) y, en el mismo script, bxtAplicar(\"%V\", { nonstellar: r.recomendada.nonstellar, stars: r.recomendada.stars, nuevaVista: ... }) devolviendo JSON.stringify({ candidatos: r, aplicado: a })", u"deconvolucion.js" },
      { "lineal/14-noisex-suave.md", u"reducirRuido(\"%V\", { denoise: 0.50, detail: 0.15, iterations: 2, nuevaVista: ... })", u"ruido.js" },
      { "lineal/15-starx.md", u"separarEstrellas(\"%V\", { nuevaVista: ..., nuevasEstrellas: ... }) y, en el mismo script, reducirRuido(s.starless, ...) (híbrido con el modelo del perfil si es mono; { denoise: 0.50 } si es RGB y ya pasó el NXT suave del Paso 14, 0.70 sin él: con más salen manchas de color; mira moteado_color_despues) devolviendo JSON.stringify({ separacion: s, denoise: d })", u"ruido.js" },
      { "no-lineal/05-boost.md", u"saturarAlFallo(\"%V\", { tipo: \"nebulosa\" | \"galaxia\", nuevaVista: ... }) para la saturación (el LHE y las curvas, si hacen falta, después y a mano). "
        u"En galaxias, ANTES y en su propio script, comprimirNucleo(\"%V\", { nuevaVista: ... }) (nucleo.js) si el estirado dio meseta_nucleo.radio_px > 3, "
        u"y la saturación sobre su resultado", u"boost.js" },
      { "no-lineal/10-recorte-exportacion.md", u"exportarFinal(\"%V\", { carpeta: ..., nombre: ..., girar180: ... })", u"exportar.js" },
      { "no-lineal/06-noisex.md", u"reducirRuido(\"%V\", { denoise: 0.30, detail: 0.15, nuevaVista: ... })", u"ruido.js" },
      { "lineal/08-plate-solve.md", u"resolverAstrometria(\"%V\")", u"lineal.js" },
      { "lineal/07-extraccion-canales.md", u"desmezclarDualBand(\"%V\")", u"bandaestrecha.js" },
      { "lineal/16-linearfit-continuo.md", u"medirContinuo(<banda estrecha CON estrellas>, <RGB calibrada CON estrellas>, { canal: 0 }) y restarContinuo(\"%V\", <RGB sin estrellas>, { k: ..., nuevaVista: ... }) en el mismo script", u"bandaestrecha.js" },
      { "no-lineal/04-mascaras.md", u"crearMascara(\"%V\", { tipo: \"luminancia\" | \"cielo\" | \"fondo_lhe\" })", u"mascaras.js" },
      { "no-lineal/02-lrgb-paleta.md", u"previsualizarPaletas(\"%V\", <OIII estirado igual>, { carpeta: ... }) para las previews; la composición final con componerPaleta({ S, H, O }, { paleta: \"SHO\" | \"HOO\" | \"FORAXX\" ..., estrellas }) y la paleta que elija el usuario (paletasDisponibles() da la lista)", u"bandaestrecha.js" },
      { "lineal/11-bxt-correct-only.md", u"bxtCorrectOnly(\"%V\", { nuevaVista: ... })", u"lineal.js" },
      { "lineal/17-checkpoint.md", u"checkpointLineal(\"%V\", { carpeta: ..., objeto: ..., version: ... })", u"lineal.js" },
      { "no-lineal/03-scnr.md", u"quitarVerde(\"%V\", { nuevaVista: ... })", u"lineal.js" },
      { "lineal/12-spcc.md", u"calibrarColor(\"%V\", { nuevaVista: ..., spcc: { ...filtros y QE del perfil... } })", u"color.js" },
      { "no-lineal/01-estirado.md", u"estirarCapas(\"%V\", \"%S\", { cielo: 0.10, nuevaStarless: ..., nuevasEstrellas: ... }) (si el objeto es una galaxia, "
        u"OBLIGATORIO { tipo: \"galaxia\", nuevaStarless: ..., nuevasEstrellas: ... } sin cielo: cielo 0,07 y estrellas con el mismo estirado; "
        u"si es una nebulosa oscura de polvo, { tipo: \"nebulosa_oscura\", ... } sin cielo)", u"estirado.js" },
      { "no-lineal/08-estrellas.md", u"prepararEstrellas(\"%V\", { nuevaVista: ... })", u"estrellas.js" },
      { "no-lineal/09-recombinacion.md", u"recombinarEstrellas(\"%V\", \"%S\", { nuevaVista: ... })", u"recombinacion.js" },
      { "lineal/10-combinacion-rgb-nb.md", u"combinarMasters(<carpeta o lista de masters alineados>, { tipo: \"nebulosa\" | \"galaxia\" }) (no usa ninguna vista: "
        u"clasifica cada master por su filtro y combina lo que toca). Antes mira «Cuándo aplica» en la ficha: si sólo hay una imagen RGB "
        u"(OSC sin filtro) o sólo dual band, di que el paso no aplica y no escribas script", u"combinacion.js" },
      { "lineal/09-correccion-gradiente.md", u"gradienteCandidatos(\"%V\", { spfc: { ...filtros y QE del perfil... }, "
        u"analisis: \"<tu análisis breve>\", dossier: \"<la ruta del dossier indicada arriba>\" }) — por defecto compara GraXpert (10, 8), "
        u"MGC (1024, 2048, con y sin bordes; base MARS de PixInsight) y polinomio robusto (grado 1 y 2), los mide, recomienda y escribe el dossier. "
        u"No hay método preferido: recomienda el que mida mejor en ESTA imagen (lee la «leyenda» del resultado). No escribas tú GraXpert, "
        u"MultiscaleGradientCorrection, DBE ni ABE", u"gradiente.js" },
      { "lineal/06-hdr-composition.md", u"componerHDR(<carpeta o lista [larga, corta] de masters alineados>, { nuevaVista: \"HDR\" }) (no usa ninguna vista; la HDR sale como vista nueva)", u"hdr.js" },
      { "lineal/05-staralignment-crop.md", u"alinearMasters(<carpeta, lista de masters .xisf o lista de ids de las vistas abiertas>, { referencia: <el master de mejor resolución y SNR: L o Hα; si no lo sabes, no la pongas> }) (sin salida, salvo que el usuario dé la carpeta: la función crea 'alineados' junto a los masters)", u"alineado.js" },
      { "lineal/02-inventario.md", u"inventario(<carpeta del objeto>, { darks: <carpeta o lista de master darks de la biblioteca, si el perfil la da> }) (no usa ninguna vista)", u"preproceso.js" },
      { "lineal/03-blink-subframeselector.md", u"seleccionarSubs(<carpeta de LIGHT o lista de ficheros>, { csv: ... }) (no usa ninguna vista)", u"preproceso.js" },
      { "lineal/04-preprocesado.md", u"revisarCalibracion({ lights: ..., flats: ..., flatDarks: ..., darks: ... }) (no usa ninguna vista). "
        u"En este script SÓLO revisarCalibracion: nunca lances WBPP en el mismo script ni con un if sobre el resultado. "
        u"Cuando el usuario haya visto la revisión y te pida seguir, en otro script lanzarWBPP({ lights: ..., flats: ..., flatDarks: ..., darks: ..., salida: <ruta corta> }) "
        u"y después estadoWBPP(<salida>) hasta que devuelva terminado: true", u"preproceso.js" },
   };
   for ( const Helper& h : helpers )
      if ( step.file == h.file )
      {
         // %V = la vista seleccionada, que es siempre la entrada principal (sin esto Qwen llegó a usar otra vista
         // abierta como starless y la seleccionada como nombre de salida).
         String call( h.call );
         // Estirado sin capa de estrellas (sólo hay una vista de ese tamaño): sólo la starless.
         if ( step.file == "no-lineal/01-estirado.md" && secondViewId.IsEmpty() )
            call = u"estirarStarless(\"%V\", { cielo: 0.10, nuevaVista: ... }) (no hay capa de estrellas: sólo la starless)";
         call.ReplaceString( u"%V", viewId.IsEmpty() ? String( u"<vista seleccionada>" ) : viewId );
         call.ReplaceString( u"%S", secondViewId.IsEmpty() ? String( u"<capa de estrellas preparada>" ) : secondViewId );
         return u"\n\nUsa la función ya hecha " + call + u" de herramientas/" + String( h.lib ) +
                u" (está en la ficha) en vez de escribir tú ese código: cárgala con eval en el nivel superior del "
                u"script y llámala. Haz que la última expresión del script sea JSON.stringify(resultado) y no hagas nada "
                u"más con el resultado dentro del script (no lo recorras ni lo imprimas: no conoces sus campos hasta verlo). "
                u"PiCopilot te devolverá ese resultado para que lo interpretes según la ficha. La entrada principal es "
                u"la vista seleccionada; la vista nueva tiene que tener un nombre nuevo, nunca el de una que ya existe.";
      }
   return String();
}

static String RetryRule( const PiCopilotConfig& cfg )
{
   if ( cfg.maxRetries <= 0 )
      return String();
   return u"\n\nLímite de intentos: si una misma operación falla o no mejora el resultado " +
          String().Format( "%d", cfg.maxRetries ) +
          u" veces seguidas (mismo error, o la métrica que buscas no mejora), PARA: no sigas probando variantes. "
          u"Explica qué intentaste, qué falló y qué propones, y deja la imagen como estaba.";
}

String PiCopilotPrompts::Full( const PiCopilotConfig& cfg, const PiCopilotModel& model,
                               const String& viewId, const String& dossierPath )
{
   String s;
   s << u"Tarea de PiCopilot: RESOLUCIÓN COMPLETA.\n"
     << u"Imagen objetivo en PixInsight: vista " << ViewText( viewId ) << u".\n\n"
     << u"Procesa la imagen de principio a fin siguiendo la guía (" << PiCopilotUtil::JoinPath( cfg.guideDir, "SKILL.md" )
     << u"): primero los pasos de la fase lineal que apliquen y después los de la fase no lineal, en orden.\n"
     << u"- Antes de empezar analiza el objeto y los datos y di qué pasos aplican y cuáles no (y por qué).\n"
     << u"- Mide antes y después de cada paso y para si una medida indica un problema.\n"
     << u"- Guarda un checkpoint al final de la fase lineal.\n"
     << u"- Termina con el dossier del paso 11 de la fase no lineal y un resumen de lo hecho."
     << u"\n- Aunque la guía usa una sesión por fase, aquí haces las dos seguidas: escribe igualmente el "
        u"estado.md del checkpoint al acabar la fase lineal."
     << RetryRule( cfg );
   if ( model.IsAgent() )
      s << ModelNote();
   s << u"\n\nEn la corrección de gradiente:" << ComparativeBlock( model, dossierPath )
     << u"\n   Después continúa con la copia recomendada.";
   if ( !model.IsAgent() )
      // Qwen metía los 11 pasos en un script de 8 minutos y cada corrección lo repetía entero (7 nov 2026).
      s << u"\n\nHazlo en varios scripts: UN PASO POR SCRIPT (como mucho dos muy ligados). Ahora propón sólo el primero; "
           u"cuando veas su resultado, el siguiente, con los ids de las vistas que devolvió.";
   if ( !model.IsAgent() )
      s << HttpContext( cfg, model ) << ClosingLine();
   return s;
}

// Catálogo de las funciones de guia/herramientas para la ventana de Prompt de los modelos sin herramientas. Sin él,
// a Qwen 3.8 se le pidió "de SPCC a la separación de estrellas" y se inventó StarReduction / StarSplitting y dijo que
// SPCC no existía (prueba del 5 nov 2026): el Prompt libre no llevaba nada de la guía.
static String ToolCatalog( const PiCopilotConfig& cfg )
{
   String g = cfg.guideDir;
   g.ReplaceString( u"\\", u"/" );
   return
      u"\n\nFunciones ya hechas de la guía (" + g + u"/herramientas). PiCopilot ya las tiene cargadas al ejecutar tu script; "
      u"si aun así las cargas, usa sólo estos ficheros con eval(File.readTextFile(\"" + g +
      u"/herramientas/<fichero>.js\")) en el nivel superior del script (checkpoint.js y similares no existen). Cada una trabaja sobre una copia, mide y devuelve "
      u"un objeto (vista nueva, medidas, no_cumple, control). Úsalas en vez de escribir el código:\n"
      u"- analisis.js: analizarMaster(vista o lista de vistas) — Paso 1 lineal (análisis del objeto)\n"
      u"- preproceso.js (trabajan con ficheros; aceptan una carpeta o una lista de carpetas o ficheros, y ellas buscan los "
      u"ficheros: no escribas tu propia búsqueda, File.listFiles no existe): inventario(carpeta del objeto, { darks }) — Paso 2; "
      u"seleccionarSubs(carpeta LIGHT, de la noche o del objeto) — Paso 3; revisarCalibracion({ carpeta: noche, darks }) — Paso 4; "
      u"lanzarWBPP({ carpeta, darks, salida }) y estadoWBPP(salida) — Paso 4, sólo cuando el usuario lo pida\n"
      u"- alineado.js: alinearMasters(carpeta, lista de ficheros o lista de ids de vistas abiertas) — Paso 5 (StarAlignment + "
      u"recorte común; no le pases salida ni inventes rutas: crea 'alineados' junto a los masters y abre los _alin; "
      u"devuelve r.vistas (ids _alin) y r.vista (la referencia) y YA resuelve la astrometría y la copia a todas: no llames "
      u"después a resolverAstrometria; analizarMaster(r.vistas) analiza todas de una vez. Orden con varios masters: "
      u"ALINEAR PRIMERO y astrometría después (resolver antes no sirve: la solución no pasa a los alineados); si el usuario "
      u"pide astrometría antes de alinear, sugiérele este orden y por qué; "
      u"pásale sólo los masters del mismo objeto que el usuario quiere alinear: si hay vistas abiertas de otro objeto, "
      u"repetidas o que no son masters (copias _bxt, _spcc, starless…) y no está claro cuáles van, pregunta antes; "
      u"elige sola la referencia si no la sabes); astrometriaLineal(ventana) — llámala ANTES de Crop, Resample, IntegerResample, "
      u"DynamicCrop o FastRotation sobre una imagen con astrometría: si la solución tiene splines, el proceso abre un diálogo "
      u"y el script se queda parado\n"
      u"- hdr.js: componerHDR([larga, corta], { nuevaVista }) — Paso 6 (HDRComposition con umbral medido)\n"
      u"- combinacion.js: combinarMasters(carpeta o lista de masters, { tipo }) — Paso 10 (clasifica y combina); también inyectarHa(rgb, ha, { tipo, nuevaVista }) y combinarMismoCanal(a, b, { nuevaVista }) sobre vistas\n"
      u"- lineal.js: resolverAstrometria(vista) — Paso 8 (plate solve con blindSolve); bxtCorrectOnly(vista, { nuevaVista }) — Paso 11; "
      u"checkpointLineal(vista, { carpeta, objeto, version }) — Paso 17; quitarVerde(vista, { nuevaVista }) — Paso 3 no lineal (SCNR)\n"
      u"- bandaestrecha.js: desmezclarDualBand(vista) — Paso 7; medirContinuo(nb, rgb, { canal }) y restarContinuo(nb, rgb, { k }) — Paso 16; "
      u"previsualizarPaletas(ha, oiii, { carpeta }) — Paso 2 no lineal (previews); componerPaleta({ S, H, O }, { paleta, estrellas }) — composición final "
      u"con capas starless estiradas (SHO, HOO, FORAXX…; paletasDisponibles() da la lista)\n"
      u"- mascaras.js: crearMascara(vista, { tipo: luminancia | cielo | fondo_lhe }) — Paso 4 no lineal\n"
      u"- gradiente.js: r = gradienteCandidatos(vista, {...}) — Paso 9 lineal (gradiente). NO corrige la vista: compara copias "
      u"GC_* y devuelve r.recomendado (id de la copia recomendada). Los pasos siguientes van sobre r.recomendado, nunca sobre "
      u"r.vista (que es la original SIN corregir)\n"
      u"- color.js: calibrarColor(vista, { nuevaVista, spcc: {filtros del perfil} }) — Paso 12 lineal (SPCC; OSC sin filtro: spcc vacío, "
      u"no existe la opción filtros); neutralizarCielo(vista lineal, { nuevaVista }) — si calibrarColor, checkpointLineal o el "
      u"estirado dan el cielo no neutro / dominante del cielo: neutraliza el fondo en LINEAL (vale sobre la starless lineal) y "
      u"se vuelve a estirar. Nunca SCNR ni curvas para eso\n"
      u"- deconvolucion.js: r = bxtCandidatos(vista, { tipo }) y bxtAplicar(vista, { nonstellar: r.recomendada.nonstellar, stars: r.recomendada.stars, nuevaVista }) — Paso 13 (BlurX completo)\n"
      u"- ruido.js: reducirRuido(vista, { denoise, detail, iterations, nuevaVista }) — Paso 14 lineal (denoise 0,50), Paso 15 sobre la starless (RGB: 0,50 tras el NXT suave del 14, 0,70 sin él; si moteado_color_despues > 1,5, menos) y Paso 6 no lineal (0,30); separarEstrellas(vista, { nuevaVista, nuevasEstrellas }) — Paso 15 (StarX)\n"
      u"- estirado.js: estirarCapas(starless, estrellas, { cielo: 0.10, nuevaStarless, nuevasEstrellas }) — Paso 1 no lineal; en GALAXIAS "
      u"SIEMPRE { tipo: \"galaxia\", nuevaStarless, nuevasEstrellas } y sin cielo (cielo 0,07 y estrellas con el mismo estirado que la starless); "
      u"en NEBULOSAS OSCURAS (polvo: LDN, LBN, vdB, sin emisión) { tipo: \"nebulosa_oscura\", nuevaStarless, nuevasEstrellas } sin cielo (cielo 0,12); "
      u"estrellas: \"extraer\" SÓLO en galaxias (en nebulosas hincha las estrellas); la capa de estrellas sale con arcsinh: NO pases amount (starStretch pierde las estrellas débiles). "
      u"Si NO sabes qué tipo de objeto es (sin OBJECT y con un nombre de fichero genérico), antes del Paso 1 no lineal PARA y PREGUNTA al usuario el tipo "
      u"(galaxia, nebulosa oscura, de emisión, de reflexión, planetaria, cúmulo…); no estires con los valores por defecto\n"
      u"- nucleo.js: comprimirNucleo(vista, { nuevaVista }) — Paso 5 no lineal en GALAXIAS, antes de saturar (HDRMT al 60 % con máscara de bulbo; "
      u"obligatorio si estirarCapas dio meseta_nucleo.radio_px > 3); medirMeseta(vista) sólo mide\n"
      u"- boost.js: saturarAlFallo(vista, { tipo }) — Paso 5 no lineal (saturación)\n"
      u"- estrellas.js: prepararEstrellas(vista, { nuevaVista }) — Paso 8 no lineal\n"
      u"- recombinacion.js: recombinarEstrellas(starless, estrellas, { nuevaVista }) — Paso 9 no lineal\n"
      u"- exportar.js: exportarFinal(vista, { carpeta, nombre, girar180 }) — Paso 10 no lineal\n"
      u"UN PASO POR SCRIPT (como mucho dos muy ligados, p. ej. bxtCandidatos + bxtAplicar o separarEstrellas + su denoise): "
      u"aunque te pidan el procesado completo, propón el script del primer paso, y al ver su resultado el del siguiente. Así, "
      u"si un paso falla, no se repiten los anteriores (cada uno tarda minutos). Entre scripts usa los ids de las vistas que "
      u"devolvió el paso anterior. Dentro de un script, la vista de una función es la entrada de la siguiente (r.vista, "
      u"s.starless, s.estrellas...; las funciones aceptan también el resultado entero) y se termina con JSON.stringify({ ...resultados... }). "
      u"Esas vistas son ids (texto): pásalos tal cual, sin .id. no_cumple es una lista (vacía si todo cumple): NO pares el "
      u"script por ella ni la uses en un if; devuélvela en el resultado. PERO al ver el resultado, si no_cumple no está vacío, "
      u"NO pases al paso siguiente: haz lo que dice el mensaje (repetir ese paso o volver al que indica, p. ej. neutralizarCielo "
      u"si el checkpoint da el cielo no neutro, o repetir estirarCapas sin amount —en galaxias con tipo \"galaxia\"— si las estrellas casi no aportan). "
      u"El nombre del objeto y la carpeta de trabajo salen de la cabecera (OBJECT), de la ruta del master o de lo que diga el usuario; "
      u"si no los sabes, pregúntalos: NUNCA uses nombres que aparezcan en la guía ni los deduzcas de las coordenadas. "
      u"El continuo (16) sólo aplica si hay un master de banda estrecha (Hα, OIII) y otro de banda ancha: con un solo master RGB/OSC, sáltalo. "
      u"En el Paso 15 sobre la starless RGB, denoise 0,50 si ya se hizo el NoiseX suave del 14 (0,70 sólo sin él). "
      u"Los únicos umbrales son los de las funciones: no inventes otros («límite 2,0» no existe). SCNR y más NoiseX no quitan "
      u"manchas de color grandes en no lineal. "
      u"Orden lineal (respétalo: el gradiente SIEMPRE antes de SPCC): análisis (1) → alinear masters (5, si hay varios) → HDR (6) → "
      u"desmezcla dual band (7) → astrometría (8) → gradiente (9: gradienteCandidatos, y se sigue con r.recomendado) → "
      u"combinación RGB/NB (10) → BlurX correct only (11, ya hecho si el master viene del flujo) → SPCC (12) → BlurX completo (13) → "
      u"NoiseX suave (14) → StarX + denoise de la starless (15) → continuo (16) → checkpointLineal (17). Orden no lineal: "
      u"estirarCapas (1) → paleta (2) → SCNR (3) → máscaras (4, sólo si se van a usar) → en galaxias comprimirNucleo (5) → saturarAlFallo (5) → "
      u"NoiseX (6) → prepararEstrellas (8) → "
      u"recombinarEstrellas (9) → exportarFinal (10). estirarCapas devuelve { starless: {vista, ...}, estrellas: {vista, ...} }: "
      u"las vistas estiradas son r.starless.vista y r.estrellas.vista. Si te piden desde un paso, empieza en ese paso.\n"
      u"Nombres reales de los procesos: SPCC = SpectrophotometricColorCalibration, BXT = BlurXTerminator, "
      u"NXT = NoiseXTerminator, SXT = StarXTerminator, GHS = GeneralizedHyperbolicStretch. No existen StarReduction, "
      u"StarSplitting, Image.activeImage ni alert(); un script PJSR no puede usar return en el nivel superior.\n"
      u"Si lo que te piden lo hace una de estas funciones (p. ej. «analiza la corrección de gradiente» → gradienteCandidatos, "
      u"que compara GraXpert, MGC y polinomio y mide cuánto se come cada uno el objeto), USA LA FUNCIÓN: no escribas tú GraXpert, "
      u"MultiscaleGradientCorrection, BlurX, NoiseX ni tus propias métricas. Si no hay imagen seleccionada, pide al usuario "
      u"que la seleccione o que te diga su id; nunca uses ImageWindow.windows[0] ni la primera ventana que encuentres.\n"
      u"NO leas campos del resultado que no conozcas (r.medidas.escala y parecidos fallan con \"Cannot read properties of "
      u"undefined\"): devuelve el objeto entero con JSON.stringify y coméntalo cuando veas lo que ha medido. Si te piden "
      u"analizar varias imágenes, llama a la función una vez por vista y devuelve todo junto: JSON.stringify({ vista1: r1, vista2: r2, … }).\n"
      u"ANTES DE NADA, con varios masters (filtros, noches o cámaras distintas): si no están alineados y recortados "
      u"(sus ids no acaban en _alin, o analizarMaster da bordes_sin_datos.hay), el primer paso es el 5, alinearMasters con "
      u"sus ficheros, y el resto se hace sobre los _alin. Nunca gradiente, BXT, SPCC ni desmezcla antes. Con un solo master y "
      u"bordes_sin_datos.hay, recortar primero con Crop (bordes_sin_datos.recorte). SPCC con filtros de banda ancha NO va "
      u"sobre los masters dual band: rompe la desmezcla.\n"
      u"No hay un método de gradiente preferido: se comparan con gradienteCandidatos y se aplica el que mejor mida. "
      u"Masters de cámara color con filtro dual band (HaO3, S2O3, SHb…): Paso 7 desmezclarDualBand sobre CADA master dual band "
      u"(detecta el filtro; devuelve r.lineas, p. ej. { SII: \"SII_raw_S2O3\", OIII: \"OIII_raw_S2O3\" }); después el gradiente "
      u"(Paso 9) se hace sobre cada raya desmezclada y sobre el RGB, NO sobre los masters dual band en color; "
      u"Paso 16 restar continuo si hace falta y Paso 10 combinarMasters con el RGB. Las paletas (SHO, HOO…) se eligen en el "
      u"Paso 2 no lineal, no en la fase lineal.";
}

// Todas las vistas abiertas (para el Prompt libre: el modelo tiene que conocer sus ids para usarlas).
static String AllViewsLine()
{
   String list;
   int n = 0;
   for ( const ImageWindow& w : ImageWindow::AllWindows() )
   {
      if ( w.IsNull() )
         continue;
      ImageVariant img = w.MainView().Image();
      if ( n++ > 0 )
         list << u", ";
      list << u'"' << String( w.MainView().Id() ) << u"\" (" << String().Format( "%dx%d", img.Width(), img.Height() )
           << (img.NumberOfNominalChannels() >= 3 ? u" RGB" : u" mono") << u')';
      if ( n >= 30 )
         break;
   }
   return u" Vistas abiertas: " + (list.IsEmpty() ? String( u"ninguna" ) : list) +
          u". Si el usuario habla de varias imágenes, son estas: usa sus ids exactos.";
}
String PiCopilotPrompts::Free( const PiCopilotConfig& cfg, const PiCopilotModel& model, const String& text, const String& viewId, bool firstTurn )
{
   if ( !firstTurn )
   {
      // Las vistas cambian entre mensajes: se repite siempre la lista actual (es corta).
      if ( model.IsAgent() )
         return text;
      return u"[Vista activa: " + ViewText( viewId ) + u"." + AllViewsLine() +
             u" Para medir o procesar, propón un script PJSR con las funciones de la guía.]\n\n" + text;
   }
   String s;
   s << u"[Contexto de PiCopilot: imagen activa en PixInsight: vista " << ViewText( viewId ) << u"." << AllViewsLine();
   if ( model.IsAgent() )
      s << u" Puedes actuar sobre ella con las herramientas MCP de PiCopilot (mcp__picopilot__*) si te lo pido.";
   else
      s << u" Si propones un script PJSR, ponlo en un único bloque ```javascript.";
   s << u"]";
   if ( !model.IsAgent() )
      s << ToolCatalog( cfg ) << HttpContext( cfg, model );
   s << u"\n\n" << text;
   return s;
}

String PiCopilotPrompts::ExtractScript( const String& response )
{
   static const char* fences[] = { "```javascript", "```js", "```JavaScript" };
   size_type best = String::notFound;
   size_type bestLen = 0;
   for ( const char* f : fences )
   {
      size_type p = response.FindLast( f );
      if ( p != String::notFound && (best == String::notFound || p > best) )
      {
         best = p;
         bestLen = ::strlen( f );
      }
   }
   if ( best == String::notFound )
      return String();
   size_type start = response.Find( '\n', best + bestLen );
   if ( start == String::notFound )
      return String();
   ++start;
   size_type stop = response.Find( "```", start );
   if ( stop == String::notFound )
      stop = response.Length();
   return response.Substring( start, stop - start ).Trimmed();
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotAgent.cpp
