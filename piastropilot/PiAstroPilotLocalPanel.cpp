// ----------------------------------------------------------------------------
// PiAstroPilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiAstroPilotLocalPanel.cpp - Panel de IA local bajo el chat (build 117).
// ----------------------------------------------------------------------------

#include "PiAstroPilotLocalPanel.h"
#include "PiAstroPilotI18n.h"

#include <pcl/Brush.h>
#include <pcl/File.h>
#include <pcl/FileInfo.h>
#include <pcl/Graphics.h>
#include <pcl/Math.h>

#include <chrono>
#include <cmath>

namespace pcl
{

// ----------------------------------------------------------------------------

static double Ahora()
{
   return std::chrono::duration<double>( std::chrono::steady_clock::now().time_since_epoch() ).count();
}

static String T( const char16_t* es, const char16_t* en )
{
   return PiAstroPilotEnglish() ? String( en ) : String( es );
}

// Número con coma decimal en español.
static String Num( double x, int decimales = 0 )
{
   String s = String().Format( "%.*f", decimales, x );
   if ( !PiAstroPilotEnglish() )
      s.ReplaceChar( '.', ',' );
   return s;
}

static String Miles( double x )
{
   String s = String().Format( "%.0f", x ), r;
   int n = 0;
   for ( int i = int( s.Length() ) - 1; i >= 0; --i )
   {
      r.Prepend( s[i] );
      if ( ++n % 3 == 0 && i > 0 && s[i-1] != '-' )
         r.Prepend( PiAstroPilotEnglish() ? ',' : '.' );
   }
   return r;
}

static String Gb( double bytes )
{
   return Num( bytes/1073741824.0, 1 ) + " GB";
}

static String Esc( const String& s )
{
   String r = s;
   r.ReplaceString( u"&", u"&amp;" );
   r.ReplaceString( u"<", u"&lt;" );
   r.ReplaceString( u">", u"&gt;" );
   return r;
}

static bool ParseText( const String& text, JsonValue& out )
{
   if ( text.IsEmpty() )
      return false;
   String why;
   return JsonValue::Parse( text.ToUTF8(), out, why );
}

// Base de un endpoint ".../v1/chat/completions" → "http://host:puerto".
static String BaseUrl( const String& endpoint )
{
   size_type p = endpoint.Find( u"/v1/" );
   String b = (p != String::notFound) ? endpoint.Left( p ) : endpoint;
   while ( b.EndsWith( '/' ) )
      b.DeleteRight( b.Length()-1 );
   // «localhost» puede resolverse primero a ::1 y Ollama sólo escucha en 127.0.0.1: cada lectura esperaba 2 s.
   b.ReplaceString( u"//localhost", u"//127.0.0.1" );
   return b;
}

// Lecturas: HTTP (2 s de plazo) y contadores de la GPU (motor más cargado de la gráfica con más memoria usada; con
// Ollama y llama-server en la RX 7900 sale en «compute 0»). Una línea JSON con los textos tal cual.
static const char* const ScriptLecturas = R"PS(param([string]$ps, [string]$rd)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Leer($u) { if (-not $u) { return $null }; try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $u; if ($r.StatusCode -eq 200) { return [string]$r.Content } } catch {}; return $null }
$o = @{ ps = (Leer $ps) }
if ($rd -and $rd -ne 'ninguno') { $o.props = (Leer "$rd/props"); $o.slots = (Leer "$rd/slots") }
$s = (Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage','\GPU Adapter Memory(*)\Dedicated Usage').CounterSamples
$mem = @{}; $eng = @{}
foreach ($c in $s) {
  $p = $c.Path
  if ($p -match 'adapter memory\((luid_[^)]*?)_phys') { $mem[$matches[1]] = [double]$c.CookedValue }
  elseif ($p -match '(luid_\w+?_\w+?)_phys.*engtype_([^)]+)\)') { $k = $matches[1] + '|' + $matches[2]; $eng[$k] = [double]$eng[$k] + $c.CookedValue }
}
if ($mem.Count) {
  $luid = ($mem.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
  $uso = 0.0; $tipo = ''
  foreach ($e in $eng.GetEnumerator()) { $l, $t = $e.Key -split '\|'; if ($l -eq $luid -and $e.Value -gt $uso) { $uso = $e.Value; $tipo = $t } }
  $tot = 0.0
  Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' | ForEach-Object { $q = $_.'HardwareInformation.qwMemorySize'; if ($q -and [double]$q -gt $tot) { $tot = [double]$q } }
  $o.gpu = @{ gpu = [math]::Round([math]::Min(100.0, $uso), 1); motor = $tipo; vram = [double]$mem[$luid]; total = $tot }
}
'@@' + ($o | ConvertTo-Json -Compress -Depth 3)
)PS";

static const uint32 Verde = 0xff4caf50, Ambar = 0xffe0a030, Rojo = 0xffe0453a;

// ----------------------------------------------------------------------------

PiAstroPilotLocalPanel::PiAstroPilotLocalPanel()
{
   SetTitle( T( u"IA local", u"Local AI" ) );

   Model_Label.EnableRichText();
   Model_Label.EnableWordWrapping();
   Model_Label.SetTextAlignment( TextAlign::Left|TextAlign::VertCenter );
   Gpu_Label.EnableRichText();
   Gpu_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Gpu_Label.SetScaledMinWidth( 110 );
   Top_Sizer.SetSpacing( 8 );
   Top_Sizer.Add( Model_Label, 100 );
   Top_Sizer.Add( Gpu_Label );

   for ( Control* c : { &Mem_Bar, &Ctx_Bar } )
   {
      c->SetScaledFixedHeight( 10 );
      c->SetScaledMinWidth( 140 );
      c->OnPaint( (Control::paint_event_handler)&PiAstroPilotLocalPanel::e_Paint, *this );
   }
   for ( Label* l : { &MemTitle_Label, &CtxTitle_Label } )
   {
      l->SetScaledMinWidth( 70 );
      l->SetTextAlignment( TextAlign::Left|TextAlign::VertCenter );
   }
   for ( Label* l : { &Mem_Label, &Ctx_Label } )
   {
      l->SetScaledMinWidth( 300 );
      l->SetTextAlignment( TextAlign::Left|TextAlign::VertCenter );
   }
   Mem_Sizer.SetSpacing( 8 );
   Mem_Sizer.Add( MemTitle_Label );
   Mem_Sizer.Add( Mem_Bar, 100 );
   Mem_Sizer.Add( Mem_Label );
   Ctx_Sizer.SetSpacing( 8 );
   Ctx_Sizer.Add( CtxTitle_Label );
   Ctx_Sizer.Add( Ctx_Bar, 100 );
   Ctx_Sizer.Add( Ctx_Label );

   Load_Label.EnableRichText();
   Unload_Button.OnClick( (Button::click_event_handler)&PiAstroPilotLocalPanel::e_Click, *this );
   Unload_Button.Hide();
   Load_Sizer.SetSpacing( 8 );
   Load_Sizer.Add( Load_Label, 100 );
   Load_Sizer.Add( Unload_Button );

   Global_Sizer.SetMargin( 6 );
   Global_Sizer.SetSpacing( 4 );
   Global_Sizer.Add( Top_Sizer );
   Global_Sizer.Add( Mem_Sizer );
   Global_Sizer.Add( Ctx_Sizer );
   Global_Sizer.Add( Load_Sizer );
   SetSizer( Global_Sizer );
   Hide();
}

PiAstroPilotLocalPanel::~PiAstroPilotLocalPanel()
{
   Stop();
}

void PiAstroPilotLocalPanel::Stop()
{
   for ( std::unique_ptr<ExternalProcess>* p : { &m_proc, &m_unload } )
      if ( *p )
         try { if ( (*p)->IsRunning() ) (*p)->Kill(); } catch ( ... ) {}
   m_running = false;
}

// ----------------------------------------------------------------------------

void PiAstroPilotLocalPanel::NoteUsage( int promptTokens, int completionTokens, double tokensPerSecond, int contextTokens )
{
   m_lastIn = promptTokens;
   m_lastOut = completionTokens;
   m_lastTps = (tokensPerSecond > 0 && std::isfinite( tokensPerSecond )) ? tokensPerSecond : 0;
   m_lastCtx = contextTokens;
   m_lastKey = m_model.endpoint + u"|" + m_model.model;
   try { if ( IsVisible() ) Refresh(); } catch ( ... ) {}
}

void PiAstroPilotLocalPanel::Tick( const PiAstroPilotModel& model, bool busy, const String& tempDir, bool visible )
{
   bool local = visible && model.type == "openai" && !model.IsCloud() && PiAstroPilotUtil::EnvVar( "ASTROPILOT_PANEL" ) != "0";
   if ( !local )
   {
      if ( IsVisible() )
         Hide();
      return;
   }
   m_model = model;
   m_busy = busy;
   m_rdna = model.endpoint.Contains( u":1234/" ) || model.name.StartsWith( u"RDNA-FAST" );
   m_rdnaBase = m_rdna ? BaseUrl( model.endpoint ) : String();
   m_ollamaBase = m_rdna ? String( u"http://127.0.0.1:11434" ) : BaseUrl( model.endpoint );
   if ( !IsVisible() )
      Show();

   // El PowerShell anterior: si tarda demasiado se mata; si no, el siguiente se lanza ~3 s después de terminar.
   if ( m_running && Ahora() - m_startedAt > 15 )
   {
      try { m_proc->Kill(); } catch ( ... ) {}
      m_running = false;
      ++m_failures;
   }
   if ( !m_running && m_failures < 3 && Ahora() >= m_nextAt )
      StartRead( tempDir );
   try { Refresh(); } catch ( ... ) { Load_Label.SetText( u"—" ); }
}

void PiAstroPilotLocalPanel::StartRead( const String& tempDir )
{
   String script = tempDir + u"/panel_local.ps1";
   try
   {
      if ( !m_scriptWritten || !File::Exists( script ) )
      {
         if ( !File::DirectoryExists( tempDir ) )
            File::CreateDirectory( tempDir, true );
         File::WriteTextFile( script, IsoString( ScriptLecturas ) );
         m_scriptWritten = true;
      }
      m_oldProc = std::move( m_proc );   // no se destruye aquí: podríamos estar dentro de un evento suyo
      m_proc.reset( new ExternalProcess );
      m_proc->OnStandardOutputDataAvailable( (ExternalProcess::process_event_handler)&PiAstroPilotLocalPanel::e_Stdout, *this );
      m_proc->OnFinished( (ExternalProcess::process_exit_event_handler)&PiAstroPilotLocalPanel::e_Finished, *this );
      m_proc->OnError( (ExternalProcess::process_error_event_handler)&PiAstroPilotLocalPanel::e_Error, *this );
      m_out.Clear();
      m_dataKey = m_ollamaBase + u"|" + m_rdnaBase;
      StringList args;
      args << "-NoProfile" << "-ExecutionPolicy" << "Bypass" << "-WindowStyle" << "Hidden" << "-File" << script
           << (m_ollamaBase + u"/api/ps") << (m_rdnaBase.IsEmpty() ? String( u"ninguno" ) : m_rdnaBase);
      m_running = true;
      m_startedAt = Ahora();
      m_proc->Start( "powershell.exe", args );
   }
   catch ( ... )
   {
      m_running = false;
      m_nextAt = Ahora() + 10;
      ++m_failures;
   }
}

void PiAstroPilotLocalPanel::e_Stdout( ExternalProcess& sender )
{
   m_out.Append( sender.StandardOutput() );
}

void PiAstroPilotLocalPanel::e_Finished( ExternalProcess& sender, int, bool )
{
   m_running = false;
   m_nextAt = Ahora() + 3;
   try
   {
      m_out.Append( sender.StandardOutput() );
      IsoString text( reinterpret_cast<const char*>( m_out.Begin() ), reinterpret_cast<const char*>( m_out.End() ) );
      size_type p = text.Find( "@@" );
      JsonValue d;
      String why;
      if ( p != IsoString::notFound && JsonValue::Parse( text.Substring( p+2 ).Trimmed(), d, why ) && d.type == JsonValue::Object )
      {
         m_data = d;
         m_dataAt = Ahora();
         m_failures = 0;
      }
      else
         ++m_failures;
   }
   catch ( ... )
   {
      ++m_failures;
   }
}

void PiAstroPilotLocalPanel::e_Error( ExternalProcess&, ExternalProcess::error_code )
{
   m_running = false;
   m_nextAt = Ahora() + 10;
   ++m_failures;
}

// ----------------------------------------------------------------------------

void PiAstroPilotLocalPanel::Refresh()
{
   const String rojo = u"#e0453a", ambar = u"#d99a20", verde = u"#3fa34d";
   bool fresco = m_dataAt > 0 && Ahora() - m_dataAt < 30 && m_dataKey == m_ollamaBase + u"|" + m_rdnaBase;
   const JsonValue nulo;
   const JsonValue& D = fresco ? m_data : nulo;
   JsonValue ps, props, slots;
   bool hayPs = ParseText( D["ps"].s, ps );
   const JsonValue& G = D["gpu"];
   bool hayGpu = G.type == JsonValue::Object && G["vram"].n > 0;

   StringList avisos;   // "color|texto"
   StringList partes;
   String nombre, estado;
   double ctx = 0, enVram = 0;
   int pct = -1;
   m_loaded.Clear();
   const JsonValue& modelos = ps["models"];
   for ( size_t i = 0; i < modelos.Size(); ++i )
   {
      String n = modelos[i]["name"].s.IsEmpty() ? modelos[i]["model"].s : modelos[i]["name"].s;
      m_loaded << n;
      enVram += modelos[i]["size_vram"].n;
   }
   String cargados = String().ToSeparated( m_loaded, String( u", " ) );

   if ( !m_rdna )
   {
      SetTitle( T( u"IA local · Ollama", u"Local AI · Ollama" ) );
      const String& quiero = m_model.model;
      const JsonValue* m = nullptr;
      for ( size_t i = 0; i < modelos.Size() && m == nullptr; ++i )
      {
         String n = modelos[i]["name"].s;
         if ( n == quiero || n == quiero + u":latest" || (n.Find( ':' ) != String::notFound && n.Left( n.Find( ':' ) ) == quiero) )
            m = &modelos[i];
      }
      if ( !fresco )
         nombre = Esc( quiero );
      else if ( !hayPs )
      {
         nombre = Esc( quiero );
         avisos << rojo + u"|" + T( u"Ollama no responde en ", u"Ollama does not answer at " ) + m_ollamaBase;
      }
      else if ( m == nullptr && modelos.Size() > 0 )
      {
         m = &modelos[size_t( 0 )];
         avisos << ambar + u"|" + T( u"El cargado no es el elegido (", u"The loaded model is not the chosen one (" ) + Esc( quiero ) + u")";
      }
      if ( m != nullptr )
      {
         nombre = Esc( (*m)["name"].s );
         const JsonValue& det = (*m)["details"];
         if ( !det["quantization_level"].s.IsEmpty() )
            partes << Esc( det["quantization_level"].s );
         if ( !det["parameter_size"].s.IsEmpty() )
            partes << Esc( det["parameter_size"].s );
         ctx = (*m)["context_length"].n;
         double size = (*m)["size"].n;
         if ( size > 0 )
         {
            partes << Gb( size );
            pct = int( 100*(*m)["size_vram"].n/size + 0.5 );
         }
         if ( pct >= 0 && pct < 100 )
            avisos << rojo + u"|" + Num( 100 - pct ) + T( u" % del modelo va en la CPU: será lento", u" % of the model runs on the CPU: it will be slow" );
         estado = m_busy ? T( u"generando", u"generating" ) : T( u"en reposo", u"idle" );
      }
      else if ( fresco && hayPs )
         estado = m_busy ? T( u"cargando el modelo…", u"loading the model…" ) : T( u"sin modelo cargado (se carga al enviar)", u"no model loaded (loads on send)" );
      if ( modelos.Size() >= 2 )
         avisos << rojo + u"|" + T( u"Hay ", u"There are " ) + String( int( modelos.Size() ) ) + T( u" modelos cargados (", u" models loaded (" ) +
                   Esc( cargados ) + T( u"): no caben juntos; descarga uno", u"): they do not fit together; unload one" );
   }
   else
   {
      SetTitle( u"RDNA-FAST (llama-server)" );
      bool hayProps = ParseText( D["props"].s, props );
      ParseText( D["slots"].s, slots );
      String ruta = props["model_path"].s;
      String base = File::ExtractNameAndExtension( ruta );
      nombre = Esc( !m_model.model.IsEmpty() ? m_model.model : !base.IsEmpty() ? File::ExtractName( ruta ) : String( u"llama-server" ) );
      // Cuantización en el nombre del fichero (…-UD-IQ4_XS.gguf, …-Q4_K_M.gguf).
      StringList trozos;
      File::ExtractName( ruta ).Break( trozos, '-' );
      for ( const String& t : trozos )
      {
         String u = t.Uppercase();
         if ( (u.StartsWith( 'Q' ) || u.StartsWith( u"IQ" )) && u.Length() >= 2 && (u.Contains( '_' ) || u.Length() <= 3) &&
              ((u[0] == 'Q' && u.Length() > 1 && u[1] >= '0' && u[1] <= '9') || (u[0] == 'I' && u.Length() > 2 && u[2] >= '0' && u[2] <= '9')) )
            partes << Esc( u );
         else if ( u == u"BF16" || u == u"F16" || u == u"F32" )
            partes << u;
      }
      try { if ( !ruta.IsEmpty() && File::Exists( ruta ) ) partes << Gb( double( FileInfo( ruta ).Size() ) ); } catch ( ... ) {}
      ctx = props["default_generation_settings"]["n_ctx"].n;
      if ( ctx <= 0 )
         ctx = props["n_ctx"].n;
      if ( slots.Size() > 0 && slots[size_t( 0 )]["n_ctx"].n > 0 )
         ctx = slots[size_t( 0 )]["n_ctx"].n;
      bool procesando = false;
      for ( size_t i = 0; i < slots.Size(); ++i )
         if ( slots[i]["is_processing"].b )
            procesando = true;
      if ( fresco && !hayProps )
      {
         avisos << rojo + u"|" + T( u"llama-server no responde en ", u"llama-server does not answer at " ) + m_rdnaBase;
         estado = u"—";
      }
      else if ( hayProps )
         estado = (procesando || m_busy) ? T( u"generando", u"generating" ) : T( u"en reposo", u"idle" );
      if ( modelos.Size() > 0 )
         avisos << rojo + u"|" + T( u"Ollama tiene cargado ", u"Ollama has loaded " ) + Esc( cargados ) +
                   T( u": no caben los dos en la gráfica", u": both do not fit in the GPU" );
   }
   if ( ctx <= 0 && m_lastCtx > 0 )
      ctx = m_lastCtx;
   if ( ctx > 0 )
      partes << T( u"contexto ", u"context " ) + String( int( ctx/1024 + 0.5 ) ) + u"k";
   // /api/ps no dice si el modelo trabaja: con la GPU cargada y el chat sin esperar, es otra petición u otro programa.
   if ( !m_busy && hayGpu && G["gpu"].n >= 30 && (estado.StartsWith( u"en reposo" ) || estado.StartsWith( u"idle" )) )
      estado = T( u"GPU ocupada por otra petición u otro programa", u"GPU busy with another request or program" );

   // Contexto: tokens de la última respuesta (entrada con la caché + salida) frente al contexto del modelo y al punto a
   // partir del cual el panel recorta la conversación (contexto − 9.000).
   bool mio = m_lastKey == m_model.endpoint + u"|" + m_model.model;
   int usados = mio ? m_lastIn + m_lastOut : 0;
   double fc = (ctx > 0 && usados > 0) ? usados/ctx : 0;
   double recorte = ctx > 9000 ? ctx - 9000 : 0;
   double fr = (recorte > 0 && usados > 0) ? usados/recorte : 0;
   m_ctxFrac = fc;
   m_ctxColor = (fc > 0.95) ? Rojo : (fc > 0.8 || fr > 0.8) ? Ambar : Verde;
   Ctx_Label.SetText( (usados > 0 ? Miles( usados ) : String( u"—" )) + T( u" de ", u" of " ) +
                      (ctx > 0 ? String( int( ctx/1024 + 0.5 ) ) + u"k" : String( u"—" )) +
                      (fc > 0 ? u" (" + Num( 100*fc ) + u" %)" : String()) +
                      (recorte > 0 ? T( u" · recorte a los ", u" · trim at " ) + Miles( recorte ) : String()) );
   Ctx_Label.SetToolTip( T( u"Tokens de la última respuesta (entrada con la caché + salida) frente al contexto del modelo. Al pasar del "
                            u"recorte, el panel quita los mensajes más antiguos de la conversación.",
                            u"Tokens of the last reply (input incl. cache + output) against the model context. Past the trim point, "
                            u"the oldest messages of the conversation are removed." ) );
   if ( fc > 0.8 || fr > 0.8 )
      avisos << ambar + u"|" + T( u"Contexto casi lleno: pronto se recorta la conversación", u"Context nearly full: the conversation will be trimmed soon" );

   // Memoria dedicada de la gráfica (todos los programas); sin contador, la de los modelos de Ollama.
   double usada = hayGpu ? G["vram"].n : enVram;
   double total = (hayGpu && G["total"].n > 4.0*1073741824) ? G["total"].n : 24.0*1073741824;
   m_memFrac = usada/total;
   m_memColor = (m_memFrac > 0.98) ? Ambar : Verde;
   Mem_Label.SetText( ((hayGpu || usada > 0) ? Gb( usada ) : String( u"—" )) + T( u" de ", u" of " ) + Num( total/1073741824 ) + u" GB" +
                      (hayGpu ? String() : T( u" (sólo modelos)", u" (models only)" )) );
   Mem_Label.SetToolTip( T( u"Memoria dedicada usada en la gráfica (todos los programas), del contador de Windows.",
                            u"Dedicated GPU memory in use (all programs), from the Windows counter." ) );

   String html = u"<b>" + (nombre.IsEmpty() ? String( u"—" ) : nombre) + u"</b>";
   for ( const String& p : partes )
      html << u" · " << p;
   for ( const String& a : avisos )
   {
      size_type b = a.Find( '|' );
      html << u"<br><span style=\"color:" << a.Left( b ) << u"\">⚠ " << a.Substring( b+1 ) << u"</span>";
   }
   Model_Label.SetText( html );
   String color = pct < 0 ? String( u"#888888" ) : pct >= 100 ? verde : rojo;
   Gpu_Label.SetText( u"<div align=\"right\"><span style=\"font-size:20pt; font-weight:600; color:" + color + u"\">" +
                      (pct < 0 ? String( u"—" ) : Num( pct ) + u" %") + u"</span><br>" + T( u"en la GPU", u"on the GPU" ) + u"</div>" );
   Gpu_Label.SetToolTip( m_rdna ? T( u"llama-server no lo dice: con -ngl 99 va entero en la gráfica.", u"llama-server does not report it: with -ngl 99 it is fully on the GPU." )
                                : T( u"Parte del modelo cargada en la gráfica (size_vram / size de /api/ps).", u"Part of the model loaded on the GPU (size_vram / size from /api/ps)." ) );
   String carga = T( u"Carga: ", u"Load: " ) + (hayGpu ? u"GPU " + Num( G["gpu"].n ) + u" %" + (G["motor"].s.IsEmpty() ? String() : u" (" + Esc( G["motor"].s ) + u")")
                                                       : String( u"GPU —" ));
   if ( !estado.IsEmpty() )
      carga << u" · " << estado;
   if ( mio && m_lastTps > 0 )
      carga << u" · " << Num( m_lastTps, 1 ) << T( u" tok/s en la última respuesta", u" tok/s in the last reply" );
   Load_Label.SetText( carga );
   MemTitle_Label.SetText( T( u"Memoria", u"Memory" ) );
   CtxTitle_Label.SetText( T( u"Contexto", u"Context" ) );
   Unload_Button.SetText( m_loaded.Length() > 1 ? T( u"Descargar modelos", u"Unload models" ) : T( u"Descargar modelo", u"Unload model" ) );
   Unload_Button.SetToolTip( T( u"Saca de la gráfica lo que tiene cargado Ollama (keep_alive 0): ", u"Unloads what Ollama has loaded (keep_alive 0): " ) + cargados );
   Unload_Button.Enable( !m_busy && !(m_unload && m_unload->IsRunning()) );
   if ( m_loaded.IsEmpty() ) Unload_Button.Hide(); else Unload_Button.Show();
   Mem_Bar.Update();
   Ctx_Bar.Update();
}

void PiAstroPilotLocalPanel::e_Paint( Control& sender, const pcl::Rect& )
{
   double f = (&sender == &Mem_Bar) ? m_memFrac : m_ctxFrac;
   uint32 c = (&sender == &Mem_Bar) ? m_memColor : m_ctxColor;
   f = Range( f, 0.0, 1.0 );
   Graphics G( sender );
   int w = sender.Width(), h = sender.Height();
   G.FillRect( 0, 0, w, h, Brush( 0x50808080 ) );
   if ( f > 0 )
      G.FillRect( 0, 0, Max( 1, RoundInt( w*f ) ), h, Brush( c ) );
   G.EndPaint();
}

// Botón: descarga de Ollama lo que tenga cargado (keep_alive 0), con curl sin esperar. No con una petición en marcha.
void PiAstroPilotLocalPanel::e_Click( Button&, bool )
{
   if ( m_busy || m_loaded.IsEmpty() || (m_unload && m_unload->IsRunning()) )
      return;
   String cmd;
   for ( const String& n : m_loaded )
      cmd << u"try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method Post -ContentType 'application/json' -Body '{\"model\":\""
          << n << u"\",\"keep_alive\":0}' '" << m_ollamaBase << u"/api/generate' | Out-Null } catch {}; ";
   try
   {
      m_unload.reset( new ExternalProcess );
      StringList args;
      args << "-NoProfile" << "-ExecutionPolicy" << "Bypass" << "-WindowStyle" << "Hidden" << "-Command" << cmd;
      m_unload->Start( "powershell.exe", args );
      Unload_Button.Disable();
      m_nextAt = 0;
   }
   catch ( ... ) {}
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiAstroPilotLocalPanel.cpp
