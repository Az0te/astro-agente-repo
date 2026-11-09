// ----------------------------------------------------------------------------
// PiAstroPilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiAstroPilotAgent.cpp - Modelos, configuración, pasos de la guía y prompts.
// ----------------------------------------------------------------------------

#include "PiAstroPilotAgent.h"
#include "PiAstroPilotI18n.h"
#include "PiAstroPilotJson.h"

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

String PiAstroPilotUtil::ReadText( const String& path, size_type maxChars )
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

bool PiAstroPilotUtil::WriteText( const String& path, const String& text )
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

String PiAstroPilotUtil::EnvVar( const String& name )
{
   if ( name.IsEmpty() )
      return String();
   IsoString n = name.ToUTF8();
   const char* v = ::getenv( n.c_str() );
   return (v != nullptr) ? String::UTF8ToUTF16( v ) : String();
}

String PiAstroPilotUtil::NewUUID()
{
   return String( IsoString::UUID() );
}

String PiAstroPilotUtil::NewId()
{
   IsoString u = IsoString::UUID();
   u.DeleteChar( '-' );
   return String( u.Left( 10 ) );
}

String PiAstroPilotUtil::Timestamp()
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

String PiAstroPilotUtil::JoinPath( const String& a, const String& b )
{
   if ( a.IsEmpty() )
      return b;
   if ( a.EndsWith( '/' ) || a.EndsWith( '\\' ) )
      return a + b;
   return a + '/' + b;
}

void PiAstroPilotUtil::CleanTemp( const String& tempDir )
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
   // Miniaturas de las comparaciones de la guía (pxPrevia, carpeta previas_chat; 8 nov 2026).
   try
   {
      String dir = JoinPath( tempDir, "previas_chat" );
      FindFileInfo info;
      for ( File::Find f( JoinPath( dir, "*.jpg" ) ); f.NextItem( info ); )
         if ( !info.IsDirectory() )
            try { File::Remove( JoinPath( dir, info.name ) ); } catch ( ... ) {}
   }
   catch ( ... ) {}
   // La página del chat (piastropilot_chat.html) no se borra: se reescribe en cada mensaje, y borrarla mientras el
   // visor la carga dejaba "Your file couldn't be accessed" al pulsar Nueva conversación (5 nov 2026).
}

// ----------------------------------------------------------------------------
// Modelos
// ----------------------------------------------------------------------------

bool PiAstroPilotModel::IsCloud() const
{
   if ( IsAgent() )
      return true;
   String e = endpoint.Lowercase();
   return !(e.Contains( "localhost" ) || e.Contains( "127.0.0.1" ) || e.Contains( "[::1]" ) || e.Contains( "0.0.0.0" ));
}

