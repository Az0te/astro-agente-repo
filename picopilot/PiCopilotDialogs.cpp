// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotDialogs.cpp - Ventanas de Prompt (chat), añadir modelo y dossier.
// ----------------------------------------------------------------------------

#include "PiCopilotDialogs.h"
#include "PiCopilotI18n.h"
#include "PiCopilotInterface.h"
#include "PiCopilotProcess.h"

#include <pcl/Console.h>
#include <pcl/ExternalProcess.h>
#include <pcl/File.h>
#include <pcl/ImageWindow.h>
#include <pcl/MessageBox.h>
#include <pcl/Settings.h>
#include <pcl/View.h>

namespace pcl
{

// ----------------------------------------------------------------------------

PiCopilotChatDialog*    ThePiCopilotChat = nullptr;
PiCopilotDossierDialog* ThePiCopilotDossier = nullptr;

// ----------------------------------------------------------------------------
// PiCopilotChatDialog
// ----------------------------------------------------------------------------

PiCopilotChatDialog::PiCopilotChatDialog()
{
   ThePiCopilotChat = this;
}

PiCopilotChatDialog::~PiCopilotChatDialog()
{
   StopVoice();
   if ( m_dictation )
      try { if ( m_dictation->IsRunning() ) m_dictation->Kill(); } catch ( ... ) {}
   if ( GUI != nullptr )
      delete GUI, GUI = nullptr;
}

IsoString PiCopilotChatDialog::Id() const
{
   return "PiCopilotPrompt";
}

MetaProcess* PiCopilotChatDialog::Process() const
{
   return ThePiCopilotProcess;
}

String PiCopilotChatDialog::IconImageSVGFile() const
{
   return "@module_icons_dir/PiCopilot.svg";
}

InterfaceFeatures PiCopilotChatDialog::Features() const
{
   return InterfaceFeature::None;
}

bool PiCopilotChatDialog::Launch( const MetaProcess&, const ProcessImplementation*, bool& dynamic, unsigned& /*flags*/ )
{
   if ( GUI == nullptr )
   {
      GUI = new GUIData( *this );
      SetWindowTitle( Tr( u"PiCopilot - Prompt" ) );
      GUI->Context_Label.SetText( m_context );
      RefreshHistory();
      Refresh();
   }
   dynamic = false;
   return true;
}

void PiCopilotChatDialog::SetContext( const String& modelName, const String& viewId )
{
   m_context = Tr( u"Modelo: " ) + modelName + Tr( u"     Imagen: " ) +
               (viewId.IsEmpty() ? String( Tr( u"(ninguna)" ) ) : viewId);
   if ( GUI != nullptr )
      GUI->Context_Label.SetText( m_context );
}

void PiCopilotChatDialog::SetBusy( bool busy )
{
   m_busy = busy;
   Refresh();
}

void PiCopilotChatDialog::Refresh()
{
   if ( GUI == nullptr )
      return;
   GUI->Send_Button.Enable( !m_busy );
   GUI->Send_Button.SetText( m_busy ? String( Tr( u"Pensando..." ) ) : String( Tr( u"Enviar" ) ) );
   GUI->RunCalls_Button.Enable( !m_busy && !m_lastCalls.IsEmpty() );
   GUI->New_Button.Enable( !m_busy );
}

void PiCopilotChatDialog::RefreshHistory()
{
   if ( GUI == nullptr )
      return;
   // La página entera se vuelve a generar (el script del final la lleva al último mensaje) y se carga desde un fichero:
   // SetHTML no admite más de 2 MB y con muchas previas el chat se quedaba congelado.
   String path = PiCopilotUtil::JoinPath( File::SystemTempDirectory(), u"picopilot_chat.html" );
   try
   {
      File::WriteTextFile( path, PiCopilotRender::Page( m_entries ).ToUTF8() );
      String url = path;
      url.ReplaceString( u"\\", u"/" );
      GUI->History_WebView.LoadContent( u"file:///" + url );
   }
   catch ( ... )
   {
      GUI->History_WebView.SetHTML( PiCopilotRender::Page( m_entries ) );
   }
}

static void Push( std::vector<PiCopilotChatEntry>& v, PiCopilotChatEntry::Kind k, const String& title, const String& text )
{
   PiCopilotChatEntry e;
   e.kind = k; e.title = title; e.text = text; e.time = PiCopilotUtil::Timestamp();
   v.push_back( e );
   if ( v.size() > 400 )   // la página no crece sin límite
      v.erase( v.begin(), v.begin() + (v.size() - 400) );
}

void PiCopilotChatDialog::AppendUser( const String& text )
{
   Push( m_entries, PiCopilotChatEntry::User, Tr( u"Tú" ), text );
   RefreshHistory();
}

void PiCopilotChatDialog::AppendAssistant( const String& modelName, const String& text )
{
   Push( m_entries, PiCopilotChatEntry::Assistant, modelName, text );
   RefreshHistory();
   m_lastCalls = PiCopilotPrompts::ExtractCalls( text );
   Refresh();
   if ( m_voiceOn )
      Speak( text );
}

// ----------------------------------------------------------------------------
// Voz: leer las respuestas y dictar el prompt (accesibilidad, Rafael 8 nov 2026). Voces y reconocedor de Windows
// (System.Speech, sin internet) en un PowerShell aparte: PixInsight no se bloquea mientras habla o escucha.

static const char16_t* s_psSpeak =
   u"param($f, $rate, $cultura)\r\n"
   u"Add-Type -AssemblyName System.Speech\r\n"
   u"$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\r\n"
   u"try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [Globalization.CultureInfo]$cultura) } catch {}\r\n"
   u"$s.Rate = [int]$rate\r\n"
   u"$s.Speak([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))\r\n";

// Frases seguidas hasta un silencio (8 s sin empezar, 2,5 s tras la última frase) o 90 s.
static const char16_t* s_psDictate =
   u"param($salida, $cultura)\r\n"
   u"Add-Type -AssemblyName System.Speech\r\n"
   u"$texto = @()\r\n"
   u"try {\r\n"
   u"  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine([Globalization.CultureInfo]$cultura)\r\n"
   u"  $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))\r\n"
   u"  $r.SetInputToDefaultAudioDevice()\r\n"
   u"  $r.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)\r\n"
   u"  $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(8)\r\n"
   u"  $fin = (Get-Date).AddSeconds(90)\r\n"
   u"  while ((Get-Date) -lt $fin) {\r\n"
   u"    $res = $r.Recognize()\r\n"
   u"    if (-not $res) { break }\r\n"
   u"    $texto += $res.Text\r\n"
   u"    $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(2.5)\r\n"
   u"  }\r\n"
   u"} catch { $texto = @('ERROR: ' + $_.Exception.Message) }\r\n"
   u"[IO.File]::WriteAllText($salida, ($texto -join ' '), [Text.Encoding]::UTF8)\r\n";

static String VoiceDir()
{
   String d = PiCopilotUtil::JoinPath( File::SystemTempDirectory(), "PiCopilotVoz" );
   if ( !File::DirectoryExists( d ) )
      File::CreateDirectory( d, true );
   return d;
}

static String VoiceCulture()
{
   return PiCopilotEnglish() ? String( "en-US" ) : String( "es-ES" );
}

// Texto para leer: sin bloques de código, sin símbolos de Markdown, enlaces por su texto y tablas como frases.
static String VoiceText( const String& md )
{
   String src = md;
   src.ReplaceString( "\r\n", "\n" );
   StringList lines;
   src.Break( lines, '\n' );
   String out;
   bool inCode = false;
   for ( const String& raw : lines )
   {
      String t = raw.Trimmed();
      if ( t.StartsWith( "```" ) )
      {
         if ( !inCode )
            out << (PiCopilotEnglish() ? u" I have prepared the calls. " : u" Te he preparado las llamadas. ");
         inCode = !inCode;
         continue;
      }
      if ( inCode || t.IsEmpty() )
         continue;
      if ( t.StartsWith( '|' ) )
      {
         bool sep = true;
         for ( size_type i = 0; i < t.Length(); ++i )
            if ( t[i] != '|' && t[i] != '-' && t[i] != ':' && t[i] != ' ' ) { sep = false; break; }
         if ( sep )
            continue;
         t = t.Substring( 1 );
         if ( t.EndsWith( '|' ) ) t = t.Left( t.Length() - 1 );
         t.ReplaceString( "|", ", " );
      }
      while ( t.StartsWith( '#' ) || t.StartsWith( '>' ) ) t = t.Substring( 1 ).Trimmed();
      if ( t.StartsWith( "- " ) || t.StartsWith( "* " ) || t.StartsWith( u"• " ) ) t = t.Substring( 2 );
      // Enlaces [texto](url) -> texto.
      for ( ;; )
      {
         size_type a = t.Find( "](" );
         if ( a == String::notFound ) break;
         size_type b = t.Find( ')', a );
         size_type o = t.FindLast( '[', a );
         if ( b == String::notFound || o == String::notFound ) break;
         t = t.Left( o ) + t.Substring( o + 1, a - o - 1 ) + t.Substring( b + 1 );
      }
      String clean;
      for ( size_type i = 0; i < t.Length(); ++i )
         if ( t[i] != '*' && t[i] != '_' && t[i] != '`' && t[i] != '#' )
            clean << t[i];
      clean.Trim();
      if ( clean.IsEmpty() )
         continue;
      out << clean;
      if ( !clean.EndsWith( '.' ) && !clean.EndsWith( ':' ) && !clean.EndsWith( '?' ) && !clean.EndsWith( '!' ) )
         out << '.';
      out << ' ';
   }
   return out.Trimmed();
}

static ExternalProcess* StartPowerShell( const String& name, const char16_t* code, const StringList& args )
{
   String ps1 = PiCopilotUtil::JoinPath( VoiceDir(), name + ".ps1" );
   File f = File::CreateFileForWriting( ps1 );
   f.Write( String( code ).ToUTF8() );   // sólo ASCII
   f.Close();
   StringList a;
   a << "-NoProfile" << "-ExecutionPolicy" << "Bypass" << "-WindowStyle" << "Hidden" << "-File" << ps1;
   for ( const String& s : args ) a << s;
   ExternalProcess* P = new ExternalProcess;
   P->Start( "powershell.exe", a );
   return P;
}

void PiCopilotChatDialog::Speak( const String& markdown )
{
   StopVoice();
   String t = VoiceText( markdown );
   if ( t.IsEmpty() )
      return;
   String txt = PiCopilotUtil::JoinPath( VoiceDir(), "voz.txt" );
   PiCopilotUtil::WriteText( txt, t );
   try
   {
      m_voice.reset( StartPowerShell( "hablar", s_psSpeak, StringList() << txt << String( m_voiceRate ) << VoiceCulture() ) );
   }
   catch ( ... ) { m_voice.reset(); }
}

void PiCopilotChatDialog::StopVoice()
{
   if ( m_voice )
   {
      try { if ( m_voice->IsRunning() ) m_voice->Kill(); } catch ( ... ) {}
      m_voice.reset();
   }
}

// Dictado moderno de Windows 11 (Win + H): mucho mejor que el reconocedor antiguo (Rafael, 8 nov 2026). Se pone el foco
// en el Prompt y se pulsa Win + H desde un PowerShell aparte; Windows escribe directamente en el cuadro (necesita internet).
static const char16_t* s_psWinH =
   u"Add-Type -Namespace PL -Name Teclas -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);'\r\n"
   u"Start-Sleep -Milliseconds 200\r\n"
   u"[PL.Teclas]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)\r\n"
   u"[PL.Teclas]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)\r\n"
   u"[PL.Teclas]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero)\r\n"
   u"[PL.Teclas]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)\r\n";

void PiCopilotChatDialog::StartDictation()
{
   bool antiguo = false;   // Settings "DictationSAPI": true = reconocedor antiguo (sin internet)
   Settings::Read( "DictationSAPI", antiguo );
   if ( !antiguo )
   {
      StopVoice();
      if ( GUI != nullptr )
         GUI->Prompt_TextBox.Focus();
      try
      {
         std::unique_ptr<ExternalProcess> p( StartPowerShell( "dictado_windows", s_psWinH, StringList() ) );
         p->WaitForFinished( 5000 );
      }
      catch ( ... ) {}
      return;
   }
   if ( m_dictation )   // segunda pulsación: cancelar
   {
      try { if ( m_dictation->IsRunning() ) m_dictation->Kill(); } catch ( ... ) {}
      m_dictation.reset();
      if ( GUI != nullptr ) GUI->Dictate_Button.SetText( Tr( u"Dictar" ) );
      return;
   }
   StopVoice();
   m_dictationOut = PiCopilotUtil::JoinPath( VoiceDir(), "dictado.txt" );
   if ( File::Exists( m_dictationOut ) )
      File::Remove( m_dictationOut );
   try
   {
      m_dictation.reset( StartPowerShell( "dictar", s_psDictate, StringList() << m_dictationOut << VoiceCulture() ) );
      if ( GUI != nullptr ) GUI->Dictate_Button.SetText( Tr( u"Escuchando… (parar)" ) );
   }
   catch ( ... ) { m_dictation.reset(); }
}

void PiCopilotChatDialog::FinishDictation()
{
   m_dictation.reset();
   if ( GUI == nullptr )
      return;
   GUI->Dictate_Button.SetText( Tr( u"Dictar" ) );
   String txt = File::Exists( m_dictationOut ) ? PiCopilotUtil::ReadText( m_dictationOut ).Trimmed() : String();
   if ( !txt.IsEmpty() && txt[0] == 0xFEFF )
      txt = txt.Substring( 1 ).Trimmed();
   if ( txt.IsEmpty() || txt.StartsWith( "ERROR:" ) )
   {
      AppendInfo( txt.IsEmpty() ? Tr( u"Dictado: no he oído nada (¿micrófono?)." ) : Tr( u"Dictado: " ) + txt );
      return;
   }
   String now = GUI->Prompt_TextBox.Text().Trimmed();
   GUI->Prompt_TextBox.SetText( now.IsEmpty() ? txt : now + ' ' + txt );
}

void PiCopilotChatDialog::e_VoiceRate( SpinBox&, int value )
{
   m_voiceRate = value;
   Settings::Write( "VoiceRate", m_voiceRate );
}

void PiCopilotChatDialog::AppendInfo( const String& text )
{
   Push( m_entries, PiCopilotChatEntry::Info, String(), text );
   RefreshHistory();
}

void PiCopilotChatDialog::AppendInfo( const String& text, const std::vector<std::pair<String, String>>& images )
{
   Push( m_entries, PiCopilotChatEntry::Info, String(), text );
   m_entries.back().images = images;
   RefreshHistory();
}

void PiCopilotChatDialog::ClearView()
{
   m_entries.clear();
   if ( ThePiCopilotInterface != nullptr )
      ThePiCopilotInterface->CleanTempFiles();
   RefreshHistory();
}

void PiCopilotChatDialog::ClearConversation()
{
   m_entries.clear();
   m_lastCalls.Clear();
   RefreshHistory();
   Refresh();
}

void PiCopilotChatDialog::e_Click( Button& sender, bool /*checked*/ )
{
   if ( sender == GUI->Send_Button )
   {
      String text = GUI->Prompt_TextBox.Text().Trimmed();
      if ( text.IsEmpty() || ThePiCopilotInterface == nullptr )
         return;
      if ( ThePiCopilotInterface->SubmitChat( text ) )
         GUI->Prompt_TextBox.Clear();
   }
   else if ( sender == GUI->AutoRun_CheckBox )
   {
      if ( ThePiCopilotInterface != nullptr )
         ThePiCopilotInterface->SetAutoRun( GUI->AutoRun_CheckBox.IsChecked() );
   }
   else if ( sender == GUI->Internet_CheckBox )
   {
      if ( ThePiCopilotInterface != nullptr )
         ThePiCopilotInterface->SetInternet( GUI->Internet_CheckBox.IsChecked() );
   }
   else if ( sender == GUI->Voice_CheckBox )
   {
      m_voiceOn = GUI->Voice_CheckBox.IsChecked();
      Settings::Write( "Voice", m_voiceOn );
      if ( !m_voiceOn )
         StopVoice();
   }
   else if ( sender == GUI->ReadAloud_Button )
   {
      for ( size_t i = m_entries.size(); i > 0; --i )
         if ( m_entries[i-1].kind == PiCopilotChatEntry::Assistant )
         {
            Speak( m_entries[i-1].text );
            break;
         }
   }
   else if ( sender == GUI->StopVoice_Button )
   {
      StopVoice();
   }
   else if ( sender == GUI->Dictate_Button )
   {
      StartDictation();
   }
   else if ( sender == GUI->RunCalls_Button )
   {
      if ( !m_lastCalls.IsEmpty() && ThePiCopilotInterface != nullptr )
         ThePiCopilotInterface->RunCallsButton( m_lastCalls );
   }
   else if ( sender == GUI->Clear_Button )
   {
      ClearView();
   }
   else if ( sender == GUI->New_Button )
   {
      ClearConversation();
      if ( ThePiCopilotInterface != nullptr )
         ThePiCopilotInterface->ResetChat();
   }
}

void PiCopilotChatDialog::e_LinkTimer( Timer& )
{
   if ( m_dictation && !m_dictation->IsRunning() )
      FinishDictation();
   if ( GUI == nullptr || !IsVisible() )
      return;
   GUI->History_WebView.EvaluateScript( u"(function(){var x=(typeof picoClick==='string')?picoClick:'';picoClick='';return x;})();" );
}

void PiCopilotChatDialog::e_LinkResult( WebView&, const Variant& result )
{
   if ( !result.IsValid() || ThePiCopilotInterface == nullptr )
      return;
   String v = result.ToString();
   size_type bar = v.Find( '|' );
   if ( v.IsEmpty() || bar == String::notFound )
      return;
   String text = v.Substring( bar + 1 ).Trimmed();
   if ( text.IsEmpty() )
      return;
   int index = -1;
   v.Left( bar ).TryToInt( index );
   int lastAssistant = -1;
   for ( size_t i = 0; i < m_entries.size(); ++i )
      if ( m_entries[i].kind == PiCopilotChatEntry::Assistant )
         lastAssistant = int( i );
   ThePiCopilotInterface->StepLinkClicked( text, index >= 0 && index == lastAssistant, m_lastCalls );
}

PiCopilotChatDialog::GUIData::GUIData( PiCopilotChatDialog& w )
{
   Context_Label.EnableWordWrapping();

   History_WebView.SetScaledMinSize( 520, 300 );
   History_WebView.SetBackgroundColor( 0xff232629 );
   History_WebView.OnScriptResultAvailable( (WebView::result_event_handler)&PiCopilotChatDialog::e_LinkResult, w );

   Prompt_Label.SetText( Tr( u"Prompt:" ) );

   Prompt_TextBox.SetScaledMinHeight( 90 );
   Prompt_TextBox.SetToolTip( Tr( u"<p>Escribe tu petición y pulsa <b>Enviar</b>. La respuesta llega en segundo "
                              u"plano: puedes seguir trabajando en PixInsight mientras tanto.</p>" ) );

   Send_Button.SetText( Tr( u"Enviar" ) );
   Send_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );

   RunCalls_Button.SetText( Tr( u"Ejecutar llamadas" ) );
   RunCalls_Button.SetToolTip( Tr( u"<p>Ejecuta en PixInsight las llamadas a funciones de la guía del último bloque <i>```json</i> de la respuesta. "
                                u"Revísalas antes: se te pedirá confirmación.</p>" ) );
   RunCalls_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );

   AutoRun_CheckBox.SetText( Tr( u"Ejecutar sin preguntar" ) );
   AutoRun_CheckBox.SetToolTip( Tr( u"<p>Las llamadas de la respuesta a tu Prompt se ejecutan en PixInsight sin esperar a que pulses "
                                u"«Ejecutar llamadas». Los enlaces «Siguiente paso» del chat ejecutan ese paso con un clic.</p>" ) );
   AutoRun_CheckBox.SetChecked( ThePiCopilotInterface == nullptr || ThePiCopilotInterface->AutoRunEnabled() );
   AutoRun_CheckBox.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );

   Internet_CheckBox.SetText( Tr( u"Internet" ) );
   Internet_CheckBox.SetToolTip( Tr( u"<p>Permitir búsquedas externas. Claude: WebSearch y WebFetch. Todos los modelos: SIMBAD, "
                                 u"Wikipedia, páginas web e imágenes de catálogo (web.js de la guía). Sin marcar, nada sale a internet.</p>" ) );
   Internet_CheckBox.SetChecked( ThePiCopilotInterface == nullptr || ThePiCopilotInterface->InternetEnabled() );
   Internet_CheckBox.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );

   // Voz (accesibilidad).
   Settings::Read( "Voice", w.m_voiceOn );
   Settings::Read( "VoiceRate", w.m_voiceRate );
   Dictate_Button.SetText( Tr( u"Dictar" ) );
   Dictate_Button.SetToolTip( Tr( u"<p>Abre el dictado de Windows (Win + H) con el cursor en el Prompt: lo que dices se escribe ahí. "
                              u"Necesita internet (lo procesa Microsoft). Para cerrarlo, Win + H o Esc.</p>" ) );
   Dictate_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );
   Voice_CheckBox.SetText( Tr( u"Leer en voz alta" ) );
   Voice_CheckBox.SetToolTip( Tr( u"<p>Lee cada respuesta del modelo con la voz de Windows (sin los bloques de llamadas).</p>" ) );
   Voice_CheckBox.SetChecked( w.m_voiceOn );
   Voice_CheckBox.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );
   ReadAloud_Button.SetText( Tr( u"Leer" ) );
   ReadAloud_Button.SetToolTip( Tr( u"<p>Lee en voz alta la última respuesta del modelo.</p>" ) );
   ReadAloud_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );
   StopVoice_Button.SetText( Tr( u"Parar voz" ) );
   StopVoice_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );
   VoiceRate_Label.SetText( Tr( u"Velocidad:" ) );
   VoiceRate_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   VoiceRate_SpinBox.SetRange( -10, 10 );
   VoiceRate_SpinBox.SetValue( w.m_voiceRate );
   VoiceRate_SpinBox.SetToolTip( Tr( u"<p>Velocidad de la voz: -10 lenta, 0 normal, 10 rápida.</p>" ) );
   VoiceRate_SpinBox.OnValueUpdated( (SpinBox::value_event_handler)&PiCopilotChatDialog::e_VoiceRate, w );
   Voice_Sizer.SetSpacing( 6 );
   Voice_Sizer.Add( Dictate_Button );
   Voice_Sizer.AddSpacing( 12 );
   Voice_Sizer.Add( Voice_CheckBox );
   Voice_Sizer.Add( ReadAloud_Button );
   Voice_Sizer.Add( StopVoice_Button );
   Voice_Sizer.AddSpacing( 8 );
   Voice_Sizer.Add( VoiceRate_Label );
   Voice_Sizer.Add( VoiceRate_SpinBox );
   Voice_Sizer.AddStretch();

   Link_Timer.SetInterval( 0.4 );
   Link_Timer.SetPeriodic( true );
   Link_Timer.OnTimer( (Timer::timer_event_handler)&PiCopilotChatDialog::e_LinkTimer, w );
   Link_Timer.Start();

   Clear_Button.SetText( Tr( u"Limpiar" ) );
   Clear_Button.SetToolTip( Tr( u"<p>Vacía la ventana. El modelo conserva el contexto de la conversación.</p>" ) );
   Clear_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );

   New_Button.SetText( Tr( u"Nueva conversación" ) );
   New_Button.SetToolTip( Tr( u"<p>Vacía la ventana y empieza una conversación nueva: el modelo olvida lo anterior.</p>" ) );
   New_Button.OnClick( (Button::click_event_handler)&PiCopilotChatDialog::e_Click, w );

   Buttons_Sizer.SetSpacing( 6 );
   Buttons_Sizer.Add( Send_Button );
   Buttons_Sizer.Add( RunCalls_Button );
   Buttons_Sizer.Add( AutoRun_CheckBox );
   Buttons_Sizer.Add( Internet_CheckBox );
   Buttons_Sizer.AddStretch();
   Buttons_Sizer.Add( Clear_Button );
   Buttons_Sizer.Add( New_Button );

   Global_Sizer.SetMargin( 8 );
   Global_Sizer.SetSpacing( 6 );
   Global_Sizer.Add( Context_Label );
   Global_Sizer.Add( History_WebView, 100 );
   Global_Sizer.Add( Prompt_Label );
   Global_Sizer.Add( Prompt_TextBox );
   Global_Sizer.Add( Buttons_Sizer );
   Global_Sizer.Add( Voice_Sizer );

   w.SetSizer( Global_Sizer );
   w.EnsureLayoutUpdated();
   w.AdjustToContents();
}

// ----------------------------------------------------------------------------
// PiCopilotAddModelDialog
// ----------------------------------------------------------------------------

struct ModelPreset
{
   const char16_t* label;
   const char*     name;
   const char*     endpoint;
   const char*     model;
   const char*     keyEnv;
};

static const ModelPreset s_presets[] =
{
   { u"Strata (127.0.0.1:8080)",   "Qwen local (Strata)", "http://127.0.0.1:8080/v1/chat/completions",  "qwen3.8-flash-next", "" },
   { u"Ollama (localhost:11434)",  "Qwen (Ollama)",       "http://localhost:11434/v1/chat/completions", "qwen38-32k",         "" },
   { u"LM Studio (localhost:1234)","Modelo LM Studio",    "http://localhost:1234/v1/chat/completions",  "",                   "" },
   { u"OpenAI (ChatGPT)",          "ChatGPT",             "https://api.openai.com/v1/chat/completions", "gpt-5",              "OPENAI_API_KEY" },
   { u"Personalizado",             "",                    "",                                            "",                   "" },
};

PiCopilotAddModelDialog::PiCopilotAddModelDialog()
{
   int labelWidth = Font().Width( String( Tr( u"Variable de la clave:" ) ) ) + LogicalPixelsToPhysical( 4 );

   Info_Label.EnableWordWrapping();
   Info_Label.SetText( Tr( u"Añade un modelo con API compatible con OpenAI (chat/completions): Strata, Ollama, "
                       u"LM Studio, vLLM u OpenAI. La clave, si hace falta, se lee de una variable de entorno; "
                       u"PiCopilot no la guarda." ) );

   Preset_Label.SetText( Tr( u"Plantilla:" ) );
   Preset_Label.SetFixedWidth( labelWidth );
   Preset_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   for ( const ModelPreset& p : s_presets )
      Preset_ComboBox.AddItem( Tr( String( p.label ) ) );
   Preset_ComboBox.OnItemSelected( (ComboBox::item_event_handler)&PiCopilotAddModelDialog::e_ItemSelected, *this );
   Preset_Sizer.SetSpacing( 4 );
   Preset_Sizer.Add( Preset_Label );
   Preset_Sizer.Add( Preset_ComboBox, 100 );

   Name_Label.SetText( Tr( u"Nombre:" ) );
   Name_Label.SetFixedWidth( labelWidth );
   Name_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Name_Sizer.SetSpacing( 4 );
   Name_Sizer.Add( Name_Label );
   Name_Sizer.Add( Name_Edit, 100 );

   Endpoint_Label.SetText( u"Endpoint:" );
   Endpoint_Label.SetFixedWidth( labelWidth );
   Endpoint_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Endpoint_Edit.SetScaledMinWidth( 360 );
   Endpoint_Sizer.SetSpacing( 4 );
   Endpoint_Sizer.Add( Endpoint_Label );
   Endpoint_Sizer.Add( Endpoint_Edit, 100 );

   ModelId_Label.SetText( Tr( u"Modelo:" ) );
   ModelId_Label.SetFixedWidth( labelWidth );
   ModelId_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   ModelId_Edit.SetToolTip( Tr( u"<p>Identificador del modelo tal y como lo espera el servidor "
                            u"(por ejemplo <i>qwen3.8-flash-next</i> o el nombre que muestra <i>ollama list</i>).</p>" ) );
   ModelId_Sizer.SetSpacing( 4 );
   ModelId_Sizer.Add( ModelId_Label );
   ModelId_Sizer.Add( ModelId_Edit, 100 );

   Key_Label.SetText( Tr( u"Variable de la clave:" ) );
   Key_Label.SetFixedWidth( labelWidth );
   Key_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Key_Edit.SetToolTip( Tr( u"<p>Nombre de la variable de entorno con la clave API (por ejemplo OPENAI_API_KEY). "
                        u"Déjalo vacío para modelos locales.</p>" ) );
   Key_Sizer.SetSpacing( 4 );
   Key_Sizer.Add( Key_Label );
   Key_Sizer.Add( Key_Edit, 100 );

   OK_Button.SetText( Tr( u"Añadir" ) );
   OK_Button.SetDefault();
   OK_Button.OnClick( (Button::click_event_handler)&PiCopilotAddModelDialog::e_Click, *this );
   Cancel_Button.SetText( Tr( u"Cancelar" ) );
   Cancel_Button.OnClick( (Button::click_event_handler)&PiCopilotAddModelDialog::e_Click, *this );
   Buttons_Sizer.SetSpacing( 6 );
   Buttons_Sizer.AddStretch();
   Buttons_Sizer.Add( OK_Button );
   Buttons_Sizer.Add( Cancel_Button );

   Global_Sizer.SetMargin( 8 );
   Global_Sizer.SetSpacing( 6 );
   Global_Sizer.Add( Info_Label );
   Global_Sizer.Add( Preset_Sizer );
   Global_Sizer.Add( Name_Sizer );
   Global_Sizer.Add( Endpoint_Sizer );
   Global_Sizer.Add( ModelId_Sizer );
   Global_Sizer.Add( Key_Sizer );
   Global_Sizer.AddSpacing( 4 );
   Global_Sizer.Add( Buttons_Sizer );

   SetSizer( Global_Sizer );
   SetWindowTitle( Tr( u"PiCopilot - Añadir modelo" ) );
   AdjustToContents();
   SetFixedHeight();

   e_ItemSelected( Preset_ComboBox, 0 );
}

PiCopilotModel PiCopilotAddModelDialog::Model() const
{
   PiCopilotModel m;
   m.name = Name_Edit.Text().Trimmed();
   m.type = "openai";
   m.endpoint = Endpoint_Edit.Text().Trimmed();
   m.model = ModelId_Edit.Text().Trimmed();
   m.keyEnv = Key_Edit.Text().Trimmed();
   m.builtin = false;
   return m;
}

void PiCopilotAddModelDialog::e_ItemSelected( ComboBox& /*sender*/, int itemIndex )
{
   if ( itemIndex < 0 || itemIndex >= int( sizeof( s_presets )/sizeof( *s_presets ) ) )
      return;
   const ModelPreset& p = s_presets[itemIndex];
   Name_Edit.SetText( String::UTF8ToUTF16( p.name ) );
   Endpoint_Edit.SetText( String( p.endpoint ) );
   ModelId_Edit.SetText( String( p.model ) );
   Key_Edit.SetText( String( p.keyEnv ) );
}

void PiCopilotAddModelDialog::e_Click( Button& sender, bool /*checked*/ )
{
   if ( sender == OK_Button )
   {
      PiCopilotModel m = Model();
      if ( m.name.IsEmpty() || m.endpoint.IsEmpty() || m.model.IsEmpty() )
      {
         MessageBox( Tr( u"Rellena el nombre, el endpoint y el modelo." ), "PiCopilot",
                     StdIcon::Warning, StdButton::Ok ).Execute();
         return;
      }
      Ok();
   }
   else if ( sender == Cancel_Button )
      Cancel();
}

// ----------------------------------------------------------------------------
// PiCopilotAIConfigDialog
// ----------------------------------------------------------------------------

PiCopilotAIConfigDialog::PiCopilotAIConfigDialog( PiCopilotConfig& cfg, const PiCopilotModel& model )
   : m_cfg( cfg )
   , m_model( model )
{
   bool claude = model.IsClaude();
   int labelWidth = Font().Width( String( Tr( u"Corrección de Gradiente" ) ) ) + LogicalPixelsToPhysical( 8 );

   Info_Label.EnableWordWrapping();
   Info_Label.EnableRichText();
   Info_Label.SetText( Tr( u"Cada paso tiene una puntuación: <b>valor base</b> (calidad de Sonnet en % de la de Opus, "
                       u"medida en IC 1396) más tu <b>ajuste</b>. Si la puntuación es <b>mayor que N</b> se usa el "
                       u"modelo inferior; si es igual o menor, el superior. El Prompt libre y los pasos sin valor "
                       u"usan siempre el superior.<br/>Tabla: " ) +
                       (cfg.scoresSource.IsEmpty() ? String( Tr( u"interna del módulo (no se encontró " ) ) + cfg.ScoresFile() + u")"
                                                   : cfg.scoresSource) );

   N_Label.SetText( Tr( u"Valor N:" ) );
   N_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   N_SpinBox.SetRange( 0, 300 );
   N_SpinBox.SetValue( cfg.threshold );
   N_SpinBox.SetToolTip( Tr( u"<p>Umbral: a partir de este valor se usa el modelo inferior. Por defecto, 95.</p>" ) );
   N_SpinBox.OnValueUpdated( (SpinBox::value_event_handler)&PiCopilotAIConfigDialog::e_ValueUpdated, *this );

   Low_Label.SetText( Tr( u"Inferior:" ) );
   Low_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Low_Edit.SetText( claude ? cfg.claudeLow : cfg.openaiLow );
   Low_Edit.SetToolTip( claude ? String( Tr( u"<p>Valor de <i>--model</i> para Claude Code (sonnet, opus o un id completo).</p>" ) )
                               : String( Tr( u"<p>Id del modelo de OpenAI.</p>" ) ) );
   High_Label.SetText( Tr( u"Superior:" ) );
   High_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   High_Edit.SetText( claude ? cfg.claudeHigh : cfg.openaiHigh );

   N_Sizer.SetSpacing( 6 );
   N_Sizer.Add( N_Label );
   N_Sizer.Add( N_SpinBox );
   N_Sizer.AddSpacing( 16 );
   N_Sizer.Add( Low_Label );
   N_Sizer.Add( Low_Edit, 50 );
   N_Sizer.Add( High_Label );
   N_Sizer.Add( High_Edit, 50 );

   TurnsStep_Label.SetText( Tr( u"Máx. turnos por paso:" ) );
   TurnsStep_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   TurnsStep_SpinBox.SetRange( 0, 2000 );
   TurnsStep_SpinBox.SetValue( cfg.maxTurnsStep );
   TurnsStep_SpinBox.SetToolTip( Tr( u"<p>Límite de turnos de Claude (cada lectura o herramienta cuenta uno) en un "
                                 u"paso o en el Prompt. Al llegar, Claude se para. 0 = sin límite.</p>" ) );
   TurnsFull_Label.SetText( Tr( u"Resolución Completa:" ) );
   TurnsFull_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   TurnsFull_SpinBox.SetRange( 0, 5000 );
   TurnsFull_SpinBox.SetValue( cfg.maxTurnsFull );
   TurnsFull_SpinBox.SetToolTip( Tr( u"<p>Límite de turnos para Resolución Completa. 0 = sin límite.</p>" ) );
   Retries_Label.SetText( Tr( u"Intentos fallidos seguidos:" ) );
   Retries_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Retries_SpinBox.SetRange( 0, 20 );
   Retries_SpinBox.SetValue( cfg.maxRetries );
   Retries_SpinBox.SetToolTip( Tr( u"<p>Si una misma operación falla o no mejora este número de veces seguidas, el modelo "
                               u"debe parar y explicar qué pasó en vez de seguir probando. 0 = sin regla.</p>" ) );
   Limits_Sizer.SetSpacing( 6 );
   Limits_Sizer.Add( TurnsStep_Label );
   Limits_Sizer.Add( TurnsStep_SpinBox );
   Limits_Sizer.AddSpacing( 12 );
   Limits_Sizer.Add( TurnsFull_Label );
   Limits_Sizer.Add( TurnsFull_SpinBox );
   Limits_Sizer.AddSpacing( 12 );
   Limits_Sizer.Add( Retries_Label );
   Limits_Sizer.Add( Retries_SpinBox );
   Limits_Sizer.AddStretch();

   Linear_Title.EnableRichText();
   Linear_Title.SetText( Tr( u"<b>Fase Lineal</b>   (paso · base · ajuste · resultado)" ) );
   Linear_Sizer.SetSpacing( 3 );
   Linear_Sizer.Add( Linear_Title );
   for ( const PiCopilotStep& s : PiCopilotStep::Linear() )
      AddRow( Linear_Sizer, s.file, Tr( s.label ), labelWidth );
   Linear_Sizer.AddStretch();

   NonLinear_Title.EnableRichText();
   NonLinear_Title.SetText( Tr( u"<b>Fase No Lineal</b>" ) );
   NonLinear_Sizer.SetSpacing( 3 );
   NonLinear_Sizer.Add( NonLinear_Title );
   for ( const PiCopilotStep& s : PiCopilotStep::NonLinear() )
      AddRow( NonLinear_Sizer, s.file, Tr( s.label ), labelWidth );
   AddRow( NonLinear_Sizer, PiCopilotConfig::FullKey(), Tr( u"Resolución Completa" ), labelWidth );
   NonLinear_Sizer.AddStretch();

   Columns_Sizer.SetSpacing( 24 );
   Columns_Sizer.Add( Linear_Sizer );
   Columns_Sizer.Add( NonLinear_Sizer );

   Default_Button.SetText( Tr( u"Default" ) );
   Default_Button.SetToolTip( Tr( u"<p>N = 95, todos los ajustes a 0 y los modelos por defecto.</p>" ) );
   Default_Button.OnClick( (Button::click_event_handler)&PiCopilotAIConfigDialog::e_Click, *this );
   Save_Button.SetText( Tr( u"Guardar" ) );
   Save_Button.SetDefault();
   Save_Button.OnClick( (Button::click_event_handler)&PiCopilotAIConfigDialog::e_Click, *this );
   Cancel_Button.SetText( Tr( u"Cancelar" ) );
   Cancel_Button.OnClick( (Button::click_event_handler)&PiCopilotAIConfigDialog::e_Click, *this );
   Buttons_Sizer.SetSpacing( 6 );
   Buttons_Sizer.Add( Default_Button );
   Buttons_Sizer.AddStretch();
   Buttons_Sizer.Add( Save_Button );
   Buttons_Sizer.Add( Cancel_Button );

   Global_Sizer.SetMargin( 8 );
   Global_Sizer.SetSpacing( 8 );
   Global_Sizer.Add( Info_Label );
   Global_Sizer.Add( N_Sizer );
   Global_Sizer.Add( Limits_Sizer );
   Global_Sizer.Add( Columns_Sizer );
   Global_Sizer.Add( Buttons_Sizer );

   SetSizer( Global_Sizer );
   SetWindowTitle( Tr( u"PiCopilot - Configurar IA (" ) + model.name + u")" );
   UpdateResults();
   EnsureLayoutUpdated();
   AdjustToContents();
}

void PiCopilotAIConfigDialog::AddRow( VerticalSizer& sizer, const String& key, const String& label, int labelWidth )
{
   Row r;
   r.key = key;
   r.base = m_cfg.BaseScore( key );

   r.name = new Label( label, *this );
   r.name->SetFixedWidth( labelWidth );
   r.name->SetTextAlignment( TextAlign::Left|TextAlign::VertCenter );

   r.baseLabel = new Label( r.base < 0 ? String( u"—" ) : String().Format( "%d", r.base ), *this );
   r.baseLabel->SetFixedWidth( Font().Width( String( "0000" ) ) );
   r.baseLabel->SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   if ( r.base < 0 )
      r.baseLabel->SetToolTip( Tr( u"<p>Este paso aún no tiene valor en la tabla de pesos: usa el modelo superior.</p>" ) );

   r.delta = new SpinBox( *this );
   r.delta->SetRange( -200, 200 );
   r.delta->SetValue( m_cfg.Adjustment( key ) );
   r.delta->SetToolTip( Tr( u"<p>Suma o resta a la puntuación base de este paso.</p>" ) );
   r.delta->OnValueUpdated( (SpinBox::value_event_handler)&PiCopilotAIConfigDialog::e_ValueUpdated, *this );

   r.result = new Label( String(), *this );
   r.result->SetMinWidth( Font().Width( String( u"= 000  gpt-5-mini" ) ) );

   r.sizer = new HorizontalSizer;
   r.sizer->SetSpacing( 6 );
   r.sizer->Add( *r.name );
   r.sizer->Add( *r.baseLabel );
   r.sizer->Add( *r.delta );
   r.sizer->Add( *r.result );
   sizer.Add( *r.sizer );

   m_ownedControls.emplace_back( r.name );
   m_ownedControls.emplace_back( r.baseLabel );
   m_ownedControls.emplace_back( r.delta );
   m_ownedControls.emplace_back( r.result );
   m_ownedSizers.emplace_back( r.sizer );
   m_rows.push_back( r );
}

void PiCopilotAIConfigDialog::UpdateResults()
{
   int n = N_SpinBox.Value();
   String low = Low_Edit.Text().Trimmed();
   String high = High_Edit.Text().Trimmed();
   for ( Row& r : m_rows )
   {
      if ( r.base < 0 )
      {
         r.result->SetText( u"→ " + high );
         continue;
      }
      int score = r.base + r.delta->Value();
      r.result->SetText( String().Format( "= %d  ", score ) + u"→ " + ((score > n) ? low : high) );
   }
}

void PiCopilotAIConfigDialog::e_ValueUpdated( SpinBox& /*sender*/, int /*value*/ )
{
   UpdateResults();
}

void PiCopilotAIConfigDialog::e_Click( Button& sender, bool /*checked*/ )
{
   if ( sender == Default_Button )
   {
      PiCopilotConfig d;
      d.ResetAI();
      N_SpinBox.SetValue( d.threshold );
      Low_Edit.SetText( m_model.IsClaude() ? d.claudeLow : d.openaiLow );
      High_Edit.SetText( m_model.IsClaude() ? d.claudeHigh : d.openaiHigh );
      TurnsStep_SpinBox.SetValue( d.maxTurnsStep );
      TurnsFull_SpinBox.SetValue( d.maxTurnsFull );
      Retries_SpinBox.SetValue( d.maxRetries );
      for ( Row& r : m_rows )
         r.delta->SetValue( 0 );
      UpdateResults();
   }
   else if ( sender == Save_Button )
   {
      m_cfg.threshold = N_SpinBox.Value();
      m_cfg.maxTurnsStep = TurnsStep_SpinBox.Value();
      m_cfg.maxTurnsFull = TurnsFull_SpinBox.Value();
      m_cfg.maxRetries = Retries_SpinBox.Value();
      String low = Low_Edit.Text().Trimmed();
      String high = High_Edit.Text().Trimmed();
      if ( m_model.IsClaude() )
      {
         if ( !low.IsEmpty() ) m_cfg.claudeLow = low;
         if ( !high.IsEmpty() ) m_cfg.claudeHigh = high;
      }
      else
      {
         if ( !low.IsEmpty() ) m_cfg.openaiLow = low;
         if ( !high.IsEmpty() ) m_cfg.openaiHigh = high;
      }
      for ( const Row& r : m_rows )
         m_cfg.SetAdjustment( r.key, r.delta->Value() );
      Ok();
   }
   else if ( sender == Cancel_Button )
      Cancel();
}

// ----------------------------------------------------------------------------
// PiCopilotDossierDialog
// ----------------------------------------------------------------------------

PiCopilotDossierDialog::PiCopilotDossierDialog()
{
   ThePiCopilotDossier = this;
}

PiCopilotDossierDialog::~PiCopilotDossierDialog()
{
   if ( GUI != nullptr )
      delete GUI, GUI = nullptr;
}

IsoString PiCopilotDossierDialog::Id() const
{
   return "PiCopilotDossier";
}

MetaProcess* PiCopilotDossierDialog::Process() const
{
   return ThePiCopilotProcess;
}

String PiCopilotDossierDialog::IconImageSVGFile() const
{
   return "@module_icons_dir/PiCopilot.svg";
}

InterfaceFeatures PiCopilotDossierDialog::Features() const
{
   return InterfaceFeature::None;
}

bool PiCopilotDossierDialog::Launch( const MetaProcess&, const ProcessImplementation*, bool& dynamic, unsigned& /*flags*/ )
{
   if ( GUI == nullptr )
   {
      GUI = new GUIData( *this );
      SetWindowTitle( Tr( u"PiCopilot - Dossier" ) );
      Populate();
   }
   dynamic = false;
   return true;
}

static String MetricsText( const JsonValue& m )
{
   if ( m.type != JsonValue::Object )
      return m.ToText();
   String s;
   for ( const auto& kv : m.o )
   {
      if ( !s.IsEmpty() )
         s << u"  ";
      s << kv.first << u"=" << kv.second.ToText();
   }
   return s;
}

bool PiCopilotDossierDialog::Load( const String& jsonPath, String& whyNot )
{
   IsoString raw;
   try
   {
      raw = File::ReadTextFile( jsonPath );
   }
   catch ( ... )
   {
      whyNot = Tr( u"No se pudo leer " ) + jsonPath;
      return false;
   }
   JsonValue data;
   if ( !JsonValue::Parse( raw, data, whyNot ) )
      return false;
   if ( data.type != JsonValue::Object )
   {
      whyNot = Tr( u"El dossier no es un objeto JSON." );
      return false;
   }

   m_path = jsonPath;
   m_data = data;
   m_recommended = data["recomendado"].ToText();
   Populate();
   return true;
}

void PiCopilotDossierDialog::Populate()
{
   if ( GUI == nullptr || m_path.IsEmpty() )
      return;

   String title = m_data["titulo"].ToText();
   if ( title.IsEmpty() )
      title = u"Dossier";
   GUI->Title_Label.SetText( u"<b>" + title + u"</b>" );

   String analysis = m_data["analisis"].ToText();
   GUI->Analysis_Label.SetText( analysis.IsEmpty() ? String() : Tr( u"Análisis: " ) + analysis );
   GUI->Analysis_Label.SetVisible( !analysis.IsEmpty() );

   GUI->Candidates_TreeBox.Clear();
   const JsonValue& cands = m_data["candidatos"];
   TreeBox::Node* recNode = nullptr;
   for ( size_t i = 0; i < cands.Size(); ++i )
   {
      const JsonValue& c = cands[i];
      TreeBox::Node* node = new TreeBox::Node( GUI->Candidates_TreeBox );
      String view = c["vista"].ToText();
      bool rec = !m_recommended.IsEmpty() && view == m_recommended;
      node->SetText( 0, rec ? String( u"★" ) : String() );
      node->SetText( 1, view );
      node->SetText( 2, c["metodo"].ToText() );
      node->SetText( 3, c["parametros"].ToText() );
      node->SetText( 4, MetricsText( c["metricas"] ) );
      node->SetText( 5, c["notas"].ToText() );
      if ( rec )
      {
         pcl::Font f = GUI->Candidates_TreeBox.Font();
         f.SetBold();
         for ( int col = 0; col < 6; ++col )
            node->SetFont( col, f );
         recNode = node;
      }
   }
   for ( int col = 0; col < 6; ++col )
      GUI->Candidates_TreeBox.AdjustColumnWidthToContents( col );
   if ( recNode != nullptr )
      GUI->Candidates_TreeBox.SetCurrentNode( recNode );
   else if ( GUI->Candidates_TreeBox.NumberOfChildren() > 0 )
      GUI->Candidates_TreeBox.SetCurrentNode( GUI->Candidates_TreeBox.Child( 0 ) );

   String reason = m_data["motivo"].ToText();
   String chosen = m_data["elegido"].ToText();
   String rtext;
   if ( !m_recommended.IsEmpty() )
      rtext << Tr( u"<b>Recomendación del modelo:</b> " ) << m_recommended;
   if ( !reason.IsEmpty() )
      rtext << u"<br/>" << reason;
   if ( !chosen.IsEmpty() )
      rtext << Tr( u"<br/><b>Elegida por ti:</b> " ) << chosen;
   GUI->Recommendation_Label.SetText( rtext );

   GUI->Report_Button.Enable( !m_data["informe"].ToText().IsEmpty() );
}

String PiCopilotDossierDialog::SelectedView() const
{
   if ( GUI == nullptr )
      return String();
   TreeBox::Node* node = GUI->Candidates_TreeBox.CurrentNode();
   return (node != nullptr) ? node->Text( 1 ) : String();
}

// Ids de las vistas principales abiertas en PixInsight.
static StringList OpenViewIds()
{
   StringList ids;
   for ( const ImageWindow& w : ImageWindow::AllWindows() )
      ids << String( w.MainView().Id() );
   return ids;
}

// Vistas ligadas a un candidato: su modelo de fondo ("modelo" en el dossier)
// y, por si el modelo no lo declaró, cualquier vista abierta cuyo id empiece
// por "<candidato>_" (GC_GraXpert_SF10_model, GC_MGC_1024_MGC_gradient_model...).
static StringList RelatedViews( const JsonValue& cand, const StringList& open )
{
   StringList related;
   String id = cand["vista"].ToText();
   if ( id.IsEmpty() )
      return related;
   const JsonValue& model = cand["modelo"];
   if ( model.type == JsonValue::Array )
   {
      for ( size_t i = 0; i < model.Size(); ++i )
         related << model[i].ToText();
   }
   else if ( !model.ToText().IsEmpty() )
      related << model.ToText();
   for ( const String& v : open )
      if ( v.StartsWith( id + '_' ) && !related.Contains( v ) )
         related << v;
   return related;
}

static bool ShowView( const String& viewId )
{
   if ( viewId.IsEmpty() )
      return false;
   View view = View::ViewById( viewId );
   if ( view.IsNull() )
   {
      MessageBox( Tr( u"La vista \"" ) + viewId + Tr( u"\" ya no existe en PixInsight." ), "PiCopilot",
                  StdIcon::Warning, StdButton::Ok ).Execute();
      return false;
   }
   ImageWindow window = view.Window();
   window.Show( false );
   window.BringToFront();
   window.SelectView( view );
   return true;
}

const JsonValue* PiCopilotDossierDialog::Candidate( const String& viewId ) const
{
   const JsonValue& cands = m_data["candidatos"];
   for ( size_t i = 0; i < cands.Size(); ++i )
      if ( cands[i]["vista"].ToText() == viewId )
         return &cands[i];
   return nullptr;
}

void PiCopilotDossierDialog::ShowCandidate( const String& viewId )
{
   // Primero el modelo de fondo (y demás vistas ligadas), luego la imagen
   // corregida encima: quedan las dos a la vista para compararlas.
   const JsonValue* cand = Candidate( viewId );
   if ( cand != nullptr )
      for ( const String& v : RelatedViews( *cand, OpenViewIds() ) )
         if ( !View::ViewById( v ).IsNull() )
         {
            ImageWindow w = View::ViewById( v ).Window();
            w.Show( false );
            w.BringToFront();
         }
   ShowView( viewId );
}

void PiCopilotDossierDialog::e_NodeDoubleClicked( TreeBox& /*sender*/, TreeBox::Node& node, int /*col*/ )
{
   ShowCandidate( node.Text( 1 ) );
}

void PiCopilotDossierDialog::e_Click( Button& sender, bool /*checked*/ )
{
   if ( sender == GUI->View_Button )
   {
      ShowCandidate( SelectedView() );
   }
   else if ( sender == GUI->Use_Button )
   {
      String chosen = SelectedView();
      if ( !ShowView( chosen ) )
         return;

      // Anotar la elección en el dossier para que el modelo pueda continuar.
      bool found = false;
      for ( auto& kv : m_data.o )
         if ( kv.first == "elegido" )
         {
            kv.second.type = JsonValue::Str;
            kv.second.s = chosen;
            found = true;
         }
      if ( !found )
      {
         JsonValue v;
         v.type = JsonValue::Str;
         v.s = chosen;
         m_data.o.emplace_back( String( "elegido" ), v );
      }
      PiCopilotUtil::WriteText( m_path, m_data.ToJson() );
      Console().WriteLn( u"<end><cbr>[PiCopilot] Elegida: " + chosen + u" (dossier: " + m_path + u")" );

      // Qué se cierra: los demás candidatos con sus modelos de fondo, las
      // vistas intermedias que declare el dossier ("intermedias") y cualquier
      // otra vista de la comparativa (prefijo GC_). Se conservan la original,
      // la elegida y el modelo de la elegida.
      StringList open = OpenViewIds();
      String original = m_data["vista"].ToText();
      StringList keep;
      keep << original << chosen;
      if ( const JsonValue* c = Candidate( chosen ) )
         keep << RelatedViews( *c, open );

      StringList others;
      auto addOther = [&]( const String& v )
      {
         if ( !v.IsEmpty() && !keep.Contains( v ) && !others.Contains( v ) && open.Contains( v ) )
            others << v;
      };
      const JsonValue& cands = m_data["candidatos"];
      for ( size_t i = 0; i < cands.Size(); ++i )
      {
         addOther( cands[i]["vista"].ToText() );
         for ( const String& v : RelatedViews( cands[i], open ) )
            addOther( v );
      }
      const JsonValue& inter = m_data["intermedias"];
      for ( size_t i = 0; i < inter.Size(); ++i )
         addOther( inter[i].ToText() );
      for ( const String& v : open )
         if ( v.StartsWith( "GC_" ) )
            addOther( v );

      if ( !others.IsEmpty() )
         if ( MessageBox( Tr( u"Has elegido " ) + chosen + Tr( u".\n\n¿Cierro estas " ) + String().Format( "%d", int( others.Length() ) ) +
                          Tr( u" vistas de la comparativa (candidatos, sus gradientes y pasos intermedios)?\n\n" ) +
                          String().ToSeparated( others, String( u", " ) ) +
                          Tr( u"\n\nSe conservan " ) + original + Tr( u" (original), " ) + chosen + Tr( u" y su modelo." ), "PiCopilot",
                          StdIcon::Question, StdButton::Yes, StdButton::No ).Execute() == StdButton::Yes )
            for ( const String& v : others )
            {
               View view = View::ViewById( v );
               if ( !view.IsNull() && view.IsMainView() )
                  view.Window().ForceClose();
            }

      Populate();
   }
   else if ( sender == GUI->Report_Button )
   {
      String report = m_data["informe"].ToText();
      if ( !report.IsEmpty() )
         ExternalProcess::StartProgram( "explorer.exe", StringList() << File::UnixPathToWindows( report ) );
   }
}

PiCopilotDossierDialog::GUIData::GUIData( PiCopilotDossierDialog& w )
{
   Title_Label.EnableRichText();

   Analysis_Label.EnableWordWrapping();

   Candidates_TreeBox.SetNumberOfColumns( 6 );
   Candidates_TreeBox.SetHeaderText( 0, u"" );
   Candidates_TreeBox.SetHeaderText( 1, Tr( u"Vista" ) );
   Candidates_TreeBox.SetHeaderText( 2, Tr( u"Método" ) );
   Candidates_TreeBox.SetHeaderText( 3, Tr( u"Parámetros" ) );
   Candidates_TreeBox.SetHeaderText( 4, Tr( u"Métricas" ) );
   Candidates_TreeBox.SetHeaderText( 5, Tr( u"Notas" ) );
   Candidates_TreeBox.EnableRootDecoration( false );
   Candidates_TreeBox.EnableAlternateRowColor();
   Candidates_TreeBox.SetScaledMinSize( 900, 380 );
   Candidates_TreeBox.OnNodeDoubleClicked( (TreeBox::node_event_handler)&PiCopilotDossierDialog::e_NodeDoubleClicked, w );

   Recommendation_Label.EnableWordWrapping();
   Recommendation_Label.EnableRichText();

   View_Button.SetText( Tr( u"Ver imagen" ) );
   View_Button.SetToolTip( Tr( u"<p>Trae al frente la imagen del candidato seleccionado (también con doble clic).</p>" ) );
   View_Button.OnClick( (Button::click_event_handler)&PiCopilotDossierDialog::e_Click, w );

   Use_Button.SetText( Tr( u"Usar esta" ) );
   Use_Button.SetToolTip( Tr( u"<p>Elige el candidato seleccionado. Se anota en el dossier y puedes cerrar las demás copias.</p>" ) );
   Use_Button.OnClick( (Button::click_event_handler)&PiCopilotDossierDialog::e_Click, w );

   Report_Button.SetText( Tr( u"Abrir informe" ) );
   Report_Button.OnClick( (Button::click_event_handler)&PiCopilotDossierDialog::e_Click, w );

   Buttons_Sizer.SetSpacing( 6 );
   Buttons_Sizer.Add( View_Button );
   Buttons_Sizer.Add( Use_Button );
   Buttons_Sizer.AddStretch();
   Buttons_Sizer.Add( Report_Button );

   Global_Sizer.SetMargin( 8 );
   Global_Sizer.SetSpacing( 6 );
   Global_Sizer.Add( Title_Label );
   Global_Sizer.Add( Analysis_Label );
   Global_Sizer.Add( Candidates_TreeBox, 100 );
   Global_Sizer.Add( Recommendation_Label );
   Global_Sizer.Add( Buttons_Sizer );

   w.SetSizer( Global_Sizer );
   w.EnsureLayoutUpdated();
   w.AdjustToContents();
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotDialogs.cpp