static std::vector<PiAstroPilotModel> BuiltinModels()
{
   std::vector<PiAstroPilotModel> m( 3 );

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

const std::vector<PiAstroPilotStep>& PiAstroPilotStep::Linear()
{
   static const std::vector<PiAstroPilotStep> steps =
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

const std::vector<PiAstroPilotStep>& PiAstroPilotStep::NonLinear()
{
   static const std::vector<PiAstroPilotStep> steps =
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

String PiAstroPilotConfig::DefaultGuideDir()
{
   return PiAstroPilotUtil::JoinPath( File::HomeDirectory(), "astro-agente-repo/guia" );
}

String PiAstroPilotConfig::DefaultWorkDir()
{
   return PiAstroPilotUtil::JoinPath( File::HomeDirectory(), "PiAstroPilot" );
}

String PiAstroPilotConfig::DefaultClaudePath()
{
   String p = PiAstroPilotUtil::JoinPath( File::HomeDirectory(), ".local/bin/claude.exe" );
   if ( File::Exists( p ) )
      return p;
   return "claude";
}

String PiAstroPilotConfig::PiastropilotMcpServer() const
{
   // Servidor MCP propio (mcp/dist/piastropilot-mcp.mjs), junto a la guía en el mismo repo.
   String g = guideDir.EndsWith( '/' ) || guideDir.EndsWith( '\\' ) ? guideDir.Left( guideDir.Length()-1 ) : guideDir;
   String repo = File::ExtractDirectory( g );
   StringList cands;
   cands << PiAstroPilotUtil::JoinPath( repo, "mcp/dist/piastropilot-mcp.mjs" )
         << PiAstroPilotUtil::JoinPath( File::ExtractDrive( g ) + repo, "mcp/dist/piastropilot-mcp.mjs" )
         << PiAstroPilotUtil::JoinPath( File::HomeDirectory(), "astro-agente-repo/mcp/dist/piastropilot-mcp.mjs" );
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

String PiAstroPilotConfig::PiastropilotRunner() const
{
   // Runner del MCP piastropilot (mcp/pjsr/piastropilot-runner.js), al lado del servidor.
   String s = PiastropilotMcpServer();
   if ( s.IsEmpty() )
      return String();
   s.ReplaceString( u"/mcp/dist/piastropilot-mcp.mjs", u"/mcp/pjsr/piastropilot-runner.js" );
   return File::Exists( s ) ? s : String();
}

void PiAstroPilotConfig::WriteInternetFlag() const
{
   try
   {
      String dir = PiAstroPilotUtil::JoinPath( File::HomeDirectory(), ".piastropilot" );
      String flag = PiAstroPilotUtil::JoinPath( dir, "sin-internet" );
      if ( internet )
      {
         if ( File::Exists( flag ) )
            File::Remove( flag );
      }
      else
      {
         if ( !File::DirectoryExists( dir ) )
            File::CreateDirectory( dir, true );
         PiAstroPilotUtil::WriteText( flag, u"Búsquedas en internet desactivadas en PiAstroPilot (casilla «Internet»).\n" );
      }
   }
   catch ( ... ) {}
}

String PiAstroPilotConfig::DefaultClaudeArgs()
{
   // Herramientas permitidas sin preguntar en modo no interactivo: el MCP de
   // PixInsight y lectura/escritura de archivos (guía y carpeta de trabajo).
   return "--allowedTools mcp__piastropilot,Read,Glob,Grep,Write";
}

void PiAstroPilotConfig::Load()
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
            PiAstroPilotModel m;
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
   // Desde la build 78 el MCP antiguo (mcp__pixinsight) ya no se usa: se cambia por el nuevo (piastropilot).
   else if ( claudeArgs.Contains( "mcp__pixinsight" ) )
   {
      claudeArgs.ReplaceString( "mcp__piastropilot,mcp__pixinsight", "mcp__piastropilot" );
      claudeArgs.ReplaceString( "mcp__pixinsight", "mcp__piastropilot" );
   }
   if ( !Settings::Read( "DataDirs", dataDirs ) )
      dataDirs = String();   // la elige el usuario en Configuración (carpetas de datos)

   if ( !Settings::Read( "AutoRun", autoRun ) )
      autoRun = true;
   if ( !Settings::Read( "Internet", internet ) )
      internet = true;
   WriteInternetFlag();
   if ( !Settings::Read( "UILanguage", uiLanguage ) || uiLanguage.IsEmpty() )
      uiLanguage = "es";
   SetPiAstroPilotEnglish( uiLanguage == "en" );

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

void PiAstroPilotConfig::ResetAI()
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

int PiAstroPilotConfig::Adjustment( const String& stepKey ) const
{
   for ( const auto& a : adjustments )
      if ( a.first == stepKey )
         return a.second;
   return 0;
}

void PiAstroPilotConfig::SetAdjustment( const String& stepKey, int delta )
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

bool PiAstroPilotConfig::HasTiers( const PiAstroPilotModel& m )
{
   return m.builtin && (m.IsAgent() || m.keyEnv == "OPENAI_API_KEY");
}

String PiAstroPilotConfig::TierModel( const PiAstroPilotModel& m, const String& stepKey, String& why ) const
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

void PiAstroPilotConfig::Save() const
{
   String custom;
   for ( const PiAstroPilotModel& m : models )
      if ( !m.builtin )
         custom << m.name << '\t' << m.type << '\t' << m.endpoint << '\t' << m.model << '\t' << m.keyEnv << '\n';
   Settings::Write( "Models", custom );
   Settings::Write( "CurrentModel", currentModel );
   Settings::Write( "GuideDir", guideDir );
   Settings::Write( "WorkDir", workDir );
   Settings::Write( "ClaudePath", claudePath );
   Settings::Write( "ClaudeArgs", claudeArgs );
   Settings::Write( "UILanguage", uiLanguage );
   Settings::Write( "AutoRun", autoRun );
   Settings::Write( "Internet", internet );
   WriteInternetFlag();
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

String PiAstroPilotConfig::ScoresFile() const
{
   return PiAstroPilotUtil::JoinPath( guideDir, "porcentajes_skill.json" );
}

void PiAstroPilotConfig::LoadScores()
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

int PiAstroPilotConfig::BaseScore( const String& stepKey ) const
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

int PiAstroPilotConfig::BuiltinScore( const String& stepKey )
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

const PiAstroPilotModel& PiAstroPilotConfig::Current() const
{
   return models[Range( currentModel, 0, int( models.size() )-1 )];
}

String PiAstroPilotConfig::DossierDir() const
{
   return PiAstroPilotUtil::JoinPath( workDir, "dossiers" );
}

String PiAstroPilotConfig::TempDir() const
{
   return PiAstroPilotUtil::JoinPath( workDir, "tmp" );
}

String PiAstroPilotConfig::CurlPath() const
{
   String root = PiAstroPilotUtil::EnvVar( "SystemRoot" );
   if ( !root.IsEmpty() )
   {
      String p = PiAstroPilotUtil::JoinPath( root, "System32/curl.exe" );
      if ( File::Exists( p ) )
         return p;
   }
   return "curl";
}

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

static String ViewText( const String& viewId )
{
   return viewId.IsEmpty() ? String( u"(no hay ninguna imagen seleccionada)" ) : u"\"" + viewId + u"\"";
}

String PiAstroPilotPrompts::System()
{
   return
   u"Eres PiAstroPilot, un asistente experto en procesado de astrofotografía integrado en PixInsight "
   u"como módulo nativo. Respondes en el idioma en que te escriba el usuario en el Prompt (si escribe en inglés, "
   u"en inglés; en las tareas de los botones de paso y en la interpretación de resultados, en ese mismo idioma de la "
   u"conversación, o en español si no hay ninguno), de forma clara y concisa. Eres fiel a los "
   u"datos: no inventas parámetros ni resultados; si algo no está en la guía o no lo has medido, lo dices.";
}

static String ComparativeBlock( const PiAstroPilotModel& model, const String& dossierPath )
{
   String s =
   u"\n\nEste paso tiene varias soluciones posibles: no fijes un método, compáralos.\n"
   u"a) Haz primero un análisis breve de la imagen (tipo y forma del gradiente, si la nebulosa llena el campo, "
   u"si es banda ancha o estrecha).\n"
   u"b) Usa la función de la guía gradienteCandidatos: crea copias GC_* con cada método aplicable, las mide y "
   u"recomienda una. No apliques nada sobre la imagen original: el usuario elegirá la copia que prefiera.\n"
   u"c) Pásale tu análisis en la opción \"analisis\" y esta ruta exacta en la opción \"dossier\": " + dossierPath +
   u" (la función escribe ahí el dossier; PiAstroPilot enseña cada candidato junto a su modelo y, cuando el usuario "
   u"elige uno, cierra los demás).";
   if ( model.IsAgent() )
      s << u"\n   Llámala con la herramienta mcp__piastropilot__gradienteCandidatos; no escribas tú el bucle de comparativa.";
   return s;
}

static String RetryRule( const PiAstroPilotConfig& cfg );

String PiAstroPilotPrompts::CallsFormat()
{
   return
   u"\n\nCómo actuar sobre PixInsight: NUNCA escribas código (ni PJSR, ni JavaScript, ni PixelMath suelto). Sólo puedes "
   u"pedir funciones de la lista «Funciones de la guía». Para pedirlas, devuelve UN único bloque ```json con este formato:\n"
   u"```json\n{\"llamadas\": [{\"funcion\": \"analizarMaster\", \"parametros\": {\"vista\": \"id_real\"}}]}\n```\n"
   u"- \"funcion\" es el nombre exacto de la lista; \"parametros\" usa sólo los nombres de parámetro de esa función "
   u"(los marcados con * son obligatorios). Las opciones van dentro de \"opciones\" como un objeto.\n"
   u"- Varias llamadas en el mismo bloque sólo si no dependen unas de otras. Si una necesita lo que devuelve otra, pide "
   u"la primera, espera el resultado y pide la siguiente en otra respuesta.\n"
   u"- PiAstroPilot comprueba las llamadas contra el manifiesto de la guía, las ejecuta tal cual y te devuelve el resultado.\n"
   u"- Si ninguna función sirve para lo que se pide, dilo y propón qué hacer; no lo sustituyas por otra cosa.\n"
   u"- Usa los ids exactos de las vistas abiertas: nunca inventes ni completes un id (los ejemplos de la guía usan ids "
   u"genéricos como \"MasterLight\").";
}

String PiAstroPilotPrompts::FunctionList( const String& guideDir, bool summaries )
{
   String out;
   try
   {
      String path = guideDir + u"/herramientas/manifiesto.json";
      JsonValue root;
      String why;
      if ( !File::Exists( path ) || !JsonValue::Parse( File::ReadTextFile( path ), root, why ) )
         return u"(no encuentro " + path + u")";
      const JsonValue& list = root["funciones"];
      for ( size_t i = 0; i < list.Size(); ++i )
      {
         const JsonValue& f = list[i];
         if ( f["nombre"].type != JsonValue::Str || (f["nivel"].type == JsonValue::Str && f["nivel"].s == u"libre") )
            continue;
         const JsonValue& props = f["params"]["properties"];
         const JsonValue& req = f["params"]["required"];
         String ps;
         for ( const auto& kv : props.o )
         {
            bool r = false;
            for ( const JsonValue& q : req.a )
               if ( q.s == kv.first )
                  r = true;
            ps << (ps.IsEmpty() ? u"" : u", ") << kv.first << (r ? u"*" : u"");
         }
         String d = f["resumen"].type == JsonValue::Str ? f["resumen"].s : f["descripcion"].s;
         size_type dot = d.Find( u". " );
         if ( dot != String::notFound && dot < 220 )
            d = d.Left( dot + 1 );
         if ( d.Length() > 220 )
            d = d.Left( 219 ) + u"…";
         String paso;
         if ( f["paso"].type == JsonValue::Str )
         {
            String ps2 = f["paso"].s;
            bool nl = ps2.StartsWith( u"no-lineal/" );
            size_type sl = ps2.Find( '/' );
            if ( sl != String::notFound )
            {
               String num = ps2.Substring( sl + 1, 2 );
               if ( num.Length() == 2 && num[0] >= '0' && num[0] <= '9' && num[1] >= '0' && num[1] <= '9' )
                  paso = String().Format( " (Paso %d", (num[0] - '0')*10 + (num[1] - '0') ) + (nl ? u" no lineal)" : u" lineal)");
            }
         }
         out << u"- " << f["nombre"].s << u" {" << ps << u"}";
         if ( summaries )
            out << paso << u": " << d;
         out << u"\n";
      }
   }
   catch ( ... ) {}
   return out;
}

static String HttpContext( const PiAstroPilotConfig& cfg, const PiAstroPilotModel& model )
{
   // Sin acceso a ficheros, el modelo no puede leer el perfil: se adjunta (filtros, QE, base MARS, ajustes).
   // Sólo a modelos locales: el perfil es privado y no se manda a servicios en la nube.
   String perfil = model.IsCloud() ? String() : PiAstroPilotUtil::ReadText( PiAstroPilotUtil::JoinPath( cfg.guideDir, "perfil.md" ), 14000 );
   String s;
   if ( !perfil.IsEmpty() )
      s << u"\n\nPerfil del usuario (equipo, filtros, QE, base MARS y ajustes; úsalo para los valores que la guía "
           u"deja al perfil):\n<<<\n" << perfil << u"\n>>>";
   s << u"\n\nNo tienes acceso directo a PixInsight. Responde con:\n"
        u"1) Una explicación breve del plan, los parámetros elegidos y por qué.\n"
        u"2) Un único bloque ```json con las llamadas a las funciones de la guía. Los bloques de código de las fichas "
        u"explican qué hace cada función: no los copies; pide la función con sus parámetros."
     << PiAstroPilotPrompts::CallsFormat();
   return s;
}

// Lista corta de funciones para los pasos (el Prompt libre lleva el catálogo completo, ToolCatalog).
static String ShortCatalog( const PiAstroPilotConfig& cfg )
{
   String s = u"\n\nFunciones de la guía («nombre {parámetros}», * = obligatorio):\n" + PiAstroPilotPrompts::FunctionList( cfg.guideDir, false );
   return s;
}

// Ficha de detalle de un paso (guia/detalle/<fase>-<fichero>), si existe.
static String HelperBlock( const PiAstroPilotStep& step, const String& viewId, const String& secondViewId );

// Orden final para los modelos sin herramientas. Si el prompt acaba en el bloque de contexto, Qwen 3.8 contestaba
// la mitad de las veces con un JSON de error de API inventado (3 de 6); con esta línea al final, 6 de 6 respondían bien.
static String ClosingLine()
{
   return u"\n\nResponde ahora con el plan breve y un único bloque ```json con las llamadas "
          u"(o, si no está claro qué vista usar, sólo con tu pregunta).";
}

static String DetailFile( const PiAstroPilotConfig& cfg, const PiAstroPilotStep& step )
{
   String f = step.file;
   f.ReplaceString( "/", "-" );
   String path = PiAstroPilotUtil::JoinPath( cfg.guideDir, u"detalle/" + f );
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
        u"NO pidas llamadas: di qué vistas dudas y pregunta cuál usar.\n";
   return s;
}

static String ModelNote()
{
   return u"\nModelo: PiAstroPilot ya ha elegido el modelo de este paso con la regla N de la guía "
          u"(sección \"Modelo por paso\"); no preguntes por N.";
}

String PiAstroPilotPrompts::SecondLayer( const PiAstroPilotStep& step )
{
   if ( step.file == "no-lineal/09-recombinacion.md" || step.file == "no-lineal/01-estirado.md" )
      return u"capa de estrellas";
   return String();
}

String PiAstroPilotPrompts::DataFolder( const PiAstroPilotStep& step )
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

String PiAstroPilotPrompts::Step( const PiAstroPilotConfig& cfg, const PiAstroPilotModel& model, const PiAstroPilotStep& step,
                               const String& viewId, const String& dossierPath, bool newSession,
                               const String& secondViewId, const String& dataFolder )
{
   String guideFile = PiAstroPilotUtil::JoinPath( cfg.guideDir, step.file );
   String phase = step.linear ? u"fase lineal" : u"fase no lineal";

   String s;
   s << u"Tarea de PiAstroPilot: " << step.label << u" (" << phase << u").\n";
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
           u"No preguntes por la ruta. No listes la carpeta ni compruebes los ficheros tú: la función lo hace.\n";
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
      s << u"\n1) Lee el núcleo de la guía (" << PiAstroPilotUtil::JoinPath( cfg.guideDir, "SKILL.md" )
        << u") y perfil.md si aún no los has leído en esta sesión, y la ficha del paso (" << guideFile
        << u"). Los ficheros de detalle/ y los anexos, sólo si la ficha no basta. "
           u"Sigue su método predeterminado y sus ajustes de partida.\n"
        << u"2) Ejecuta el paso sobre la vista indicada con las herramientas MCP de PiAstroPilot (mcp__piastropilot__*): "
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
      String guide = PiAstroPilotUtil::ReadText( guideFile, 24000 );
      if ( !guide.IsEmpty() )
         s << u"\nPaso de la guía (" << step.file << u"):\n<<<\n" << guide << u"\n>>>";
      else
         s << u"\n(No se encontró el archivo de la guía " << guideFile << u".)";
      // Sin acceso a ficheros, el modelo no puede pedir el detalle: se adjunta.
      String detail = DetailFile( cfg, step );
      if ( !detail.IsEmpty() )
         s << u"\n\nDetalle del paso (porqué, medidas y recetas; úsalo si la ficha no basta):\n<<<\n"
           << PiAstroPilotUtil::ReadText( detail, 16000 ) << u"\n>>>";
      if ( step.comparative )
         s << ComparativeBlock( model, dossierPath );
      s << HelperBlock( step, viewId, secondViewId );
      s << HttpContext( cfg, model ) << ShortCatalog( cfg ) << ClosingLine();
   }
   return s;
}

// Pasos con una función ya hecha en guia/herramientas: a los modelos sin herramientas se les pide usarla. Sin la
// instrucción explícita la usaban sólo la mitad de las veces; usándola, Qwen 3.8 pasó de ~15–18/40 a ~31–33/40
// (banco de pruebas del 4 nov 2026). Formato: «funcion {parametros}», que el modelo pasa a su bloque ```json.
static String HelperBlock( const PiAstroPilotStep& step, const String& viewId, const String& secondViewId )
{
   struct Helper { const char* file; const char16_t* call; };
   static const Helper helpers[] =
   {
      { "lineal/01-analisis-del-objeto.md", u"analizarMaster {vista: \"%V\"} y, en el mismo bloque, documentarObjeto {vista: \"%V\"} (identifica el objeto por OBJECT o la astrometría y da tipo, resumen, emisión esperada, estrellas brillantes del campo y problemas que pueden dar); en el resumen junta las medidas con esa información (qué es, qué emite y si el filtro lo capta, qué estrellas darán halos o reflejos). Si las búsquedas en internet están desactivadas, sólo analizarMaster" },
      { "lineal/13-bxt-completo.md", u"bxtCandidatos {vista: \"%V\", opciones: {tipo: ...}} y, cuando veas su resultado, en otra respuesta, bxtAplicar {vista: \"%V\", opciones: {nonstellar: <recomendada.nonstellar>, stars: <recomendada.stars>, nuevaVista: ...}}" },
      { "lineal/14-noisex-suave.md", u"ruidoCandidatos {vista: \"%V\", opciones: {nuevaVista: ...}} (compara NXT 0,30/0,50/0,70, MLDenoise y MultiscaleTGVDenoise y se queda con el mejor que cumpla; enseña su tabla comparados)" },
      { "lineal/15-starx.md", u"separarEstrellas {vista: \"%V\", opciones: {nuevaVista: ..., nuevasEstrellas: ...}} y, en el mismo bloque, ruidoCandidatos {vista: <el id que has dado en nuevaVista>, opciones: {principal: true, nuevaVista: ...}} (compara NXT, MLDenoise y MultiscaleTGVDenoise; prefiere bajar el ruido 50-80 % cumpliendo los controles)" },
      { "no-lineal/05-boost.md", u"saturarAlFallo {vista: \"%V\", opciones: {tipo: \"nebulosa\" | \"galaxia\", nuevaVista: ...}} para la saturación (el LHE y las curvas, si hacen falta, después y a mano). "
        u"En galaxias, ANTES y en su propia respuesta, nucleoCandidatos {vista: \"%V\", opciones: {nuevaVista: ...}} (compara HDRMT y GradientHDRCompression) si el estirado dio meseta_nucleo.radio_px > 3; "
        u"el contraste local, también en su propia respuesta, con contrasteCandidatos {vista: \"%V\", opciones: {nuevaVista: ...}} (LHE, HDRMT y DarkStructureEnhance; puede recomendar no tocarla), "
        u"y la saturación sobre su resultado" },
      { "no-lineal/10-recorte-exportacion.md", u"exportarFinal {vista: \"%V\", opciones: {carpeta: ..., nombre: ..., girar180: ...}}" },
      { "no-lineal/06-noisex.md", u"ruidoCandidatos {vista: \"%V\", opciones: {nuevaVista: ...}} (sobre la imagen estirada compara NXT 0,15/0,30/0,45, MLDenoise y MultiscaleTGVDenoise)" },
      { "lineal/08-plate-solve.md", u"resolverAstrometria {vista: \"%V\"}" },
      { "lineal/07-extraccion-canales.md", u"desmezclarDualBand {vista: \"%V\"}" },
      { "lineal/16-linearfit-continuo.md", u"medirContinuo {nb: <banda estrecha CON estrellas>, continuo: <RGB calibrada CON estrellas>, opciones: {canal: 0}} y, con el k que devuelva, en otra respuesta, restarContinuo {nb: \"%V\", continuo: <RGB sin estrellas>, opciones: {k: ..., nuevaVista: ...}}" },
      { "no-lineal/04-mascaras.md", u"crearMascara {vista: \"%V\", opciones: {tipo: \"luminancia\" | \"cielo\" | \"fondo_lhe\"}}" },
      { "no-lineal/02-lrgb-paleta.md", u"previsualizarPaletas {ha: \"%V\", oiii: <OIII estirado igual>, opciones: {carpeta: ...}} para las previews; la composición final con componerPaleta {capas: {S, H, O}, opciones: {paleta: \"SHO\" | \"HOO\" | \"FORAXX\" ..., estrellas}} y la paleta que elija el usuario (paletasDisponibles {} da la lista)" },
      { "lineal/11-bxt-correct-only.md", u"bxtCorrectOnly {vista: \"%V\", opciones: {nuevaVista: ...}}" },
      { "lineal/17-checkpoint.md", u"checkpointLineal {vista: \"%V\", opciones: {carpeta: ..., objeto: ..., version: ...}}" },
      { "no-lineal/03-scnr.md", u"quitarVerde {vista: \"%V\", opciones: {nuevaVista: ...}}" },
      { "lineal/12-spcc.md", u"calibrarColor {vista: \"%V\", opciones: {nuevaVista: ..., spcc: {...filtros y QE del perfil...}}}" },
      { "no-lineal/01-estirado.md", u"estirarCapas {starless: \"%V\", estrellas: \"%S\", opciones: {cielo: 0.10, nuevaStarless: ..., nuevasEstrellas: ...}} (si el objeto es una galaxia, "
        u"OBLIGATORIO opciones {tipo: \"galaxia\", nuevaStarless: ..., nuevasEstrellas: ...} sin cielo: cielo 0,07 y estrellas con el mismo estirado; "
        u"si es una nebulosa oscura de polvo, {tipo: \"nebulosa_oscura\", ...} sin cielo). En nebulosas de emisión o reflexión, mejor "
        u"estirarCandidatos {vista: \"%V\", opciones: {cielo: 0.10, nuevaVista: ...}} (compara GHS al fallo, MAS y ArcsinhStretch con el mismo cielo) y, en el mismo "
        u"bloque, estirarEstrellas {vista: \"%S\", opciones: {nuevaVista: ...}}" },
      { "no-lineal/08-estrellas.md", u"prepararEstrellas {vista: \"%V\", opciones: {nuevaVista: ...}}" },
      { "no-lineal/09-recombinacion.md", u"recombinarEstrellas {starless: \"%V\", estrellas: \"%S\", opciones: {nuevaVista: ...}}" },
      { "lineal/10-combinacion-rgb-nb.md", u"combinarMasters {masters: <carpeta o lista de masters alineados>, opciones: {tipo: \"nebulosa\" | \"galaxia\"}} (no usa ninguna vista: "
        u"clasifica cada master por su filtro y combina lo que toca). Antes mira «Cuándo aplica» en la ficha: si sólo hay una imagen RGB "
        u"(OSC sin filtro) o sólo dual band, di que el paso no aplica y no pidas llamadas" },
      { "lineal/09-correccion-gradiente.md", u"gradienteCandidatos {vista: \"%V\", opciones: {spfc: {...filtros y QE del perfil...}, "
        u"analisis: \"<tu análisis breve>\", dossier: \"<la ruta del dossier indicada arriba>\"}} — por defecto compara GraXpert (10, 8 e IA), "
        u"GradientCorrection, MGC (1024, 2048, con y sin bordes; base MARS de PixInsight; sólo con astrometría) y polinomio robusto (grado 1 y 2), los mide, recomienda y escribe el dossier. "
        u"No hay método preferido: recomienda el que mida mejor en ESTA imagen (lee la «leyenda» del resultado)" },
      { "lineal/06-hdr-composition.md", u"componerHDR {masters: <carpeta o lista [larga, corta] de masters alineados>, opciones: {nuevaVista: \"HDR\"}} (no usa ninguna vista; la HDR sale como vista nueva)" },
      { "lineal/05-staralignment-crop.md", u"alinearMasters {masters: <carpeta, lista de masters .xisf o lista de ids de las vistas abiertas>, opciones: {referencia: <el master de mejor resolución y SNR: L o Hα; si no lo sabes, no la pongas>}} (sin salida, salvo que el usuario dé la carpeta: la función crea 'alineados' junto a los masters)" },
      { "lineal/02-inventario.md", u"inventario {carpeta: <carpeta del objeto>, opciones: {darks: <carpeta o lista de master darks de la biblioteca, si el perfil la da>}} (no usa ninguna vista)" },
      { "lineal/03-blink-subframeselector.md", u"seleccionarSubs {subs: <carpeta de LIGHT o lista de ficheros>, opciones: {csv: ...}} (no usa ninguna vista)" },
      { "lineal/04-preprocesado.md", u"revisarCalibracion {calibracion: {lights: ..., flats: ..., flatDarks: ..., darks: ...}} (no usa ninguna vista). "
        u"En esta respuesta SÓLO revisarCalibracion: nunca lances WBPP en el mismo bloque. "
        u"Cuando el usuario haya visto la revisión y te pida seguir, en otra respuesta lanzarWBPP {wbpp: {lights: ..., flats: ..., flatDarks: ..., darks: ..., salida: <ruta corta>}} "
        u"y después estadoWBPP {salida: <salida>} hasta que devuelva terminado: true" },
   };
   for ( const Helper& h : helpers )
      if ( step.file == h.file )
      {
         // %V = la vista seleccionada, que es siempre la entrada principal (sin esto Qwen llegó a usar otra vista
         // abierta como starless y la seleccionada como nombre de salida).
         String call( h.call );
         // Estirado sin capa de estrellas (sólo hay una vista de ese tamaño): sólo la starless.
         if ( step.file == "no-lineal/01-estirado.md" && secondViewId.IsEmpty() )
            call = u"estirarCandidatos {vista: \"%V\", opciones: {cielo: 0.10, nuevaVista: ...}} (no hay capa de estrellas: sólo la starless; compara GHS al fallo, MAS y ArcsinhStretch y enseña la tabla)";
         call.ReplaceString( u"%V", viewId.IsEmpty() ? String( u"<vista seleccionada>" ) : viewId );
         call.ReplaceString( u"%S", secondViewId.IsEmpty() ? String( u"<capa de estrellas preparada>" ) : secondViewId );
         return u"\n\nUsa la función de la guía " + call + u". Pídela en tu bloque ```json: en cada «funcion {…}», el "
                u"nombre va en \"funcion\" y lo de dentro de las llaves en \"parametros\" (los «...» y «<…>» los decides tú). "
                u"PiAstroPilot te devolverá el resultado para que lo interpretes según la ficha. La entrada principal es la "
                u"vista seleccionada; la vista nueva tiene que tener un nombre nuevo, nunca el de una que ya existe.";
      }
   return String();
}

static String RetryRule( const PiAstroPilotConfig& cfg )
{
   if ( cfg.maxRetries <= 0 )
      return String();
   return u"\n\nLímite de intentos: si una misma operación falla o no mejora el resultado " +
          String().Format( "%d", cfg.maxRetries ) +
          u" veces seguidas (mismo error, o la métrica que buscas no mejora), PARA: no sigas probando variantes. "
          u"Explica qué intentaste, qué falló y qué propones, y deja la imagen como estaba.";
}

String PiAstroPilotPrompts::Full( const PiAstroPilotConfig& cfg, const PiAstroPilotModel& model,
                               const String& viewId, const String& dossierPath )
{
   String s;
   s << u"Tarea de PiAstroPilot: RESOLUCIÓN COMPLETA.\n"
     << u"Imagen objetivo en PixInsight: vista " << ViewText( viewId ) << u".\n\n"
     << u"Procesa la imagen de principio a fin siguiendo la guía (" << PiAstroPilotUtil::JoinPath( cfg.guideDir, "SKILL.md" )
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
      s << u"\n\nHazlo en varias respuestas: UN PASO POR RESPUESTA (como mucho dos muy ligados). Ahora pide sólo las "
           u"llamadas del primero; cuando veas su resultado, las del siguiente, con los ids de las vistas que devolvió.";
   if ( !model.IsAgent() )
      s << HttpContext( cfg, model ) << ShortCatalog( cfg ) << ClosingLine();
   return s;
}

// Catálogo de las funciones de guia/herramientas para la ventana de Prompt de los modelos sin herramientas. Sin él,
// a Qwen 3.8 se le pidió "de SPCC a la separación de estrellas" y se inventó StarReduction / StarSplitting y dijo que
// SPCC no existía (prueba del 5 nov 2026): el Prompt libre no llevaba nada de la guía.
static String ToolCatalog( const PiAstroPilotConfig& cfg )
{
   return
      u"\n\nFunciones de la guía («nombre {parámetros}», * = obligatorio). Cada una trabaja sobre una copia, mide y "
      u"devuelve un objeto (vista nueva, medidas, no_cumple, control). Son lo único que puedes pedir:\n" +
      PiAstroPilotPrompts::FunctionList( cfg.guideDir ) +
      u"\nNotas de uso:\n"
      u"- Las de preproceso (inventario, seleccionarSubs, revisarCalibracion, lanzarWBPP, estadoWBPP) trabajan con ficheros: "
      u"aceptan una carpeta o una lista de carpetas o ficheros y ellas buscan los ficheros. lanzarWBPP sólo cuando el usuario lo pida.\n"
      u"- alinearMasters: no le pases salida ni inventes rutas (crea 'alineados' junto a los masters y abre los _alin); devuelve "
      u"vistas (ids _alin) y vista (la referencia) y YA resuelve la astrometría y la copia a todas: no pidas después "
      u"resolverAstrometria. Con varios masters: ALINEAR PRIMERO y astrometría después (resolver antes no sirve: la solución no "
      u"pasa a los alineados); si el usuario pide astrometría antes de alinear, sugiérele este orden y por qué. Pásale sólo los "
      u"masters del mismo objeto: si hay vistas de otro objeto, repetidas o que no son masters (copias _bxt, _spcc, starless…) "
      u"y no está claro cuáles van, pregunta antes.\n"
      u"- gradienteCandidatos NO corrige la vista: compara copias GC_* y devuelve recomendado (id de la copia recomendada). "
      u"Los pasos siguientes van sobre recomendado, nunca sobre la original SIN corregir.\n"
      u"- calibrarColor: OSC sin filtro, spcc vacío. neutralizarCielo (sobre una vista LINEAL) si calibrarColor, checkpointLineal "
      u"o el estirado dan el cielo no neutro: neutraliza el fondo en lineal y se vuelve a estirar. Nunca SCNR ni curvas para eso.\n"
      u"- bxtCandidatos y después, con su recomendada, bxtAplicar (Paso 13).\n"
      u"- reducirRuido: denoise 0,50 en el Paso 14, sobre la starless RGB del 15 0,50 tras el NXT suave del 14 (0,70 sólo sin "
      u"él; si moteado_color_despues > 1,5, menos) y 0,30 en el Paso 6 no lineal.\n"
      u"- estirarCapas: en GALAXIAS SIEMPRE opciones {tipo: \"galaxia\", nuevaStarless, nuevasEstrellas} sin cielo (cielo 0,07 y "
      u"estrellas con el mismo estirado que la starless); en NEBULOSAS OSCURAS (polvo, sin emisión) {tipo: \"nebulosa_oscura\", …} "
      u"sin cielo; estrellas \"extraer\" SÓLO en galaxias (en nebulosas hincha las estrellas); NO pases amount. Devuelve "
      u"starless.vista y estrellas.vista. Si NO sabes qué tipo de objeto es (sin OBJECT y con un nombre de fichero genérico), "
      u"antes del Paso 1 no lineal PARA y PREGUNTA el tipo (galaxia, nebulosa oscura, de emisión, de reflexión, planetaria, "
      u"cúmulo…); no estires con los valores por defecto.\n"
      u"- comprimirNucleo: Paso 5 no lineal en GALAXIAS, antes de saturar (obligatorio si estirarCapas dio meseta_nucleo.radio_px > 3); "
      u"medirMeseta sólo mide.\n"
      u"UN PASO POR RESPUESTA (como mucho dos muy ligados): aunque te pidan el procesado completo, pide las llamadas del "
      u"primer paso, y al ver su resultado las del siguiente. Así, si un paso falla, no se repiten los anteriores (cada uno "
      u"tarda minutos). Usa los ids de las vistas que devolvió el paso anterior, tal cual. no_cumple es una lista (vacía si "
      u"todo cumple): si no está vacía, NO pases al paso siguiente: haz lo que dice el mensaje (repetir ese paso o volver al "
      u"que indica, p. ej. neutralizarCielo si el checkpoint da el cielo no neutro, o repetir estirarCapas sin amount —en "
      u"galaxias con tipo \"galaxia\"— si las estrellas casi no aportan). "
      u"El nombre del objeto y la carpeta de trabajo salen de la cabecera (OBJECT), de la ruta del master o de lo que diga el usuario; "
      u"si no los sabes, pregúntalos: NUNCA uses nombres que aparezcan en la guía ni los deduzcas de las coordenadas. "
      u"El continuo (16) sólo aplica si hay un master de banda estrecha (Hα, OIII) y otro de banda ancha: con un solo master RGB/OSC, sáltalo. "
      u"Los únicos umbrales son los de las funciones: no inventes otros. SCNR y más NoiseX no quitan manchas de color grandes en no lineal. "
      u"Orden lineal (respétalo: el gradiente SIEMPRE antes de SPCC): análisis (1) → alinear masters (5, si hay varios) → HDR (6) → "
      u"desmezcla dual band (7) → astrometría (8) → gradiente (9: gradienteCandidatos, y se sigue con recomendado) → "
      u"combinación RGB/NB (10) → BlurX correct only (11, ya hecho si el master viene del flujo) → SPCC (12) → BlurX completo (13) → "
      u"NoiseX suave (14) → StarX + denoise de la starless (15) → continuo (16) → checkpointLineal (17). Orden no lineal: "
      u"estirarCapas (1) → paleta (2) → SCNR (3) → máscaras (4, sólo si se van a usar) → en galaxias comprimirNucleo (5) → saturarAlFallo (5) → "
      u"NoiseX (6) → prepararEstrellas (8) → recombinarEstrellas (9) → exportarFinal (10). Si te piden desde un paso, empieza en ese paso.\n"
      u"Si lo que te piden lo hace una de estas funciones (p. ej. «analiza la corrección de gradiente» → gradienteCandidatos, "
      u"que compara GraXpert, MGC y polinomio y mide cuánto se come cada uno el objeto), USA LA FUNCIÓN. Si ninguna lo hace, dilo "
      u"y propón qué puede hacer el usuario. Si no hay imagen seleccionada, pide al usuario que la seleccione o que te diga su id. "
      u"Si te piden analizar varias imágenes, pide una llamada por vista en el mismo bloque.\n"
      u"ANTES DE NADA, con varios masters (filtros, noches o cámaras distintas): si no están alineados y recortados "
      u"(sus ids no acaban en _alin, o analizarMaster da bordes_sin_datos.hay), el primer paso es el 5, alinearMasters con "
      u"sus ficheros, y el resto se hace sobre los _alin. Nunca gradiente, BXT, SPCC ni desmezcla antes. Con un solo master y "
      u"bordes_sin_datos.hay, el recorte (bordes_sin_datos.recorte) lo hace el usuario con Crop: díselo. SPCC con filtros de banda "
      u"ancha NO va sobre los masters dual band: rompe la desmezcla.\n"
      u"No hay un método de gradiente preferido: se comparan con gradienteCandidatos y se aplica el que mejor mida. "
      u"Masters de cámara color con filtro dual band (HaO3, S2O3, SHb…): Paso 7 desmezclarDualBand sobre CADA master dual band "
      u"(detecta el filtro; devuelve lineas, p. ej. { SII: \"SII_raw_S2O3\", OIII: \"OIII_raw_S2O3\" }); después el gradiente "
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
String PiAstroPilotPrompts::Free( const PiAstroPilotConfig& cfg, const PiAstroPilotModel& model, const String& text, const String& viewId, bool firstTurn )
{
   if ( !firstTurn )
   {
      // Las vistas cambian entre mensajes: se repite siempre la lista actual (es corta).
      if ( model.IsAgent() )
         return text;
      return u"[Vista activa: " + ViewText( viewId ) + u"." + AllViewsLine() +
             u" Para medir o procesar, pide funciones de la guía en un bloque ```json (nunca código).]\n\n" + text;
   }
   String s;
   s << u"[Contexto de PiAstroPilot: imagen activa en PixInsight: vista " << ViewText( viewId ) << u"." << AllViewsLine();
   if ( model.IsAgent() )
      s << u" Puedes actuar sobre ella con las herramientas MCP de PiAstroPilot (mcp__piastropilot__*) si te lo pido.";
   else
      s << u" Si hay que medir o procesar, pide funciones de la guía en un único bloque ```json; nunca escribas código.";
   s << u"]";
   if ( !model.IsAgent() )
      s << ToolCatalog( cfg ) << HttpContext( cfg, model );
   s << u"\n\n" << text;
   return s;
}

String PiAstroPilotPrompts::ExtractCalls( const String& response )
{
   // El último bloque ```json (o ``` sin lenguaje) que sea un objeto con "llamadas". Un ```javascript no vale: el
   // modelo no puede proponer código.
   String found;
   size_type from = 0;
   for ( ;; )
   {
      size_type p = response.Find( "```", from );
      if ( p == String::notFound )
         break;
      size_type nl = response.Find( '\n', p + 3 );
      if ( nl == String::notFound )
         break;
      String lang = response.Substring( p + 3, nl - p - 3 ).Trimmed().CaseFolded();
      size_type stop = response.Find( "```", nl + 1 );
      if ( stop == String::notFound )
         stop = response.Length();
      if ( lang.IsEmpty() || lang == u"json" )
      {
         String body = response.Substring( nl + 1, stop - nl - 1 ).Trimmed();
         if ( body.StartsWith( '{' ) && body.Contains( u"\"llamadas\"" ) )
            found = body;
      }
      from = stop + 3;
      if ( from >= response.Length() )
         break;
   }
   return found;
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiAstroPilotAgent.cpp
