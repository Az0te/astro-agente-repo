// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotInterface.cpp - Panel lateral de PiCopilot.
// ----------------------------------------------------------------------------

#include "PiCopilotInterface.h"
#include "PiCopilotDialogs.h"
#include "PiCopilotI18n.h"
#include "PiCopilotJson.h"
#include "PiCopilotParameters.h"
#include "PiCopilotProcess.h"

#include <pcl/Console.h>
#include <pcl/Dialog.h>
#include <pcl/ErrorHandler.h>
#include <pcl/File.h>
#include <pcl/FileDialog.h>
#include <pcl/Settings.h>
#include <pcl/ImageWindow.h>
#include <pcl/MessageBox.h>
#include <pcl/MetaModule.h>
#include <pcl/View.h>

#include <chrono>
#include <regex>
#include <set>

namespace pcl
{

// ----------------------------------------------------------------------------

PiCopilotInterface* ThePiCopilotInterface = nullptr;

// ----------------------------------------------------------------------------

static double NowSeconds()
{
   using namespace std::chrono;
   return duration<double>( steady_clock::now().time_since_epoch() ).count();
}

static String ElapsedText( double seconds )
{
   int s = int( seconds );
   return String().Format( "%02d:%02d", s/60, s%60 );
}

static void CopilotLog( const String& text )
{
   Console().WriteLn( u"<end><cbr>[PiCopilot] " + text );
}

// ----------------------------------------------------------------------------

// Elección de las dos capas de los pasos que combinan dos imágenes (recombinación: starless y estrellas).
// Es un diálogo modal corto: sólo dura lo que tarda el usuario en elegir. Con varias capas parecidas abiertas, Qwen
// elegía una al azar por el nombre (prueba con trampas del 4 nov 2026), y el usuario puede tener seleccionada
// cualquiera de las dos: se piden ambas.
class LayersDialog : public Dialog
{
public:

   LayersDialog( const String& firstWhat, const String& secondWhat, const StringList& candidates, int first, int second )
   {
      Info_Label.SetText( Tr( u"Elige las dos capas que se van a combinar:" ) );
      First_Label.SetText( firstWhat + u":" );
      Second_Label.SetText( secondWhat + u":" );
      int w = Max( First_Label.Font().Width( First_Label.Text() ), Second_Label.Font().Width( Second_Label.Text() ) ) + 8;
      First_Label.SetFixedWidth( w );
      Second_Label.SetFixedWidth( w );
      First_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
      Second_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
      for ( const String& c : candidates )
      {
         First_ComboBox.AddItem( c );
         Second_ComboBox.AddItem( c );
      }
      First_ComboBox.SetCurrentItem( first );
      Second_ComboBox.SetCurrentItem( second );
      First_ComboBox.SetMinWidth( 260 );
      Second_ComboBox.SetMinWidth( 260 );

      First_Sizer.SetSpacing( 6 );
      First_Sizer.Add( First_Label );
      First_Sizer.Add( First_ComboBox, 100 );
      Second_Sizer.SetSpacing( 6 );
      Second_Sizer.Add( Second_Label );
      Second_Sizer.Add( Second_ComboBox, 100 );

      OK_Button.SetText( Tr( u"Usar estas" ) );
      OK_Button.SetDefault();
      OK_Button.OnClick( (Button::click_event_handler)&LayersDialog::e_Click, *this );
      Cancel_Button.SetText( Tr( u"Cancelar" ) );
      Cancel_Button.OnClick( (Button::click_event_handler)&LayersDialog::e_Click, *this );

      Buttons_Sizer.SetSpacing( 8 );
      Buttons_Sizer.AddStretch();
      Buttons_Sizer.Add( OK_Button );
      Buttons_Sizer.Add( Cancel_Button );

      Global_Sizer.SetMargin( 12 );
      Global_Sizer.SetSpacing( 8 );
      Global_Sizer.Add( Info_Label );
      Global_Sizer.Add( First_Sizer );
      Global_Sizer.Add( Second_Sizer );
      Global_Sizer.Add( Buttons_Sizer );

      SetSizer( Global_Sizer );
      SetWindowTitle( Tr( u"PiCopilot: capas" ) );
      AdjustToContents();
      SetFixedSize();
   }

   String First() const { return First_ComboBox.ItemText( First_ComboBox.CurrentItem() ); }
   String Second() const { return Second_ComboBox.ItemText( Second_ComboBox.CurrentItem() ); }

private:

   VerticalSizer   Global_Sizer;
   Label           Info_Label;
   HorizontalSizer First_Sizer;
   Label           First_Label;
   ComboBox        First_ComboBox;
   HorizontalSizer Second_Sizer;
   Label           Second_Label;
   ComboBox        Second_ComboBox;
   HorizontalSizer Buttons_Sizer;
   PushButton      OK_Button;
   PushButton      Cancel_Button;

   void e_Click( Button& sender, bool )
   {
      if ( sender == OK_Button )
      {
         if ( First() == Second() )
         {
            MessageBox( Tr( u"Las dos capas tienen que ser vistas distintas." ), "PiCopilot",
                        StdIcon::Warning, StdButton::Ok ).Execute();
            return;
         }
         Ok();
      }
      else
         Cancel();
   }
};

static bool LooksLikeStars( const String& id )
{
   String l = id.Lowercase();
   return (l.Contains( u"star" ) || l.Contains( u"estrell" )) && !l.Contains( u"starless" ) && !l.Contains( u"sinestrell" );
}

static bool LooksLikeStarless( const String& id )
{
   String l = id.Lowercase();
   return l.Contains( u"starless" ) || l.Contains( u"_sl" ) || l.EndsWith( u"sl" ) || l.Contains( u"sinestrell" );
}

// Pide al usuario la capa principal (starless) y la segunda (estrellas) entre las vistas abiertas del mismo tamaño
// que la seleccionada. Devuelve false si cancela o si no hay al menos dos vistas.
static bool ChooseLayers( const String& firstWhat, const String& secondWhat, const String& selected,
                          String& first, String& second )
{
   View tv = View::ViewById( IsoString( selected ) );
   if ( tv.IsNull() )
      return false;
   ImageVariant ti = tv.Image();
   StringList candidates;
   for ( const ImageWindow& w : ImageWindow::AllWindows() )
   {
      ImageVariant img = w.MainView().Image();
      if ( img.Width() == ti.Width() && img.Height() == ti.Height() )
         candidates << String( w.MainView().Id() );
   }
   if ( candidates.Length() < 2 )
   {
      MessageBox( Tr( u"Para este paso hacen falta dos vistas abiertas del mismo tamaño: la " ) + firstWhat + Tr( u" y la " ) +
                  secondWhat + u".", "PiCopilot", StdIcon::Information, StdButton::Ok ).Execute();
      return false;
   }
   // Propuesta inicial: la seleccionada va donde encaja por el nombre; la otra, la primera que encaje.
   int iSel = 0;
   for ( size_type i = 0; i < candidates.Length(); ++i )
      if ( candidates[i] == selected )
         iSel = int( i );
   int i1 = -1, i2 = -1;
   if ( LooksLikeStars( selected ) )
      i2 = iSel;
   else
      i1 = iSel;
   for ( size_type i = 0; i < candidates.Length(); ++i )
   {
      if ( i1 < 0 && int( i ) != i2 && LooksLikeStarless( candidates[i] ) )
         i1 = int( i );
      if ( i2 < 0 && int( i ) != i1 && LooksLikeStars( candidates[i] ) )
         i2 = int( i );
   }
   if ( i1 < 0 )
      i1 = (i2 == 0) ? 1 : 0;
   if ( i2 < 0 )
      i2 = (i1 == 0) ? 1 : 0;

   LayersDialog d( firstWhat, secondWhat, candidates, i1, i2 );
   if ( d.Execute() != StdDialogCode::Ok )
      return false;
   first = d.First();
   second = d.Second();
   return true;
}
// ----------------------------------------------------------------------------

PiCopilotInterface::PiCopilotInterface()
   : m_instance( ThePiCopilotProcess )
{
   ThePiCopilotInterface = this;
}

// ----------------------------------------------------------------------------

PiCopilotInterface::~PiCopilotInterface()
{
   if ( m_process && m_process->IsRunning() )
      m_process->Kill();
   if ( GUI != nullptr )
      delete GUI, GUI = nullptr;
}

// ----------------------------------------------------------------------------

IsoString PiCopilotInterface::Id() const
{
   return "PiCopilot";
}

// ----------------------------------------------------------------------------

MetaProcess* PiCopilotInterface::Process() const
{
   return ThePiCopilotProcess;
}

// ----------------------------------------------------------------------------

String PiCopilotInterface::IconImageSVGFile() const
{
   return "@module_icons_dir/PiCopilot.svg";
}

// ----------------------------------------------------------------------------

InterfaceFeatures PiCopilotInterface::Features() const
{
   // Panel de herramientas: sin botones de aplicar ni icono de instancia.
   return InterfaceFeature::None;
}

// ----------------------------------------------------------------------------

void PiCopilotInterface::ApplyInstance() const
{
}

// ----------------------------------------------------------------------------

void PiCopilotInterface::ResetInstance()
{
   PiCopilotInstance defaultInstance( ThePiCopilotProcess );
   ImportProcess( defaultInstance );
}

// ----------------------------------------------------------------------------

bool PiCopilotInterface::Launch( const MetaProcess& P, const ProcessImplementation*, bool& dynamic, unsigned& /*flags*/ )
{
   if ( GUI == nullptr )
   {
      m_cfg.Load();
      PiCopilotUtil::CleanTemp( m_cfg.TempDir() );   // previas y scripts temporales de sesiones anteriores
      GUI = new GUIData( *this );
      SetWindowTitle( "PiCopilot" );
      UpdateModelList();
      UpdateControls();
      GUI->UpdateTimer.Start();
   }

   UpdateView();
   dynamic = false;
   return &P == ThePiCopilotProcess;
}

// ----------------------------------------------------------------------------

ProcessImplementation* PiCopilotInterface::NewProcess() const
{
   return new PiCopilotInstance( m_instance );
}

// ----------------------------------------------------------------------------

bool PiCopilotInterface::ValidateProcess( const ProcessImplementation& p, String& whyNot ) const
{
   if ( dynamic_cast<const PiCopilotInstance*>( &p ) != nullptr )
      return true;
   whyNot = "Not a PiCopilot instance.";
   return false;
}

// ----------------------------------------------------------------------------

bool PiCopilotInterface::RequiresInstanceValidation() const
{
   return true;
}

// ----------------------------------------------------------------------------

bool PiCopilotInterface::ImportProcess( const ProcessImplementation& p )
{
   m_instance.Assign( p );
   return true;
}

// ----------------------------------------------------------------------------

bool PiCopilotInterface::WantsImageNotifications() const
{
   return true;
}

// ----------------------------------------------------------------------------

void PiCopilotInterface::ImageFocused( const View& )
{
   if ( GUI != nullptr )
      UpdateView();
}

// ----------------------------------------------------------------------------
// Estado de la interfaz
// ----------------------------------------------------------------------------

void PiCopilotInterface::UpdateView()
{
   ImageWindow w = ImageWindow::ActiveWindow();
   m_viewId = w.IsNull() ? String() : String( w.CurrentView().FullId() );
   if ( GUI != nullptr )
      GUI->View_Label.SetText( Tr( u"Imagen: " ) + (m_viewId.IsEmpty() ? String( Tr( u"(ninguna)" ) ) : m_viewId) );
   if ( m_chat )
      m_chat->SetContext( m_cfg.Current().name, m_viewId );
}

void PiCopilotInterface::UpdateModelList()
{
   GUI->Model_ComboBox.Clear();
   for ( const PiCopilotModel& m : m_cfg.models )
      GUI->Model_ComboBox.AddItem( m.name );
   GUI->Model_ComboBox.SetCurrentItem( m_cfg.currentModel );
}

void PiCopilotInterface::UpdateControls()
{
   const PiCopilotModel& model = m_cfg.Current();

   GUI->RemoveModel_ToolButton.Enable( !model.builtin && !m_busy );
   GUI->AddModel_ToolButton.Enable( !m_busy );
   GUI->Model_ComboBox.Enable( !m_busy );

   for ( auto& b : GUI->linearButtons )
      b->Enable( !m_busy );
   for ( auto& b : GUI->nonLinearButtons )
      b->Enable( !m_busy );

   // "Resolución Completa" sólo con Claude o Codex (modelos en la nube).
   if ( m_fullVisible != model.IsCloud() )
   {
      m_fullVisible = model.IsCloud();
      GUI->Full_Button.SetVisible( m_fullVisible );
      SetVariableHeight();
      EnsureLayoutUpdated();
      AdjustToContents();
      SetFixedHeight();
   }
   GUI->Full_Button.Enable( !m_busy );

   // "Configurar IA" sólo con Claude o Codex (modelo inferior / superior).
   bool tiers = PiCopilotConfig::HasTiers( model );
   if ( m_aiVisible != tiers )
   {
      m_aiVisible = tiers;
      GUI->AIConfig_Button.SetVisible( tiers );
      SetVariableHeight();
      EnsureLayoutUpdated();
      AdjustToContents();
      SetFixedHeight();
   }
   GUI->AIConfig_Button.Enable( !m_busy );

   GUI->Guide_Edit.SetText( m_cfg.guideDir );
   GUI->Work_Edit.SetText( m_cfg.workDir );
   GUI->Claude_Edit.SetText( m_cfg.claudePath );
   GUI->ClaudeArgs_Edit.SetText( m_cfg.claudeArgs );
   GUI->Watcher_Edit.SetText( m_cfg.watcherSource );
   GUI->Data_Edit.SetText( m_cfg.dataDirs );
   GUI->Mcp_CheckBox.SetChecked( m_cfg.watcherEnabled );

   UpdateStatus();
   UpdateMcpStatus();

   if ( m_chat )
   {
      m_chat->SetBusy( m_busy );
      m_chat->SetContext( model.name, m_viewId );
   }
}

void PiCopilotInterface::UpdateStatus()
{
   if ( GUI == nullptr )
      return;
   if ( m_busy )
   {
      GUI->Status_Label.SetText( m_job.model.name + u": " + m_job.title + u"  (" +
                                 ElapsedText( NowSeconds() - m_job.startTime ) + u")" );
      GUI->Cancel_Button.Show();
   }
   else if ( m_scriptRunning )
   {
      GUI->Status_Label.SetText( Tr( u"Ejecutando el script en PixInsight… (progreso en la consola)" ) );
      GUI->Cancel_Button.Hide();
   }
   else
   {
      GUI->Status_Label.SetText( m_scriptWaiting ? String( Tr( u"Plan listo: PULSE «Ejecutar script» para continuar." ) )
                                                 : String( Tr( u"Listo." ) ) );
      GUI->Cancel_Button.Hide();
   }
}

PiCopilotChatDialog& PiCopilotInterface::Chat()
{
   if ( !m_chat )
   {
      m_chat = ThePiCopilotChat;
      m_chat->SetContext( m_cfg.Current().name, m_viewId );
      m_chat->SetBusy( m_busy );
   }
   return *m_chat;
}

void PiCopilotInterface::ShowDossier( const String& path )
{
   if ( !m_dossier )
      m_dossier = ThePiCopilotDossier;
   String whyNot;
   if ( !m_dossier->Load( path, whyNot ) )
   {
      CopilotLog( u"No se pudo abrir el dossier " + path + u": " + whyNot );
      return;
   }
   m_dossier->Launch();
}

bool PiCopilotInterface::EnsureDir( const String& dir )
{
   try
   {
      if ( !File::DirectoryExists( dir ) )
         File::CreateDirectory( dir, true );
      return true;
   }
   catch ( ... )
   {
      CopilotLog( u"No se pudo crear la carpeta " + dir );
      return false;
   }
}

String PiCopilotInterface::NewDossierPath( const String& tag )
{
   String dir = m_cfg.DossierDir();
   EnsureDir( dir );
   String view = m_viewId;
   view.ReplaceString( "->", "_" );
   return PiCopilotUtil::JoinPath( dir, tag + u"_" + (view.IsEmpty() ? String( "imagen" ) : view) +
                                        u"_" + PiCopilotUtil::NewId() + u".json" );
}

// ----------------------------------------------------------------------------
// Lanzar tareas
// ----------------------------------------------------------------------------

// ¿Pide el usuario una serie de pasos (que se ejecuten seguidos) o un paso y esperar? (Rafael, 7 nov 2026: "si le pides
// que haga una serie de pasos, seguidos; si le pides que espere tu confirmación o que le recomiende el siguiente paso,
// como antes".) Pedir que espere manda sobre todo lo demás.
bool PiCopilotInterface::WantsSeries( const String& text )
{
   String t = text.Lowercase();
   t.ReplaceString( u"á", u"a" );
   t.ReplaceString( u"é", u"e" );
   t.ReplaceString( u"í", u"i" );
   t.ReplaceString( u"ó", u"o" );
   t.ReplaceString( u"ú", u"u" );
   t.ReplaceString( u"ü", u"u" );
   static const char* esperar[] = { "espera", "confirm", "recomienda", "recomiendame", "siguiente paso", "proximo paso",
                                    "paso a paso", "uno a uno", "de uno en uno", "antes de seguir", "antes de continuar",
                                    "preguntame", "dime que", "que me recomiendas", "solo el paso", "solo este paso",
                                    "no sigas", "no continues" };
   for ( const char* w : esperar )
      if ( t.Contains( String( w ) ) )
         return false;
   static const char* serie[] = { "completa", "entera", "de principio a fin", "hasta el final", "hasta acabar",
                                  "hasta terminar", "todos los pasos", "todo el procesado", "procesado completo",
                                  "procesala", "procesalo", "resuelve", "resuelvel", "serie de pasos", "varios pasos",
                                  "los pasos", "pasos del", "pasos de", "hasta el paso", "hasta la", "hasta el", "seguido",
                                  "del paso", "y luego", "y despues", "y despues de", "a continuacion" };
   for ( const char* w : serie )
      if ( t.Contains( String( w ) ) )
         return true;
   return false;
}

void PiCopilotInterface::QueueJob( JobKind kind, const String& title, const String& prompt )
{
   m_queued.pending = true;
   m_queued.kind = kind;
   m_queued.title = title;
   m_queued.prompt = prompt;
   CopilotLog( u"En cola: " + title );
}

void PiCopilotInterface::StopAutoChain( const String& why )
{
   bool was = m_autoChain || m_autoRunPending;
   m_autoChain = m_autoRunPending = false;
   m_autoScript.Clear();
   if ( was )
      Chat().AppendInfo( Tr( u"Serie de pasos terminada (" ) + why + String().Format( "; %d scripts).", m_autoSteps ) );
}

String PiCopilotInterface::AutoNextText() const
{
   return u"\n\nSERIE DE PASOS EN MARCHA. Lo que pidió el usuario: «" + m_autoGoal + u"». Scripts ya ejecutados en la serie: " +
          String().Format( "%d", m_autoSteps ) + u".\n"
          u"Haz el resumen del paso CORTO (como mucho 10 líneas). Después, en la misma respuesta, escribe el script del "
          u"SIGUIENTE paso que falte (UNO solo, en el orden de la guía) en un único bloque ```javascript, con los ids de vista "
          u"que acaba de devolver este resultado: PiCopilot lo ejecutará sin esperar al usuario, así que no le preguntes si "
          u"quiere seguir. Si ya están hechos todos los pasos pedidos, o una medida indica un problema que el usuario tiene "
          u"que decidir (no algo que se arregla repitiendo el paso con otros parámetros), NO escribas script: escribe una "
          u"línea que empiece por «PARO:» con el motivo.";
}

void PiCopilotInterface::LaunchStep( const PiCopilotStep& step )
{
   UpdateView();
   m_autoChain = m_autoRunPending = false;   // un botón de paso es un solo paso
   if ( step.needsImage && m_viewId.IsEmpty() )
   {
      MessageBox( Tr( u"Selecciona primero la imagen sobre la que quieres ejecutar \"" ) + step.label + Tr( u"\"." ),
                  "PiCopilot", StdIcon::Information, StdButton::Ok ).Execute();
      return;
   }

   // Pasos que combinan dos capas: el usuario elige las dos (la seleccionada puede ser cualquiera de ellas).
   String target = m_viewId, second;
   String what = PiCopilotPrompts::SecondLayer( step );
   // En el estirado la capa de estrellas es opcional: con una sola vista de ese tamaño se estira sólo la starless
   // (Rafael, 5 nov 2026: "me basta con la starless").
   bool soloStarless = false;
   if ( !what.IsEmpty() && !m_viewId.IsEmpty() && step.file == "no-lineal/01-estirado.md" )
   {
      View tv = View::ViewById( IsoString( m_viewId ) );
      int n = 0;
      if ( !tv.IsNull() )
      {
         ImageVariant ti = tv.Image();
         for ( const ImageWindow& w : ImageWindow::AllWindows() )
         {
            ImageVariant img = w.MainView().Image();
            if ( img.Width() == ti.Width() && img.Height() == ti.Height() )
               ++n;
         }
      }
      soloStarless = n < 2;
   }
   if ( !what.IsEmpty() && !m_viewId.IsEmpty() && !soloStarless )
   {
      if ( !ChooseLayers( Tr( u"Starless (sin estrellas)" ), Tr( u"Capa de estrellas" ), m_viewId, target, second ) )
         return;
      m_viewId = target;   // la tarea va "sobre" la starless elegida
   }

   // Pasos con ficheros (inventario, selección, preprocesado): el usuario elige la carpeta de datos.
   // Puede ser más de una (varias noches, o lights en carpetas distintas): se van añadiendo hasta decir que no.
   String dataFolder, folderWhat = PiCopilotPrompts::DataFolder( step );
   if ( !folderWhat.IsEmpty() )
   {
      String last;
      Settings::Read( "DataFolder", last );
      StringList folders;
      for ( ;; )
      {
         GetDirectoryDialog d;
         d.SetCaption( folders.IsEmpty() ? Tr( folderWhat ) : Tr( u"Otra carpeta" ) );
         if ( !last.IsEmpty() )
            d.SetInitialPath( last );
         if ( !d.Execute() )
         {
            if ( folders.IsEmpty() )
               return;
            break;
         }
         last = d.Directory();
         folders << last;
         String list;
         for ( const String& f : folders )
            list << u"\n" << f;
         if ( MessageBox( Tr( u"Carpetas elegidas:" ) + list + u"\n\n" + Tr( u"¿Añadir otra carpeta?" ), "PiCopilot",
                          StdIcon::Question, StdButton::No, StdButton::Yes ).Execute() != StdButton::Yes )
            break;
      }
      Settings::Write( "DataFolder", last );
      dataFolder = String().ToSeparated( folders, '|' );
   }

   String dossierPath;
   if ( step.comparative )
      dossierPath = NewDossierPath( "gradiente" );

   bool newSession = EnterPhase( step.linear ? "lineal" : "no-lineal" ) || m_cfg.Current().IsCodex();   // Codex: sesión nueva en cada tarea
   String prompt = PiCopilotPrompts::Step( m_cfg, m_cfg.Current(), step, target, dossierPath, newSession, second, dataFolder );
   if ( StartJob( JobKind::Step, Tr( step.label ), prompt, true, step.file ) )
      if ( !dossierPath.IsEmpty() )
         m_pendingDossiers.push_back( { dossierPath, NowSeconds() } );
}

void PiCopilotInterface::LaunchFull()
{
   UpdateView();
   if ( m_viewId.IsEmpty() )
   {
      MessageBox( Tr( u"Selecciona primero la imagen que quieres procesar." ), "PiCopilot",
                  StdIcon::Information, StdButton::Ok ).Execute();
      return;
   }
   if ( MessageBox( Tr( u"El modelo va a procesar \"" ) + m_viewId + Tr( u"\" de principio a fin siguiendo la guía. "
                    u"Puede tardar bastante y crear varias vistas nuevas.\n\n¿Continuar?" ), "PiCopilot",
                    StdIcon::Question, StdButton::Yes, StdButton::No ).Execute() != StdButton::Yes )
      return;

   EnterPhase( "completa" );
   String dossierPath = NewDossierPath( "completa" );
   String prompt = PiCopilotPrompts::Full( m_cfg, m_cfg.Current(), m_viewId, dossierPath );
   if ( StartJob( JobKind::Full, Tr( u"Resolución Completa" ), prompt, true, PiCopilotConfig::FullKey() ) )
   {
      m_pendingDossiers.push_back( { dossierPath, NowSeconds(), true } );
      if ( !m_cfg.Current().IsAgent() )
      {
         m_autoChain = true;
         m_autoRunPending = false;
         m_autoSteps = 0;
         m_autoGoal = u"Resolución completa de la vista " + m_viewId + u", de principio a fin.";
         Chat().AppendInfo( Tr( u"Serie de pasos: PiCopilot ejecutará cada script y pedirá el siguiente sin esperar. "
                                u"Pulsa «Cancelar» mientras el modelo piensa para pararla." ) );
      }
   }
}

bool PiCopilotInterface::SubmitChat( const String& text )
{
   UpdateView();
   bool firstTurn = m_cfg.Current().IsClaude() ? !m_claudeSessionStarted : (m_cfg.Current().IsCodex() || m_history.empty());
   // Modelos HTTP: al recortar la conversación para que quepa en el contexto se quita primero el mensaje más antiguo, que
   // es el que lleva el contexto de PiCopilot (vistas, funciones de la guía). Sin él, Qwen contestó (6 nov 2026) que no
   // tenía acceso a las imágenes abiertas. Si ya no está en el historial, se vuelve a mandar entero.
   if ( !firstTurn && !m_cfg.Current().IsAgent() )
   {
      bool found = false;
      for ( const PiCopilotChatMessage& m : m_history )
         if ( m.role == "user" && m.content.StartsWith( u"[Contexto de PiCopilot" ) )
         {
            found = true;
            break;
         }
      firstTurn = !found;
   }
   String prompt = PiCopilotPrompts::Free( m_cfg, m_cfg.Current(), text, m_viewId, firstTurn );
   bool series = !m_cfg.Current().IsAgent() && WantsSeries( text );
   if ( series )
      prompt << u"\n\n(PiCopilot ejecutará tus scripts uno tras otro sin esperar al usuario: escribe ahora sólo el script "
                u"del PRIMER paso; después de cada resultado te pediré el siguiente.)";
   if ( !StartJob( JobKind::Chat, Tr( u"Prompt" ), prompt, false ) )
      return false;
   m_autoRunPending = false;
   m_autoChain = series;
   if ( series )
   {
      m_autoSteps = 0;
      m_autoGoal = text;
   }
   // La respuesta llega por eventos, así que esto siempre se muestra antes.
   Chat().AppendUser( text );
   return true;
}

bool PiCopilotInterface::EnterPhase( const String& phase )
{
   // La guía usa una sesión por fase: al pasar de la lineal a la no lineal (o
   // a Resolución Completa) se empieza una sesión nueva de Claude, para no
   // arrastrar el contexto de la fase anterior.
   if ( !m_cfg.Current().IsAgent() )
      return false;
   if ( m_claudeSessionStarted && !m_claudePhase.IsEmpty() && m_claudePhase != phase )
   {
      ResetChat();
      Chat().AppendInfo( Tr( u"--- Sesión nueva de Claude para la fase " ) + phase + u" ---" );
   }
   bool isNew = !m_claudeSessionStarted;
   m_claudePhase = phase;
   return isNew;
}

void PiCopilotInterface::ResetChat()
{
   m_scriptFixes = 0;
   m_autoChain = m_autoRunPending = false;
   m_autoScript.Clear();
   m_queued.pending = false;
   m_claudePhase.Clear();
   m_history.clear();
   m_claudeSession.Clear();
   m_claudeSessionStarted = false;
   CleanTempFiles();
}

void PiCopilotInterface::CleanTempFiles()
{
   PiCopilotUtil::CleanTemp( m_cfg.TempDir() );
}

// Texto entre comillas que sigue a 'key' en un JSON (sin parsearlo entero), o vacío.
static String JsonStringAfter( const String& json, const String& key )
{
   size_type p = json.Find( key );
   if ( p == String::notFound )
      return String();
   p += key.Length();
   size_type q = json.Find( '"', p );
   if ( q == String::notFound )
      return String();
   return json.Substring( p, q - p );
}

// Modelos que aceptan imágenes: los de la nube (OpenAI) y Qwen 3.8, que en Ollama trae su codificador de imagen.
static bool ModelSeesImages( const PiCopilotModel& m )
{
   if ( m.IsCloud() )
      return true;
   String id = m.model.Lowercase();
   return id.Contains( u"qwen38" ) || id.Contains( u"qwen3.8" ) || id.Contains( u"-vl" ) || id.Contains( u"vision" );
}

String PiCopilotInterface::MakePreview( const String& viewId )
{
   String path = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"prev_" + PiCopilotUtil::NewId() + u".jpg" );
   String p = path;
   p.ReplaceString( u"\\", u"/" );
   String code =
      u"(function () {\n"
      u"var v = View.viewById(\"" + viewId + u"\"); if (!v || v.isNull) return 0;\n"
      u"var im = v.image; im.resetSelections();\n"
      u"var f = Math.max(1, Math.round(im.width / 640));\n"
      u"var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, \"PiCopilotPrev\");\n"
      u"w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();\n"
      u"if (f > 1) { var I = new IntegerResample; I.zoomFactor = -f; I.executeOn(w.mainView); }\n"
      u"w.saveAs(\"" + p + u"\", false, false, false, false); w.forceClose(); return 1; })();";
   try
   {
      Module->EvaluateScript( code, "JavaScript" );
      if ( File::Exists( path ) )
         return path;   // queda en la carpeta temporal de PiCopilot (unos 50 kB)
   }
   catch ( ... )
   {
   }
   CopilotLog( u"No se pudo generar la vista previa de " + viewId );
   return String();
}

String PiCopilotInterface::MakeComparePreview( const String& viewId, const String& refId, bool model )
{
   String path = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"cmp_" + PiCopilotUtil::NewId() + u".jpg" );
   String p = path;
   p.ReplaceString( u"\\", u"/" );
   String code =
      u"(function () {\n"
      u"var v = View.viewById(\"" + viewId + u"\"); if (!v || v.isNull) return 0;\n"
      u"var r = View.viewById(\"" + refId + u"\"); if (!r || r.isNull) r = v;\n"
      // Estirado por canal si los canales están muy desequilibrados (lineal sin calibrar color: enlazado se ve todo
      // azul, Rafael 5 nov 2026); enlazado si están equilibrados (no cambia el color real).
      u"var ri = r.image, n = ri.numberOfChannels, meds = [], mads = [];\n"
      u"for (var c = 0; c < n; ++c) { ri.selectedChannel = c; meds.push(ri.median()); mads.push(1.4826 * ri.MAD()); } ri.resetSelections();\n"
      u"var mn = Math.min.apply(null, meds), mx = Math.max.apply(null, meds), link = mn > 0 && mx / mn < 1.25;\n"
      u"var ex = []; for (var c = 0; c < n; ++c) { var md = link ? meds.reduce(function (a, b) { return a + b; }, 0) / n : meds[c],\n"
      u"  ma = link ? mads.reduce(function (a, b) { return a + b; }, 0) / n : mads[c], sh = Math.max(0, md - 2.8 * ma), m = Math.mtf(0.20, md - sh);\n"
      u"  ex.push(\"mtf(\" + m + \", max(0, ($T - \" + sh + \")/(1 - \" + sh + \")))\"); }\n"
      u"var im = v.image; im.resetSelections();\n"
      u"var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, \"PiCopilotCmp\");\n"
      u"w.mainView.beginProcess(); w.mainView.image.assign(im); w.mainView.endProcess();\n"
      u"var f = Math.max(1, Math.round(im.width / 480)); if (f > 1) { var I = new IntegerResample; I.zoomFactor = -f; I.executeOn(w.mainView); }\n"
      u"var P = new PixelMath; P.rescale = false; P.truncate = true;\n"
      + String( model ?
      // Modelo: cada canal normalizado a su propio mínimo y máximo, para ver su forma (no su color).
      u"var wi = w.mainView.image, mex = []; for (var c = 0; c < wi.numberOfChannels; ++c) { wi.selectedChannel = c;\n"
      u"  var lo = wi.minimum(), hi = wi.maximum(); mex.push(\"(($T - \" + lo + \")/\" + Math.max(1e-12, hi - lo) + \")^0.7\"); } wi.resetSelections();\n"
      u"P.useSingleExpression = mex.length < 3; P.expression = mex[0]; if (mex.length >= 3) { P.expression1 = mex[1]; P.expression2 = mex[2]; }\n"
      : u"P.useSingleExpression = ex.length < 3; P.expression = ex[0]; if (ex.length >= 3) { P.expression1 = ex[1]; P.expression2 = ex[2]; }\n" ) +
      u"P.executeOn(w.mainView);\n"
      u"w.saveAs(\"" + p + u"\", false, false, false, false); w.forceClose(); return 1; })();";
   try
   {
      Module->EvaluateScript( code, "JavaScript" );
      if ( File::Exists( path ) )
         return path;
   }
   catch ( ... )
   {
   }
   return String();
}

std::vector<std::pair<String, String>> PiCopilotInterface::CandidatePreviews( const String& out )
{
   std::vector<std::pair<String, String>> imgs;
   size_type p = out.Find( '{' ), q = out.FindLast( '}' );
   if ( p == String::notFound || q == String::notFound || q < p )
      return imgs;
   JsonValue r; String why;
   if ( !JsonValue::Parse( out.Substring( p, q - p + 1 ).ToUTF8(), r, why ) )
      return imgs;
   const JsonValue& cand = r["candidatos"];
   if ( cand.type != JsonValue::Array || cand.a.empty() )
      return imgs;
   String ref = r["vista"].s, rec = r["recomendado"].s;
   if ( !ref.IsEmpty() )
   {
      String a = MakeComparePreview( ref, ref, false );
      if ( !a.IsEmpty() ) imgs.push_back( { ref + Tr( u" (original)" ), a } );
   }
   for ( size_t i = 0; i < cand.a.size() && i < 10; ++i )
   {
      const JsonValue& c = cand.a[i];
      String v = c["vista"].s, m = c["modelo"].s;
      String label = v;
      const JsonValue& met = c["metricas"];
      if ( met.type == JsonValue::Object )
      {
         if ( !met["come_objeto_pct"].IsNull() ) label << Tr( u" · come " ) << met["come_objeto_pct"].ToText() << u" %";
         if ( !met["fondoResidual"].IsNull() ) label << Tr( u" · cielo " ) << String().Format( "%.0f", 100 * met["fondoResidual"].n ) << u" %";
      }
      if ( v == rec ) label << Tr( u" · RECOMENDADO" );
      if ( !v.IsEmpty() )
      {
         String a = MakeComparePreview( v, ref.IsEmpty() ? v : ref, false );
         if ( !a.IsEmpty() ) imgs.push_back( { label, a } );
      }
      if ( !m.IsEmpty() )
      {
         String b = MakeComparePreview( m, m, true );
         if ( !b.IsEmpty() ) imgs.push_back( { Tr( u"Gradiente de " ) + v + u" (modelo)", b } );
      }
   }
   return imgs;
}

void PiCopilotInterface::RunScript( const String& code, bool ask )
{
   int lines = 1;
   for ( String::const_iterator i = code.Begin(); i != code.End(); ++i )
      if ( *i == '\n' )
         ++lines;
   if ( ask && MessageBox( Tr( u"Se va a ejecutar en PixInsight el script de la respuesta (" ) + String().Format( "%d", lines ) + Tr( u" líneas).\n\n"
                    u"Revísalo antes en la ventana de Prompt. ¿Ejecutarlo ahora?" ), "PiCopilot",
                    StdIcon::Warning, StdButton::Yes, StdButton::No ).Execute() != StdButton::Yes )
      return;

   CopilotLog( u"Ejecutando el script de la respuesta..." );
   m_scriptWaiting = false;
   // El script corre en este mismo hilo: el estado se pinta antes y se fuerza el repintado, si no el panel seguía en
   // "Listo." hasta el final (Rafael, 6 nov 2026). El guard lo devuelve a su estado aunque el script falle.
   m_scriptRunning = true;
   struct RunningGuard { PiCopilotInterface* p; ~RunningGuard() { p->m_scriptRunning = false; p->UpdateStatus(); } } runningGuard{ this };
   UpdateStatus();
   if ( GUI != nullptr )
      GUI->Status_Label.Repaint();
   Module->ProcessEvents();
   try
   {
      // Los modelos sin MCP escriben a menudo console.log, que no existe en
      // PJSR y aborta el script en la primera línea (prueba del 3 nov 2026).
      // PICOPILOT_GUIA: carpeta de la guía, para que las funciones de herramientas/ carguen lo que necesiten
      // (recombinacion.js carga realces.js si screenStarsCombine no existe).
      String guia = m_cfg.guideDir;
      guia.ReplaceString( u"\\", u"/" );
      String prelude = u"if (typeof console.log !== \"function\") console.log = function (m) { console.writeln(m); };\n"
                       u"var PICOPILOT_GUIA = \"" + guia + u"\";\n"
                       // Qwen se inventó herramientas/checkpoint.js (6 nov 2026) y el script entero abortó: con las funciones
                       // ya cargadas, un fichero de herramientas/ que no existe se avisa y se salta.
                       u"(function () { if (File.__pcLeer) return; var leer = File.readTextFile; try { File.__pcLeer = leer; File.readTextFile = function (p) { var s = String(p);\n"
                       u"  if (s.indexOf(\"herramientas\") >= 0 && s.substring(s.length - 3) == \".js\" && !File.exists(s)) {\n"
                       u"    console.warningln(\"[PiCopilot] \" + s + \" no existe; las funciones de la guía ya están cargadas: lo salto.\"); return \"\"; }\n"
                       u"  return leer.call(File, p); }; } catch (e) {} })();\n";
      // El script va dentro de un eval con try/catch: así los errores (también los de sintaxis, como un return en el
      // nivel superior) llegan con su mensaje y su línea, en vez del "API function error" de PixInsight, con el que
      // Qwen repetía el mismo script sin saber qué corregir (prueba del 5 nov 2026).
      String wrapped = prelude +
         u"var __pcRes;\ntry { __pcRes = eval(" + JsonValue::Quote( code ) + u"); }\n"
         u"catch (__pcErr) { __pcRes = \"PICOPILOT_ERROR: \" + ((__pcErr && __pcErr.message) ? __pcErr.message : String(__pcErr)) + "
         u"((__pcErr && __pcErr.lineNumber) ? \" (línea \" + __pcErr.lineNumber + \" del script)\" : \"\"); }\n__pcRes;";
      String out;
      // Vistas abiertas antes del script, para enseñar después las que haya creado (petición de Rafael, 5 nov 2026).
      String viewsBefore;
      try
      {
         Variant vb = Module->EvaluateScript( u"ImageWindow.windows.map(function (w) { return w.mainView.id; }).join(\"|\");", "JavaScript" );
         if ( vb.IsValid() )
            viewsBefore = vb.ToString();
      }
      catch ( ... ) {}
      // blindSolve, también a través de las funciones de lineal.js que lo usan.
      // alinearMasters también resuelve la astrometría (6 nov 2026: sin esto la dejaba sin resolver en silencio).
      // Build 80: con el runner de picopilot, todos los scripts corren sobre él (todas las funciones de la guía ya
      // cargadas por #include). Sin runner, sólo los que necesitan blindSolve van por el watcher, como antes.
      if ( !m_cfg.PicopilotRunner().IsEmpty() ||
           code.Contains( u"blindSolve" ) || code.Contains( u"resolverAstrometria" ) || code.Contains( u"bxtCorrectOnly" ) ||
           code.Contains( u"alinearMasters" ) )
         out = RunWithWatcher( code, prelude ).Trimmed();   // necesita el motor de BlindSolver (#include)
      else
      {
         Variant result = Module->EvaluateScript( wrapped, "JavaScript" );
         out = result.IsValid() ? result.ToString().Trimmed() : String();
      }
      CopilotLog( u"Script terminado." );
      if ( out.StartsWith( u"PICOPILOT_ERROR: " ) )
         throw Error( out.Substring( 17 ) );
      m_lastFailedScript.Clear();
      // Enseña las vistas nuevas: las muestra (algunas funciones las crean ocultas), pone un STF automático a las
      // lineales que no lo tengan (sólo visual) y deja delante la última. Las ya estiradas se ven tal cual.
      try
      {
         Module->EvaluateScript(
            u"(function () { var antes = " + JsonValue::Quote( viewsBefore ) + u".split(\"|\"), nuevas = [];\n"
            u"ImageWindow.windows.forEach(function (w) { if (antes.indexOf(w.mainView.id) < 0) nuevas.push(w); });\n"
            // STF ENLAZADO (los mismos parámetros en R, G y B): por canal desequilibraba los colores (Rafael, 5 nov 2026).
            // Por canal sólo si los canales están muy desequilibrados (lineal sin calibrar color).
            u"nuevas.forEach(function (w) { var v = w.mainView, im = v.image, lineal = true, meds = [], mads = [], n = im.numberOfChannels;\n"
            u"  for (var c = 0; c < n; ++c) { im.selectedChannel = c; var m = im.median(); if (m > 0.08) lineal = false; meds.push(m); mads.push(im.MAD()); }\n"
            u"  im.resetSelections();\n"
            // Capas de estrellas (fondo a 0): el STF automático las quemaba enteras, también las ya estiradas (Rafael, 7 nov 2026).
            u"  if (Math.max.apply(null, meds) < 1e-4) lineal = false;\n"
            u"  if (lineal) { var mn = Math.min.apply(null, meds), mx = Math.max.apply(null, meds), link = mn > 0 && mx / mn < 1.25, rows = [];\n"
            u"    var avg = function (a) { return a.reduce(function (p, q) { return p + q; }, 0) / a.length; };\n"
            u"    for (var c = 0; c < n; ++c) { var md = link ? avg(meds) : meds[c], ma = link ? avg(mads) : mads[c];\n"
            u"      var sh = Math.max(0, Math.min(1, md - 2.8 * 1.4826 * ma)); rows.push([sh, 1, Math.mtf(0.25, md - sh), 0, 1]); }\n"
            u"    if (n == 1) rows = [rows[0], rows[0], rows[0]]; while (rows.length < 4) rows.push([0, 1, 0.5, 0, 1]);\n"
            u"    var S = new ScreenTransferFunction; S.STF = rows; S.executeOn(v, false); }\n"
            u"  w.show(); });\n"
            u"if (nuevas.length) nuevas[nuevas.length - 1].bringToFront(); })();", "JavaScript" );
      }
      catch ( ... ) {}
      // En una comparativa, el candidato recomendado queda delante de todas las vistas nuevas.
      {
         String rec = JsonStringAfter( out, u"\"recomendado\":\"" );
         if ( !rec.IsEmpty() )
            try { Module->EvaluateScript( u"(function () { var w = ImageWindow.windowById(\"" + rec + u"\"); if (!w.isNull) { w.show(); w.bringToFront(); } })();", "JavaScript" ); }
            catch ( ... ) {}
      }
      // Con candidatos (comparativas como la del gradiente), previas de cada uno con el mismo estirado y sus modelos.
      std::vector<std::pair<String, String>> previews;
      if ( out.Contains( u"\"candidatos\"" ) )
         previews = CandidatePreviews( out );
      Chat().AppendInfo( Tr( u"Script ejecutado." ) + (out.IsEmpty() ? String( Tr( u" Mira la consola de PixInsight para ver su salida." ) )
                                                               : Tr( u" Resultado:\n" ) + out.Left( 20000 )), previews );

      // Segunda fase para modelos sin herramientas: se les devuelve lo que ha medido el script para que lo
      // interpreten según la ficha. En el análisis del objeto, Qwen medía bien pero nunca veía los números;
      // con esta vuelta su análisis pasó de ~18/40 a ~32/40 (banco de pruebas del 4 nov 2026).
      if ( !m_cfg.Current().IsAgent() && m_interpretPending && !out.IsEmpty() && !m_history.empty() && !m_busy )
      {
         m_interpretPending = false;
         String extra;
         // Estirado: si el modelo ve imágenes, se le manda una vista reducida de la starless estirada con una pauta
         // cerrada. En la prueba a ciegas del 4 nov 2026, Qwen 3.8 acertó 14 de 16 con esta pauta (plana / correcta /
         // pasada); sin ella juzgaba "plana" una imagen correcta y pedía estirar más.
         String sl = JsonStringAfter( out, u"\"starless\":{\"vista\":\"" );
         if ( !sl.IsEmpty() && ModelSeesImages( m_cfg.Current() ) )
         {
            m_nextImage = MakePreview( sl );
            if ( !m_nextImage.IsEmpty() )
               extra = u"\n\nTe adjunto la starless estirada (\"" + sl + u"\") reducida. Júzgala a ojo SÓLO por su nivel de "
                       u"estirado (el contraste local y la saturación vienen después) con esta pauta:\n"
                       u"- \"plana\": el objeto apenas se separa del fondo, aspecto gris o apagado; la señal débil casi no se ve.\n"
                       u"- \"correcta\": el objeto tiene cuerpo y la señal débil se ve, con el fondo oscuro pero no negro, sin ruido evidente.\n"
                       u"- \"pasada\": el fondo se ve claro o con grano, la nebulosidad lo ocupa todo y pierde contraste con las zonas oscuras.\n"
                       u"Pon tu juicio en «Revisar a ojo» como \"A ojo: plana | correcta | pasada — motivo\", y señala si ves "
                       u"restos de estrellas o manchas y dónde. Las medidas mandan: no juzgues el color (lo mide la dominante "
                       u"del cielo) y no pidas más estirado si las medidas dicen que se paró por el ruido o el recorte.";
         }
         QueueJob( JobKind::Interpret, Tr( u"Interpretar el resultado" ),
                   // 12000 cortaba el gradiente de 4 vistas y Qwen dio una por "truncada" (6 nov 2026): 30000 (~8.500
                   // tokens) cabe en los 32k del modelo local; si aun así se corta, se le dice.
                   u"El script ha terminado sin errores. Resultado:\n" + out.Left( 30000 ) +
                   (out.Length() > 30000 ? String().Format( "\n(Resultado recortado para el contexto: faltan %d caracteres. "
                        "No es un fallo del script: interpreta lo que hay y di qué partes no has visto.)", int( out.Length() - 30000 ) )
                                         : String()) +
                   u"\nAhora, sin escribir ningún script, interpreta estos datos según la ficha (controles y checklist) y da "
                   u"el resumen final del paso. No inventes datos que no estén en el resultado. Separa los controles en dos "
                   u"listas: «Medido» (sólo lo que el resultado demuestra, con su valor) y «Revisar a ojo» (lo que pide la "
                   u"ficha y el resultado no mide, como halos, anillos o manchas); nunca des por bueno algo de la segunda." +
                   extra + (m_autoChain ? AutoNextText() : String()) );
      }
      else if ( m_autoChain )
         StopAutoChain( out.IsEmpty() ? String( Tr( u"el script no ha devuelto ningún resultado que interpretar" ) )
                                      : String( Tr( u"no se ha podido pedir el paso siguiente" ) ) );
   }
   catch ( const Error& e )
   {
      CopilotLog( u"Error en el script: " + e.Message() );

      // Bucle de errores para modelos sin herramientas: se le devuelve el error para que corrija el script
      // (Claude no lo necesita: ve los errores por el MCP). En la prueba del Paso 9 (4 nov 2026) Qwen
      // arregló así los dos scripts rotos en 1 y 2 vueltas. El límite es el de "Intentos fallidos seguidos".
      int limit = (m_cfg.maxRetries > 0) ? m_cfg.maxRetries : 3;
      bool repeated = !m_lastFailedScript.IsEmpty() && code.Trimmed() == m_lastFailedScript;
      m_lastFailedScript = code.Trimmed();
      if ( m_autoChain && (repeated || m_cfg.Current().IsAgent() || m_history.empty() || m_busy || m_scriptFixes >= limit) )
         StopAutoChain( Tr( u"el script ha fallado y no se puede corregir solo" ) );
      if ( repeated )
         Chat().AppendInfo( Tr( u"El script ha fallado otra vez con el mismo código que la vez anterior (" ) + e.Message() +
                            Tr( u"): el modelo no sabe corregirlo; paro aquí. Prueba con el botón del paso o con otro modelo." ) );
      else if ( !m_cfg.Current().IsAgent() && !m_history.empty() && !m_busy && m_scriptFixes < limit )
      {
         ++m_scriptFixes;
         Chat().AppendInfo( Tr( u"El script ha fallado: " ) + e.Message() + Tr( u"\nLe paso el error al modelo para que lo corrija "
                            u"(intento " ) + String().Format( "%d de %d", m_scriptFixes, limit ) + Tr( u")..." ) );
         QueueJob( JobKind::Fix, String().Format( "Corregir script (%d/%d)", m_scriptFixes, limit ),
                   u"Lo he ejecutado en PixInsight y ha fallado con este error:\n" + e.Message() +
                   u"\nLas vistas que se crearon antes del error siguen abiertas. Corrige el script y devuélvelo completo "
                   u"en un único bloque ```javascript, sin explicaciones largas." );
      }
      else
         Chat().AppendInfo( m_cfg.Current().IsAgent() || m_history.empty()
                            ? String( Tr( u"El script ha fallado. Mira la consola de PixInsight." ) )
                            : Tr( u"El script ha fallado " ) + String().Format( "%d", m_scriptFixes + 1 ) +
                              Tr( u" veces seguidas; paro aquí (límite de intentos de Configurar IA). Mira la consola de PixInsight." ) );
   }
}

// ----------------------------------------------------------------------------
// Ejecución asíncrona
// ----------------------------------------------------------------------------

bool PiCopilotInterface::StartJob( JobKind kind, const String& title, const String& prompt, bool newHttpConversation,
                                   const String& stepKey )
{
   if ( m_busy )
   {
      MessageBox( Tr( u"PiCopilot ya está trabajando en \"" ) + m_job.title + Tr( u"\". Espera a que termine o cancélalo." ),
                  "PiCopilot", StdIcon::Information, StdButton::Ok ).Execute();
      return false;
   }

   if ( !EnsureDir( m_cfg.workDir ) || !EnsureDir( m_cfg.TempDir() ) )
      return false;

   if ( kind == JobKind::Step || kind == JobKind::Full )
   {
      m_scriptFixes = 0;         // tarea nueva: el contador de correcciones empieza de cero
      m_interpretPending = true; // cuando su script funcione, se le devuelve el resultado al modelo
   }

   m_job = Job();
   m_job.kind = kind;
   m_job.title = title;
   m_job.model = m_cfg.Current();
   m_job.viewId = m_viewId;
   m_job.startTime = NowSeconds();

   // Modelo inferior o superior según Configurar IA.
   String why;
   m_cfg.LoadScores();
   m_job.tierModel = m_cfg.TierModel( m_job.model, stepKey, why );
   String modelText = m_job.model.name;
   if ( PiCopilotConfig::HasTiers( m_job.model ) && !m_job.tierModel.IsEmpty() )
      modelText << u" (" << m_job.tierModel << u", " << why << u")";

   PiCopilotChatDialog& chat = Chat();
   if ( kind != JobKind::Chat )
   {
      chat.AppendInfo( u"--- " + title + Tr( u" con " ) + modelText +
                       (m_viewId.IsEmpty() ? String() : Tr( u" sobre " ) + m_viewId) + u" ---" );
      CopilotLog( title + Tr( u" con " ) + modelText + (m_viewId.IsEmpty() ? String() : Tr( u" sobre " ) + m_viewId) );
   }

   bool ok;
   if ( m_job.model.IsClaude() )
      ok = StartClaude( prompt );
   else if ( m_job.model.IsCodex() )
      ok = StartCodex( prompt );
   else
   {
      if ( newHttpConversation || m_history.empty() )
      {
         m_history.clear();
         m_history.push_back( { "system", PiCopilotPrompts::System() } );
      }
      m_history.push_back( { "user", prompt, m_nextImage } );
      m_nextImage.Clear();
      ok = StartHttp();
      if ( !ok )
         m_history.pop_back();
   }

   if ( !ok )
      return false;

   m_busy = true;
   UpdateControls();
   return true;
}

static StringList SplitArgs( const String& s )
{
   // Separación simple por espacios, respetando comillas dobles.
   StringList args;
   String cur;
   bool quoted = false, any = false;
   for ( String::const_iterator i = s.Begin(); i != s.End(); ++i )
   {
      char16_type c = *i;
      if ( c == '\"' )
      {
         quoted = !quoted;
         any = true;
      }
      else if ( (c == ' ' || c == '\t') && !quoted )
      {
         if ( any )
            args << cur;
         cur.Clear();
         any = false;
      }
      else
      {
         cur << c;
         any = true;
      }
   }
   if ( any )
      args << cur;
   return args;
}

bool PiCopilotInterface::StartClaude( const String& prompt )
{
   StringList args;
   args << "-p"
        << "--output-format" << "stream-json"
        << "--verbose"
        << "--append-system-prompt" << PiCopilotPrompts::System();
   if ( !m_job.tierModel.IsEmpty() )
      args << "--model" << m_job.tierModel;
   int maxTurns = (m_job.kind == JobKind::Full) ? m_cfg.maxTurnsFull : m_cfg.maxTurnsStep;
   if ( maxTurns > 0 )
      args << "--max-turns" << String().Format( "%d", maxTurns );

   if ( m_claudeSession.IsEmpty() )
   {
      m_claudeSession = PiCopilotUtil::NewUUID();
      m_claudeSessionStarted = false;
   }
   if ( m_claudeSessionStarted )
      args << "--resume" << m_claudeSession;
   else
      args << "--session-id" << m_claudeSession;

   if ( File::DirectoryExists( m_cfg.guideDir ) )
      args << "--add-dir" << m_cfg.guideDir;
   args << "--add-dir" << m_cfg.workDir;

   // Carpetas de datos (masters, subs, tomas cortas...) que Claude puede leer.
   {
      StringList dirs;
      m_cfg.dataDirs.Break( dirs, ';', true );
      for ( String d : dirs )
      {
         d.Trim();
         if ( !d.IsEmpty() && File::DirectoryExists( d ) )
            args << "--add-dir" << d;
      }
   }

   // Configuración MCP propia de PiCopilot: así Claude Code ve los servidores
   // aunque no estén registrados en su configuración de usuario. Se reescribe en
   // cada uso con el servidor nuevo (picopilot); el antiguo sólo si falta el nuevo.
   String mcpConfig = PiCopilotUtil::JoinPath( m_cfg.workDir, "mcp/picopilot-mcp.json" );
   {
      String nuevo = m_cfg.PicopilotMcpServer();
      String viejo = nuevo.IsEmpty() ? PiCopilotConfig::ClassicMcpServer() : String();   // respaldo si falta el nuevo
      String json = u"{\n  \"mcpServers\": {";
      bool first = true;
      if ( !nuevo.IsEmpty() )
      {
         json << u"\n    \"picopilot\": {\n      \"command\": \"node\",\n      \"args\": [" << JsonValue::Quote( nuevo ) << u"]\n    }";
         first = false;
      }
      if ( !viejo.IsEmpty() )
         json << (first ? u"" : u",") << u"\n    \"pixinsight\": {\n      \"command\": \"node\",\n      \"args\": [" << JsonValue::Quote( viejo ) << u"]\n    }";
      json << u"\n  }\n}\n";
      if ( EnsureDir( File::ExtractDirectory( mcpConfig ) ) )
         PiCopilotUtil::WriteText( mcpConfig, json );
   }
   if ( File::Exists( mcpConfig ) )
      args << "--mcp-config" << mcpConfig;

   args << SplitArgs( m_cfg.claudeArgs );

   m_job.stdinData = prompt.ToUTF8();

   m_oldProcess = std::move( m_process );   // no se destruye aquí: puede que estemos dentro de un evento suyo
   m_process.reset( new ExternalProcess );
   m_process->OnStarted( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStarted, *this );
   m_process->OnStandardOutputDataAvailable( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStdout, *this );
   m_process->OnStandardErrorDataAvailable( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStderr, *this );
   m_process->OnFinished( (ExternalProcess::process_exit_event_handler)&PiCopilotInterface::e_ProcessFinished, *this );
   m_process->OnError( (ExternalProcess::process_error_event_handler)&PiCopilotInterface::e_ProcessError, *this );

   // Directorio de trabajo: la raíz del repositorio de la guía (si existe).
   String guideParent = File::ExtractDirectory( m_cfg.guideDir.EndsWith( '/' ) ? m_cfg.guideDir.Left( m_cfg.guideDir.Length()-1 ) : m_cfg.guideDir );
   if ( !guideParent.IsEmpty() && File::DirectoryExists( guideParent ) )
      m_process->SetWorkingDirectory( guideParent );
   else
      m_process->SetWorkingDirectory( m_cfg.workDir );

   try
   {
      m_process->Start( m_cfg.claudePath, args );
   }
   catch ( ... )
   {
      Chat().AppendInfo( Tr( u"No se pudo lanzar Claude Code (" ) + m_cfg.claudePath + Tr( u"). Revisa la ruta en Configuración." ) );
      Chat().Launch();
      return false;
   }
   return true;
}

// Codex CLI de OpenAI en modo no interactivo (codex exec): agente con el MCP de PixInsight, como Claude Code.
// Cada tarea es una sesión nueva (lee la guía al empezar); la respuesta final se lee del fichero de -o.
bool PiCopilotInterface::StartCodex( const String& prompt )
{
   // npm instala codex.cmd, que no se puede lanzar directamente: se usa node con el script del paquete.
   String program = "codex";
   StringList args;
   String js = PiCopilotUtil::JoinPath( PiCopilotUtil::EnvVar( "APPDATA" ), "npm/node_modules/@openai/codex/bin/codex.js" );
   if ( File::Exists( js ) )
   {
      program = "node";
      args << js;
   }

   m_job.codexLastMessage = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"codex_" + PiCopilotUtil::NewId() + u".txt" );
   m_job.tempFiles << m_job.codexLastMessage;

   String nuevo = m_cfg.PicopilotMcpServer();
   String viejo = nuevo.IsEmpty() ? PiCopilotConfig::ClassicMcpServer() : String();   // respaldo si falta el nuevo

   args << "exec" << "--json" << "--skip-git-repo-check" << "--full-auto"
        << "-C" << m_cfg.workDir
        << "-o" << m_job.codexLastMessage;
   if ( !m_job.tierModel.IsEmpty() )
      args << "-m" << m_job.tierModel;
   // Servidores MCP: el nuevo (picopilot) y, si sigue instalado, el antiguo. Los scripts largos pueden
   // tardar minutos: se sube el tiempo máximo de cada herramienta.
   if ( !nuevo.IsEmpty() )
      args << "-c" << "mcp_servers.picopilot.command=\"node\""
           << "-c" << (u"mcp_servers.picopilot.args=[\"" + nuevo + u"\"]")
           << "-c" << "mcp_servers.picopilot.startup_timeout_sec=30"
           << "-c" << "mcp_servers.picopilot.tool_timeout_sec=900";
   if ( !viejo.IsEmpty() )
      args << "-c" << "mcp_servers.pixinsight.command=\"node\""
           << "-c" << (u"mcp_servers.pixinsight.args=[\"" + viejo + u"\"]")
           << "-c" << "mcp_servers.pixinsight.startup_timeout_sec=30"
           << "-c" << "mcp_servers.pixinsight.tool_timeout_sec=900";
   args << "-";   // el prompt llega por la entrada estándar

   m_job.stdinData = (PiCopilotPrompts::System() + u"\n\n" + prompt).ToUTF8();

   m_oldProcess = std::move( m_process );   // no se destruye aquí: puede que estemos dentro de un evento suyo
   m_process.reset( new ExternalProcess );
   m_process->OnStarted( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStarted, *this );
   m_process->OnStandardOutputDataAvailable( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStdout, *this );
   m_process->OnStandardErrorDataAvailable( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStderr, *this );
   m_process->OnFinished( (ExternalProcess::process_exit_event_handler)&PiCopilotInterface::e_ProcessFinished, *this );
   m_process->OnError( (ExternalProcess::process_error_event_handler)&PiCopilotInterface::e_ProcessError, *this );
   m_process->SetWorkingDirectory( m_cfg.workDir );

   try
   {
      m_process->Start( program, args );
   }
   catch ( ... )
   {
      Chat().AppendInfo( Tr( u"No se pudo lanzar Codex. Instálalo con «npm install -g @openai/codex» y haz «codex login»." ) );
      Chat().Launch();
      return false;
   }
   return true;
}

// Avance de codex exec --json (un evento por línea): herramientas usadas y mensajes intermedios.
void PiCopilotInterface::ParseCodexStream()
{
   for ( ;; )
   {
      size_type nl = String::notFound;
      for ( size_type i = m_job.parsed; i < m_job.out.Length(); ++i )
         if ( m_job.out[i] == '\n' )
         {
            nl = i;
            break;
         }
      if ( nl == String::notFound )
         break;
      IsoString line( reinterpret_cast<const char*>( m_job.out.Begin() ) + m_job.parsed, 0, nl - m_job.parsed );
      m_job.parsed = nl + 1;
      line.Trim();
      if ( line.IsEmpty() )
         continue;
      JsonValue ev;
      String whyNot;
      if ( !JsonValue::Parse( line, ev, whyNot ) )
         continue;
      String type = ev["type"].ToText();
      const JsonValue& item = ev["item"];
      String it = item["type"].ToText();
      if ( type == "item.started" && it == "mcp_tool_call" )
      {
         if ( !m_job.pendingText.IsEmpty() && m_chat )
            m_chat->AppendInfo( u"  · " + m_job.pendingText );
         m_job.pendingText.Clear();
         String name = item["tool"].ToText();
         CopilotLog( m_job.model.name + u" usa " + name );
         if ( m_chat )
            m_chat->AppendInfo( Tr( u"  · herramienta: " ) + name );
      }
      else if ( type == "item.completed" && it == "agent_message" && m_job.kind != JobKind::Chat )
      {
         String t = item["text"].ToText().Trimmed();
         if ( !t.IsEmpty() )
         {
            if ( !m_job.pendingText.IsEmpty() && m_chat )
               m_chat->AppendInfo( u"  · " + m_job.pendingText );
            m_job.pendingText = t;   // el último coincide con la respuesta final
         }
      }
      else if ( type == "error" && m_chat )
         m_chat->AppendInfo( u"  · Codex: " + ev["message"].ToText() );
   }
}

bool PiCopilotInterface::StartHttp()
{
   const PiCopilotModel& model = m_job.model;

   String key;
   if ( !model.keyEnv.IsEmpty() )
   {
      key = PiCopilotUtil::EnvVar( model.keyEnv );
      if ( key.IsEmpty() )
      {
         Chat().AppendInfo( Tr( u"Falta la clave de " ) + model.name + Tr( u": define la variable de entorno " ) + model.keyEnv +
                            Tr( u" y reinicia PixInsight." ) );
         Chat().Launch();
         return false;
      }
   }

   // Modelos locales (32k de contexto): se reservan 8.000 tokens para la
   // respuesta y, si la conversación del Prompt no cabe en el resto, se
   // quitan los turnos más antiguos (se conservan el mensaje de sistema y el
   // último del usuario). Estimación: ~3,5 caracteres por token.
   const int localMaxTokens = 8000;
   if ( !model.IsCloud() )
   {
      const size_type budgetChars = size_type( (32768 - localMaxTokens - 1000) * 3.5 );
      auto totalChars = [this]()
      {
         size_type n = 0;
         for ( const PiCopilotChatMessage& m : m_history )
            n += m.content.Length();
         return n;
      };
      // El primer mensaje del usuario (la tarea, las funciones de la guía y la ficha) se conserva: en una serie de pasos,
      // sin él Qwen perdía el catálogo y se inventaba funciones. Se quitan los turnos intermedios más antiguos.
      // Build 88: se construye una lista nueva en vez de borrar dentro del vector (los dos cierres de PixInsight del
      // 7 nov 2026 llegaron justo en el primer recorte).
      size_type total = totalChars();
      if ( total > budgetChars && m_history.size() > 2 )
      {
         CopilotLog( String().Format( "Recorte del historial: %d mensajes, %d caracteres", int( m_history.size() ), int( total ) ) );
         size_type keep = (m_history.size() > 2 && m_history[1].role == "user") ? 2 : 1;
         // Se cuentan desde el final los mensajes que caben junto con los conservados del principio.
         size_type fixedChars = 0;
         for ( size_type i = 0; i < keep; ++i )
            fixedChars += m_history[i].content.Length();
         size_type tail = 1;   // el último (la petición actual) siempre va
         size_type tailChars = m_history.back().content.Length();
         while ( keep + tail < m_history.size() )
         {
            size_type c = m_history[m_history.size() - 1 - tail].content.Length();
            if ( fixedChars + tailChars + c > budgetChars )
               break;
            tailChars += c;
            ++tail;
         }
         size_type removed = m_history.size() - keep - tail;
         if ( removed > 0 )
         {
            std::vector<PiCopilotChatMessage> kept;
            kept.reserve( keep + tail );
            for ( size_type i = 0; i < keep; ++i )
               kept.push_back( m_history[i] );
            for ( size_type i = m_history.size() - tail; i < m_history.size(); ++i )
               kept.push_back( m_history[i] );
            m_history.swap( kept );
            CopilotLog( String().Format( "Recorte del historial: quedan %d mensajes", int( m_history.size() ) ) );
            Chat().AppendInfo( u"(Conversación recortada: se han quitado los " + String( int( removed ) ) +
                               u" mensajes más antiguos para que quepa en el contexto del modelo local; se conserva el primero, "
                               u"con la tarea y las funciones de la guía.)" );
         }
      }
   }

   CopilotLog( u"Petición HTTP: " + String( int( m_history.size() ) ) + u" mensajes" );   // trazas: cierre del 7 nov 2026
   // Cuerpo de la petición.
   String modelId = m_job.tierModel.IsEmpty() ? model.model : m_job.tierModel;
   String body = u"{\"model\":" + JsonValue::Quote( modelId ) + u",\"stream\":false,";
   // Modelos locales: temperatura baja para pasos reproducibles (guia/envolturas/local.md).
   // Sin modo de pensamiento: con él, Qwen 3.8 gastaba ~16.000 tokens razonando
   // y el script salía cortado (prueba del Paso 9, 3 nov 2026). Los servidores
   // que no conocen el campo lo ignoran.
   if ( !model.IsCloud() )
      // chat_template_kwargs lo entienden Strata y llama.cpp; reasoning_effort
      // "none", Ollama (comprobado con qwen38-32k en Ollama 0.40, 4 nov 2026).
      // max_tokens corta los bucles de repetición (prueba con Ollama del 4 nov:
      // 22.871 tokens de parámetros inventados en 5,5 minutos).
      body << u"\"temperature\":0.2,\"chat_template_kwargs\":{\"enable_thinking\":false},\"reasoning_effort\":\"none\","
           << String().Format( "\"max_tokens\":%d,", localMaxTokens );
   body << u"\"messages\":[";
   for ( size_t i = 0; i < m_history.size(); ++i )
   {
      if ( i > 0 )
         body << ',';
      body << u"{\"role\":" << JsonValue::Quote( m_history[i].role ) << u",\"content\":";
      ByteArray jpg;
      // Sólo la imagen del último mensaje: las anteriores gastarían contexto sin aportar.
      if ( i + 1 == m_history.size() && !m_history[i].image.IsEmpty() && File::Exists( m_history[i].image ) )
         try { jpg = File::ReadFile( m_history[i].image ); } catch ( ... ) {}
      if ( jpg.IsEmpty() )
         body << JsonValue::Quote( m_history[i].content );
      else
         body << u"[{\"type\":\"text\",\"text\":" << JsonValue::Quote( m_history[i].content )
              << u"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/jpeg;base64,"
              << String( IsoString::ToBase64( jpg.Begin(), jpg.Length() ) ) << u"\"}}]";
      body << '}';
   }
   body << u"]}";

   CopilotLog( u"Petición HTTP: cuerpo de " + String( int( body.Length() ) ) + u" caracteres" );
   String id = PiCopilotUtil::NewId();
   String bodyPath = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"req_" + id + u".json" );
   if ( !PiCopilotUtil::WriteText( bodyPath, body ) )
   {
      Chat().AppendInfo( Tr( u"No se pudo escribir la petición en " ) + bodyPath );
      return false;
   }
   m_job.tempFiles << bodyPath;

   StringList args;
   args << "-sS" << "--max-time" << "1800" << "-X" << "POST" << model.endpoint
        << "-H" << "Content-Type: application/json; charset=utf-8";
   if ( !key.IsEmpty() )
   {
      // La clave va en un archivo temporal para que no aparezca en la línea de órdenes.
      String hdrPath = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"hdr_" + id + u".txt" );
      if ( !PiCopilotUtil::WriteText( hdrPath, u"Authorization: Bearer " + key + u"\n" ) )
         return false;
      m_job.tempFiles << hdrPath;
      args << "-H" << u"@" + hdrPath;
   }
   args << "--data-binary" << u"@" + bodyPath;

   m_oldProcess = std::move( m_process );   // no se destruye aquí: puede que estemos dentro de un evento suyo
   m_process.reset( new ExternalProcess );
   m_process->OnStandardOutputDataAvailable( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStdout, *this );
   m_process->OnStandardErrorDataAvailable( (ExternalProcess::process_event_handler)&PiCopilotInterface::e_ProcessStderr, *this );
   m_process->OnFinished( (ExternalProcess::process_exit_event_handler)&PiCopilotInterface::e_ProcessFinished, *this );
   m_process->OnError( (ExternalProcess::process_error_event_handler)&PiCopilotInterface::e_ProcessError, *this );

   try
   {
      m_process->Start( m_cfg.CurlPath(), args );
      CopilotLog( u"Petición HTTP enviada." );
   }
   catch ( ... )
   {
      Chat().AppendInfo( Tr( u"No se pudo lanzar curl.exe." ) );
      return false;
   }
   return true;
}

void PiCopilotInterface::ParseClaudeStream( bool final )
{
   // Claude Code con --output-format stream-json escribe un objeto JSON por
   // línea: avisos de herramientas, texto parcial y el resultado final.
   for ( ;; )
   {
      size_type nl = String::notFound;
      for ( size_type i = m_job.parsed; i < m_job.out.Length(); ++i )
         if ( m_job.out[i] == '\n' )
         {
            nl = i;
            break;
         }
      size_type stop = nl;
      if ( nl == String::notFound )
      {
         if ( !final || m_job.parsed >= m_job.out.Length() )
            break;
         stop = m_job.out.Length();
      }

      IsoString line( reinterpret_cast<const char*>( m_job.out.Begin() ) + m_job.parsed, 0, stop - m_job.parsed );
      m_job.parsed = (nl == String::notFound) ? stop : nl + 1;
      line.Trim();
      if ( line.IsEmpty() )
         continue;

      JsonValue ev;
      String whyNot;
      if ( !JsonValue::Parse( line, ev, whyNot ) )
         continue;

      String type = ev["type"].ToText();
      if ( type == "system" )
      {
         if ( ev["subtype"].ToText() == "init" )
            m_claudeSessionStarted = true;
      }
      else if ( type == "assistant" )
      {
         const JsonValue& content = ev["message"]["content"];
         for ( size_t i = 0; i < content.Size(); ++i )
         {
            const JsonValue& c = content[i];
            String ct = c["type"].ToText();
            // El último texto del modelo coincide con el resultado final, que
            // ya se muestra al terminar. Por eso cada texto se retiene y sólo
            // se publica como avance cuando le sigue otra acción.
            if ( ct == "tool_use" )
            {
               if ( !m_job.pendingText.IsEmpty() && m_chat )
                  m_chat->AppendInfo( u"  · " + m_job.pendingText );
               m_job.pendingText.Clear();
               String name = c["name"].ToText();
               name.ReplaceString( "mcp__pixinsight__", "" );
               name.ReplaceString( "mcp__picopilot__", "" );
               CopilotLog( m_job.model.name + u" usa " + name );
               if ( m_chat )
                  m_chat->AppendInfo( Tr( u"  · herramienta: " ) + name );
            }
            else if ( ct == "text" && m_job.kind != JobKind::Chat )
            {
               String t = c["text"].ToText().Trimmed();
               if ( !t.IsEmpty() )
               {
                  if ( !m_job.pendingText.IsEmpty() && m_chat )
                     m_chat->AppendInfo( u"  · " + m_job.pendingText );
                  m_job.pendingText = t;
               }
            }
         }
      }
      else if ( type == "result" )
      {
         m_job.pendingText.Clear();
         m_job.resultText = ev["result"].ToText();
         m_job.resultIsError = ev["is_error"].b || ev["subtype"].ToText().StartsWith( "error" );
         if ( ev["subtype"].ToText() == "error_max_turns" )
         {
            int maxTurns = (m_job.kind == JobKind::Full) ? m_cfg.maxTurnsFull : m_cfg.maxTurnsStep;
            m_job.resultText = Tr( u"Parado: se alcanzó el límite de " ) + String().Format( "%d", maxTurns ) +
                               Tr( u" turnos sin terminar la tarea (Configurar IA → límites). Revisa las vistas creadas "
                               u"y la consola antes de volver a lanzarlo." ) +
                               (m_job.resultText.IsEmpty() ? String() : u"\n\n" + m_job.resultText);
            m_job.resultIsError = true;
         }
         else if ( m_job.resultText.IsEmpty() && m_job.resultIsError )
            m_job.resultText = Tr( u"Claude Code terminó con error (" ) + ev["subtype"].ToText() + u").";
      }
   }
}

// Imágenes (.jpg/.png) que existen y aparecen con ruta absoluta en un texto: la respuesta del modelo y, en Claude y
// Codex, toda la salida del trabajo (rutas de los scripts, de los resultados y de los Read). Así se ven en el chat las
// previas que el agente crea con sus herramientas (Rafael, 6 nov 2026: le pedía previas de paletas y no aparecían).
static std::vector<std::pair<String, String>> ImagesInText( const IsoString& utf8, size_type maxImages = 12 )
{
   std::vector<std::pair<String, String>> out;
   std::string s( utf8.c_str() );
   // Barras de JSON ("C:\\Users\\...") y de Windows a '/'.
   std::string t; t.reserve( s.size() );
   for ( size_t i = 0; i < s.size(); ++i )
   {
      if ( s[i] == '\\' )
      {
         while ( i + 1 < s.size() && s[i+1] == '\\' ) ++i;
         t.push_back( '/' );
      }
      else
         t.push_back( s[i] );
   }
   static const std::regex re( R"(([A-Za-z]:/[^"'`<>|*?\r\n]*?\.(?:jpe?g|png)))", std::regex::icase );
   std::set<std::string> seen;
   for ( std::sregex_iterator it( t.begin(), t.end(), re ), end; it != end && out.size() < maxImages; ++it )
   {
      std::string p = (*it)[1].str();
      // Una ruta con espacios puede empezar en mitad de una frase: se prueba también desde cada "X:/" interior.
      if ( seen.count( p ) )
         continue;
      seen.insert( p );
      String path = String::UTF8ToUTF16( p.c_str() );
      if ( !File::Exists( path ) )
         continue;
      // Las del propio PiCopilot (previas del chat) no.
      if ( path.Contains( u"picopilot_" ) || path.Contains( u"/prev_" ) )
         continue;
      out.push_back( { File::ExtractNameAndExtension( path ), path } );
   }
   // La plancha (si la hay) delante.
   std::stable_partition( out.begin(), out.end(), []( const std::pair<String, String>& a )
                          { return a.first.Lowercase().Contains( u"plancha" ); } );
   return out;
}

void PiCopilotInterface::FinishJob( const String& response, bool error )
{
   for ( const String& f : m_job.tempFiles )
      try
      {
         if ( File::Exists( f ) )
            File::Remove( f );
      }
      catch ( ... )
      {
      }
   m_job.tempFiles.Clear();

   m_busy = false;

   PiCopilotChatDialog& chat = Chat();
   if ( error )
   {
      if ( m_autoChain )
         StopAutoChain( m_job.cancelled ? String( Tr( u"cancelada" ) ) : String( Tr( u"error del modelo" ) ) );
      chat.AppendInfo( u"ERROR (" + m_job.model.name + u"): " + response );
      CopilotLog( u"Error: " + response );
   }
   else
   {
      chat.AppendAssistant( m_job.model.name, response );
      if ( !m_job.model.IsAgent() )
         m_history.push_back( { "assistant", response } );
      else
      {
         // Previas que el agente ha creado o mirado en este trabajo: se enseñan en el chat.
         IsoString all = response.ToUTF8();
         all.Append( '\n' );
         all.Append( IsoString( reinterpret_cast<const char*>( m_job.out.Begin() ), reinterpret_cast<const char*>( m_job.out.End() ) ) );
         std::vector<std::pair<String, String>> imgs = ImagesInText( all );
         if ( !imgs.empty() )
            chat.AppendInfo( Tr( u"Imágenes de esta respuesta:" ), imgs );
      }
      // Los modelos sin herramientas sólo proponen un script: hasta que el usuario lo ejecuta no se ha hecho nada.
      m_scriptWaiting = !m_job.model.IsAgent() && !PiCopilotPrompts::ExtractScript( response ).IsEmpty();
      // Corrección que repite el script que acaba de fallar: no se ofrece (prueba de Rafael, 5 nov 2026: Qwen devolvió
      // el mismo script con File.listFiles y el usuario tenía que ejecutarlo para descubrirlo).
      if ( m_scriptWaiting && m_job.kind == JobKind::Fix && !m_lastFailedScript.IsEmpty() &&
           PiCopilotPrompts::ExtractScript( response ).Trimmed() == m_lastFailedScript )
      {
         m_scriptWaiting = false;
         chat.AppendInfo( Tr( u"El modelo ha devuelto el mismo script que acaba de fallar: no sabe corregirlo; paro aquí. Prueba con el botón del paso o con otro modelo." ) );
      }
      if ( m_scriptWaiting )
      {
         // Desde el Prompt también se le devuelve el resultado para que lo interprete (antes sólo en los botones de
         // paso: en la cadena SPCC → StarX del 5 nov 2026 el resultado se quedaba sin comentar). En una serie, la
         // interpretación trae el script del paso siguiente, y su resultado también se interpreta.
         if ( m_job.kind == JobKind::Chat || m_job.kind == JobKind::Interpret )
            m_interpretPending = true;
         if ( m_autoChain && !m_job.model.IsAgent() )
         {
            if ( m_autoSteps >= AutoMaxSteps )
               StopAutoChain( String().Format( "ya se han ejecutado %d scripts en esta serie", m_autoSteps ) );
            else
            {
               m_autoScript = PiCopilotPrompts::ExtractScript( response );
               m_autoRunPending = true;   // se ejecuta desde el temporizador, fuera de este evento
               m_autoRunAt = NowSeconds() + 1.5;
               chat.AppendInfo( Tr( u">>> Serie de pasos: ejecuto el script " ) + String().Format( "%d", m_autoSteps + 1 ) +
                                Tr( u" sin esperar (pulsa «Cancelar» mientras el modelo piensa para parar)." ) );
            }
         }
         if ( !m_autoRunPending )
            chat.AppendInfo( Tr( u">>> Plan listo, todavía sin aplicar. PULSE «Ejecutar script» para llevarlo a cabo en PixInsight." ) );
      }
      else if ( m_autoChain && !m_job.model.IsAgent() && m_autoSteps == 0 && m_job.kind == JobKind::Chat )
         m_autoChain = false;   // una pregunta o una respuesta sin script: no había serie que parar
      else if ( m_autoChain && !m_job.model.IsAgent() )
         StopAutoChain( response.Contains( u"PARO" ) ? String( Tr( u"el modelo ha parado (mira su motivo arriba)" ) )
                                                     : String( Tr( u"el modelo no ha propuesto más pasos" ) ) );
      CopilotLog( m_job.title + u" terminado (" + ElapsedText( NowSeconds() - m_job.startTime ) + u")." );
   }

   chat.Launch();
   UpdateControls();
}

// ----------------------------------------------------------------------------
// Eventos del proceso externo
// ----------------------------------------------------------------------------

void PiCopilotInterface::e_ProcessStarted( ExternalProcess& sender )
{
   if ( !m_job.stdinData.IsEmpty() )
   {
      sender.Write( m_job.stdinData );
      m_job.stdinData.Clear();
   }
   sender.CloseStandardInput();
}

void PiCopilotInterface::e_ProcessStdout( ExternalProcess& sender )
{
   m_job.out.Append( sender.StandardOutput() );
   if ( m_job.model.IsClaude() )
      ParseClaudeStream( false );
   else if ( m_job.model.IsCodex() )
      ParseCodexStream();
}

void PiCopilotInterface::e_ProcessStderr( ExternalProcess& sender )
{
   m_job.err.Append( sender.StandardError() );
}

void PiCopilotInterface::e_ProcessFinished( ExternalProcess& sender, int exitCode, bool exitOk )
{
   if ( !m_busy )
      return;
   struct EventGuard { bool& f; EventGuard( bool& x ) : f( x ) { f = true; } ~EventGuard() { f = false; } } eg( m_inProcessEvent );

   m_job.out.Append( sender.StandardOutput() );
   m_job.err.Append( sender.StandardError() );
   String errText = IsoString( reinterpret_cast<const char*>( m_job.err.Begin() ), 0, m_job.err.Length() ).UTF8ToUTF16().Trimmed();

   if ( m_job.cancelled )
   {
      if ( !m_job.model.IsAgent() )
         m_history.pop_back();
      FinishJob( Tr( u"Cancelado por el usuario." ), true );
      return;
   }

   if ( m_job.model.IsCodex() )
   {
      ParseCodexStream();
      String last;
      if ( File::Exists( m_job.codexLastMessage ) )
         last = PiCopilotUtil::ReadText( m_job.codexLastMessage, 0 ).Trimmed();
      if ( !last.IsEmpty() )
         FinishJob( last, false );
      else
         FinishJob( Tr( u"Codex terminó (código " ) + String().Format( "%d", exitCode ) + Tr( u") sin respuesta. " ) + errText.Right( 1500 ), true );
      return;
   }

   if ( m_job.model.IsClaude() )
   {
      ParseClaudeStream( true );
      if ( !m_job.resultText.IsEmpty() )
         FinishJob( m_job.resultText, m_job.resultIsError );
      else
         FinishJob( Tr( u"Claude Code terminó (código " ) + String().Format( "%d", exitCode ) + Tr( u") sin respuesta. " ) + errText, true );
      return;
   }

   // Respuesta HTTP OpenAI-compatible.
   IsoString raw( reinterpret_cast<const char*>( m_job.out.Begin() ), 0, m_job.out.Length() );
   if ( !exitOk || exitCode != 0 )
   {
      m_history.pop_back();
      FinishJob( Tr( u"curl terminó con código " ) + String().Format( "%d", exitCode ) + u". " + errText, true );
      return;
   }

   JsonValue res;
   String whyNot;
   if ( !JsonValue::Parse( raw, res, whyNot ) )
   {
      m_history.pop_back();
      FinishJob( Tr( u"Respuesta no válida del servidor: " ) + whyNot + u"\n" + raw.UTF8ToUTF16().Left( 800 ), true );
      return;
   }
   if ( !res["error"].IsNull() )
   {
      m_history.pop_back();
      String msg = res["error"]["message"].ToText();
      FinishJob( msg.IsEmpty() ? res["error"].ToText() : msg, true );
      return;
   }
   String content = res["choices"][size_t( 0 )]["message"]["content"].ToText();
   if ( content.IsEmpty() )
   {
      m_history.pop_back();
      FinishJob( Tr( u"El servidor no devolvió texto: " ) + raw.UTF8ToUTF16().Left( 800 ), true );
      return;
   }
   if ( res["choices"][size_t( 0 )]["finish_reason"].ToText() == "length" )
      content = Tr( u"AVISO: la respuesta se ha cortado por falta de contexto (finish_reason = length). "
                u"El script puede estar incompleto: no lo ejecutes sin revisarlo.\n\n" ) + content;

   // Los modelos locales a veces devuelven el dossier ya relleno (con métricas
   // inventadas) en lugar del script que lo calcula. Se les pide una vez más,
   // explicándoles el error: en las pruebas del 4 nov, los dos reintentos
   // dieron un script correcto.
   if ( (m_job.kind == JobKind::Step || m_job.kind == JobKind::Full || m_job.kind == JobKind::Fix) && !m_job.retried &&
        PiCopilotPrompts::ExtractScript( content ).IsEmpty() &&
        !content.Contains( u"¿" ) )   // una pregunta al usuario (p. ej. qué vista usar) no se reintenta
   {
      m_history.push_back( { "assistant", content } );
      m_history.push_back( { "user",
         u"Eso no es lo que necesito: has escrito el resultado sin haberlo medido. No tienes acceso a PixInsight; "
         u"tu respuesta debe ser un único bloque ```javascript con el script PJSR que crea las copias, ejecuta los "
         u"procesos, mide y escribe el resultado (y el dossier, si se pide) con File.writeTextFile(). "
         u"Responde ahora sólo con el plan breve y el script." } );
      m_job.retried = true;
      m_job.out.Clear();
      m_job.err.Clear();
      m_retryPending = true;   // se relanza desde el temporizador, fuera de este evento
      Chat().AppendInfo( Tr( u"La respuesta no traía script (sólo un resultado inventado). Se lo pido otra vez..." ) );
      CopilotLog( m_job.title + u": respuesta sin script, se repite la petición." );
      return;
   }
   // Contexto usado por el modelo local, con la cifra que da el servidor (usage de Ollama / OpenAI): así se ve cuánto
   // queda antes de que el panel empiece a recortar los mensajes más antiguos (Rafael, 6 nov 2026).
   String contexto;
   if ( !m_job.model.IsCloud() )
   {
      const JsonValue& u = res["usage"];
      if ( u["prompt_tokens"].type == JsonValue::Number )
      {
         const int ctx = 32768, limite = 32768 - 8000 - 1000;   // mismo presupuesto que el recorte del historial
         int usados = int( u["prompt_tokens"].n + u["completion_tokens"].n );
         contexto = String().Format( "%d / %d tokens (%d %%)", usados, ctx, int( 100.0*usados/ctx + 0.5 ) ) +
                    Tr( u". Hacia los " ) + String().Format( "%d", limite ) + Tr( u" se empiezan a recortar los mensajes más antiguos." );
      }
   }
   FinishJob( content, false );
   if ( !contexto.IsEmpty() )
      Chat().AppendInfo( Tr( u"Contexto: " ) + contexto );
}

void PiCopilotInterface::e_ProcessError( ExternalProcess& sender, ExternalProcess::error_code error )
{
   if ( !m_busy )
      return;
   struct EventGuard { bool& f; EventGuard( bool& x ) : f( x ) { f = true; } ~EventGuard() { f = false; } } eg( m_inProcessEvent );
   if ( error == ExternalProcessError::FailedToStart )
   {
      if ( !m_job.model.IsAgent() )
         m_history.pop_back();
      FinishJob( m_job.model.IsCodex() ? String( Tr( u"No se pudo iniciar Codex: instálalo con npm install -g @openai/codex y haz codex login." ) ) : m_job.model.IsClaude() ?
                 Tr( u"No se pudo iniciar Claude Code (" ) + m_cfg.claudePath + Tr( u"). Revisa la ruta en Configuración." ) :
                 String( Tr( u"No se pudo iniciar curl.exe." ) ), true );
   }
}

// ----------------------------------------------------------------------------
// Eventos de la interfaz
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Watcher MCP integrado
//
// El servidor MCP (Node) deja cada comando como JSON en
// ~/.pixinsight-mcp/bridge/commands. Antes lo recogía el script
// pixinsight-mcp-watcher.js, que se quedaba en un bucle y ocupaba el motor de
// scripts. Ahora el temporizador del panel mira la carpeta y, sólo cuando hay
// comandos, ejecuta una versión "de una pasada" del mismo watcher (mismos
// manejadores y mismo protocolo: results/, current.json, pause, shutdown) y
// devuelve el control a PixInsight en cuanto termina.
// ----------------------------------------------------------------------------

static const char16_t* s_mcpRunnerTail =
u"\n"
u"// ---------------------------------------------------------------------------\n"
u"// Generado por PiCopilot: atiende los comandos pendientes y termina.\n"
u"// ---------------------------------------------------------------------------\n"
u"function picopilotRunPending() {\n"
u"   ensureDirectory(BRIDGE_DIR);\n"
u"   ensureDirectory(COMMANDS_DIR);\n"
u"   ensureDirectory(RESULTS_DIR);\n"
u"   ensureDirectory(LOGS_DIR);\n"
u"   var n = 0;\n"
u"   while (n < 5 && !File.exists(BRIDGE_DIR + \"/pause\") && processNextCommand())\n"
u"      ++n;\n"
u"}\n"
u"picopilotRunPending();\n";

bool PiCopilotInterface::PrepareMcpRunner( String& whyNot )
{
   String lib;
   if ( !WatcherLibrary( lib, whyNot ) )
      return false;
   String path = m_cfg.McpRunnerPath();
   if ( !EnsureDir( File::ExtractDirectory( path ) ) || !PiCopilotUtil::WriteText( path, lib + s_mcpRunnerTail ) )
   {
      whyNot = u"No se pudo escribir " + path;
      return false;
   }
   return true;
}

// El watcher como biblioteca: su código con la llamada de arranque desactivada y los #include relativos pasados a
// rutas absolutas. Lo usan el runner del MCP y los scripts de los modelos que necesitan blindSolve (que depende del
// motor de BlindSolver por #include y no se puede cargar con eval).
bool PiCopilotInterface::WatcherLibrary( String& lib, String& whyNot )
{
   // Se regenera en cada pasada a partir del watcher original, así cualquier
   // cambio en pixinsight-mcp-watcher.js se aplica sin recompilar el módulo.
   String source = PiCopilotUtil::ReadText( m_cfg.watcherSource );
   if ( source.IsEmpty() )
   {
      whyNot = u"No se encuentra el watcher en " + m_cfg.watcherSource;
      return false;
   }

   // Quitar la llamada de arranque del bucle (la última línea "runWatcher();").
   StringList lines;
   source.Break( lines, '\n' );
   bool found = false;
   for ( size_type i = lines.Length(); i > 0; --i )
      if ( lines[i-1].Trimmed() == "runWatcher();" )
      {
         lines[i-1] = "// runWatcher();  (desactivado por PiCopilot)";
         found = true;
         break;
      }
   if ( !found )
   {
      whyNot = u"El watcher no termina con runWatcher(); no sé cómo adaptarlo.";
      return false;
   }

   // El runner se escribe en otra carpeta: los #include "relativos" (por ejemplo
   // "../guia/herramientas/realces.js" del watcher v8) se pasan a rutas absolutas
   // respecto a la carpeta del watcher original.
   String watcherDir = File::ExtractDirectory( File::FullPath( m_cfg.watcherSource ) );
   for ( String& l : lines )
   {
      String t = l.Trimmed();
      if ( !t.StartsWith( "#include \"" ) )
         continue;
      size_type q1 = t.Find( '\"' );
      size_type q2 = t.Find( '\"', q1+1 );
      if ( q2 == String::notFound )
         continue;
      String inc = t.Substring( q1+1, q2-q1-1 );
      bool absolute = inc.StartsWith( '/' ) || (inc.Length() > 1 && inc[1] == ':');
      if ( !absolute )
         l = u"#include \"" + File::FullPath( PiCopilotUtil::JoinPath( watcherDir, inc ) ) + u"\"";
   }

   lib.Clear();
   for ( const String& l : lines )
      lib << l << '\n';
   return true;
}

// Ejecuta un script de modelo como fichero (con preprocesador) sobre la biblioteca del watcher, para que tenga
// blindSolve y realces.js. El valor final se escribe en un fichero y se devuelve (o "PICOPILOT_ERROR: ...").
// El runner del MCP picopilot como biblioteca: trae el motor de BlindSolver, blindSolve y todas las funciones de
// la guía por #include. Se quita la llamada final pprMain() y los #include relativos pasan a rutas absolutas.
static bool RunnerLibrary( const String& runner, String& lib, String& whyNot )
{
   String source = PiCopilotUtil::ReadText( runner );
   if ( source.IsEmpty() )
   {
      whyNot = u"No se encuentra el runner de picopilot en " + runner;
      return false;
   }
   StringList lines;
   source.Break( lines, '\n' );
   bool found = false;
   for ( size_type i = lines.Length(); i > 0; --i )
      if ( lines[i-1].Trimmed() == "pprMain();" )
      {
         lines[i-1] = "// pprMain();  (desactivado por PiCopilot)";
         found = true;
         break;
      }
   if ( !found )
   {
      whyNot = u"El runner de picopilot no termina con pprMain(); no sé cómo adaptarlo.";
      return false;
   }
   // runner es una ruta completa con / (PicopilotRunner).
   String dir = runner.Left( runner.FindLast( '/' ) );
   for ( String& l : lines )
   {
      String t = l.Trimmed();
      if ( !t.StartsWith( "#include \"" ) )
         continue;
      size_type q1 = t.Find( '\"' );
      size_type q2 = t.Find( '\"', q1+1 );
      if ( q2 == String::notFound )
         continue;
      String inc = t.Substring( q1+1, q2-q1-1 );
      bool absolute = inc.StartsWith( '/' ) || (inc.Length() > 1 && inc[1] == ':');
      if ( !absolute )
         l = u"#include \"" + File::FullPath( PiCopilotUtil::JoinPath( dir, inc ) ) + u"\"";
   }
   lib.Clear();
   for ( const String& l : lines )
      lib << l << '\n';
   return true;
}

String PiCopilotInterface::RunWithWatcher( const String& code, const String& prelude )
{
   // Desde la build 78 la biblioteca es el runner de picopilot; el watcher antiguo sólo si falta.
   String lib, whyNot;
   String runner = m_cfg.PicopilotRunner();
   if ( runner.IsEmpty() ? !WatcherLibrary( lib, whyNot ) : !RunnerLibrary( runner, lib, whyNot ) )
      return u"PICOPILOT_ERROR: " + whyNot;
   String id = PiCopilotUtil::NewId();
   String scriptPath = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"run_" + id + u".js" );
   String outPath = PiCopilotUtil::JoinPath( m_cfg.TempDir(), u"run_" + id + u".txt" );
   String outJs = outPath;
   outJs.ReplaceString( u"\\", u"/" );
   // El preprocesador de PixInsight quita los comentarios "//" y "/*" aunque estén dentro de un texto entre comillas
   // (5 nov 2026: el código del modelo empezaba con un comentario y el script se cortaba): se escapan las barras.
   String quoted = JsonValue::Quote( code );
   quoted.ReplaceString( u"/", u"\\/" );
   String script = lib + u"\n" + prelude +
      u"var __pcRes;\ntry { __pcRes = eval(" + quoted + u"); }\n"
      u"catch (__pcErr) { __pcRes = \"PICOPILOT_ERROR: \" + ((__pcErr && __pcErr.message) ? __pcErr.message : String(__pcErr)) + "
      u"((__pcErr && __pcErr.lineNumber) ? \" (línea \" + __pcErr.lineNumber + \" del script)\" : \"\"); }\n"
      u"File.writeTextFile(\"" + outJs + u"\", (__pcRes === undefined || __pcRes === null) ? \"\" : String(__pcRes));\n";
   if ( !PiCopilotUtil::WriteText( scriptPath, script ) )
      return u"PICOPILOT_ERROR: No se pudo escribir " + scriptPath;
   String out;
   try
   {
      Console console;
      console.ExecuteScript( scriptPath );
      if ( File::Exists( outPath ) )
         out = PiCopilotUtil::ReadText( outPath );
      else   // no llegó al final: error de sintaxis o de PixInsight, que sale en la consola
         out = u"PICOPILOT_ERROR: el script no llegó a terminar (error de sintaxis o de PixInsight; el detalle está en la consola)";
   }
   catch ( const Error& e )
   {
      out = u"PICOPILOT_ERROR: " + e.Message();
   }
   catch ( ... )
   {
      out = u"PICOPILOT_ERROR: error al ejecutar el script con el watcher";
   }
   try { File::Remove( scriptPath ); } catch ( ... ) {}
   try { if ( File::Exists( outPath ) ) File::Remove( outPath ); } catch ( ... ) {}
   return out;
}

static int PendingCommands( const String& commandsDir )
{
   int n = 0;
   try
   {
      if ( !File::DirectoryExists( commandsDir ) )
         return 0;
      File::Find f;
      f.Begin( commandsDir + "/*.json" );
      FindFileInfo info;
      while ( f.NextItem( info ) )
         if ( !info.IsDirectory() )
            ++n;
   }
   catch ( ... )
   {
   }
   return n;
}

void PiCopilotInterface::PollMcp()
{
   if ( m_mcpRunning )
      return;

   String bridge = PiCopilotConfig::BridgeDir();

   // Compatibilidad con mcp-stop.bat: el archivo "shutdown" apaga el watcher.
   String shutdownFile = bridge + "/shutdown";
   if ( File::Exists( shutdownFile ) )
   {
      try
      {
         File::Remove( shutdownFile );
      }
      catch ( ... )
      {
      }
      if ( m_cfg.watcherEnabled )
      {
         m_cfg.watcherEnabled = false;
         m_cfg.Save();
         CopilotLog( u"Watcher MCP detenido (archivo shutdown)." );
         if ( GUI != nullptr )
            GUI->Mcp_CheckBox.SetChecked( false );
      }
   }

   if ( !m_cfg.watcherEnabled )
      return;
   if ( File::Exists( bridge + "/pause" ) )
      return;
   if ( NowSeconds() < m_mcpRetryAt )
      return;
   int pending = PendingCommands( bridge + "/commands" );
   if ( pending == 0 )
      return;

   String whyNot;
   if ( !PrepareMcpRunner( whyNot ) )
   {
      if ( whyNot != m_mcpLastError )
         CopilotLog( u"Watcher MCP: " + whyNot );
      m_mcpLastError = whyNot;
      m_mcpRetryAt = NowSeconds() + 10;
      UpdateMcpStatus();
      return;
   }

   m_mcpRunning = true;
   UpdateMcpStatus();
   try
   {
      Console console;
      console.ExecuteScript( m_cfg.McpRunnerPath() );
      // Cada pasada atiende como mucho 5 comandos (ver s_mcpRunnerTail).
      m_mcpCount += Min( pending, 5 );
      m_mcpLastError.Clear();
   }
   catch ( const Error& e )
   {
      // Por ejemplo, si el usuario tiene otro script en marcha: se reintenta luego.
      if ( e.Message() != m_mcpLastError )
         CopilotLog( u"Watcher MCP: no se pudo ejecutar (" + e.Message() + u"). Reintento en 5 s." );
      m_mcpLastError = e.Message();
      m_mcpRetryAt = NowSeconds() + 5;
   }
   catch ( ... )
   {
      m_mcpLastError = u"error desconocido";
      m_mcpRetryAt = NowSeconds() + 5;
   }
   m_mcpRunning = false;
   UpdateMcpStatus();
}

void PiCopilotInterface::UpdateMcpStatus()
{
   if ( GUI == nullptr )
      return;
   String s;
   if ( !m_cfg.watcherEnabled )
      s = Tr( u"apagado" );
   else if ( m_mcpRunning )
      s = Tr( u"ejecutando comando..." );
   else if ( File::Exists( PiCopilotConfig::BridgeDir() + "/pause" ) )
      s = Tr( u"en pausa" );
   else if ( !m_mcpLastError.IsEmpty() )
      s = Tr( u"error (ver consola)" );
   else
      s = Tr( u"escuchando" );
   if ( m_mcpCount > 0 )
      s << u" · " << String().Format( "%d", m_mcpCount ) << u" cmd";
   GUI->Mcp_Label.SetText( s );
   GUI->Mcp_Label.SetToolTip( m_mcpLastError.IsEmpty() ? String() : m_mcpLastError );
}

// ----------------------------------------------------------------------------

void PiCopilotInterface::e_Timer( Timer& )
{
   if ( m_busy )
      UpdateStatus();

   if ( m_retryPending && m_busy )
   {
      m_retryPending = false;
      if ( !StartHttp() )
         FinishJob( Tr( u"No se pudo repetir la petición al modelo." ), true );
   }

   // Interpretación / corrección pendiente de un script: se lanza aquí, fuera de RunScript y de cualquier evento.
   if ( m_queued.pending && !m_busy && !m_scriptRunning && !m_inTimer && !m_inProcessEvent )
   {
      m_queued.pending = false;
      struct TimerGuard2 { bool& f; TimerGuard2( bool& x ) : f( x ) { f = true; } ~TimerGuard2() { f = false; } } tg2( m_inTimer );
      if ( !StartJob( m_queued.kind, m_queued.title, m_queued.prompt, false ) && m_autoChain )
         StopAutoChain( Tr( u"no se ha podido pedir el paso siguiente" ) );
   }

   // Serie de pasos: el script que trajo la última respuesta se ejecuta aquí, fuera del evento que la terminó, nunca
   // dentro de otro tic (los scripts procesan eventos y el temporizador se reentra) ni de un evento del proceso.
   if ( m_autoRunPending && !m_queued.pending && !m_busy && !m_scriptRunning && !m_inTimer && !m_inProcessEvent && NowSeconds() >= m_autoRunAt )
   {
      m_autoRunPending = false;
      if ( m_autoChain && !m_autoScript.IsEmpty() )
      {
         ++m_autoSteps;
         String code = m_autoScript;
         m_autoScript.Clear();
         String first = code.Trimmed();
         size_type nl = first.Find( '\n' );
         if ( nl != String::notFound )
            first = first.Left( nl );
         CopilotLog( String().Format( "Serie de pasos: script %d: ", m_autoSteps ) + first.Left( 120 ) );
         struct TimerGuard { bool& f; TimerGuard( bool& x ) : f( x ) { f = true; } ~TimerGuard() { f = false; } } tg( m_inTimer );
         RunScript( code, false );
      }
   }

   PollMcp();
   UpdateMcpStatus();

   // Dossiers pendientes: se abren en cuanto el modelo (o el script) los escribe.
   double now = NowSeconds();
   for ( size_t i = 0; i < m_pendingDossiers.size(); )
   {
      const PendingDossier& d = m_pendingDossiers[i];
      bool done = false;
      if ( File::Exists( d.path ) )
      {
         JsonValue v;
         String whyNot;
         IsoString raw;
         try
         {
            raw = File::ReadTextFile( d.path );
         }
         catch ( ... )
         {
         }
         if ( JsonValue::Parse( raw, v, whyNot ) ) // si aún se está escribiendo, se reintenta
         {
            CopilotLog( u"Dossier listo: " + d.path );
            // En la resolución completa el modelo elige y sigue solo: la ventana no se abre (Rafael, 6 nov 2026).
            if ( d.quiet )
               Chat().AppendInfo( Tr( u"Dossier escrito (el modelo elige y sigue solo, no se abre): " ) + d.path );
            else
               ShowDossier( d.path );
            done = true;
         }
      }
      else if ( now - d.since > 4*3600 )
         done = true;

      if ( done )
         m_pendingDossiers.erase( m_pendingDossiers.begin() + i );
      else
         ++i;
   }
}

void PiCopilotInterface::e_Click( Button& sender, bool /*checked*/ )
{
   if ( sender == GUI->Prompt_Button )
   {
      UpdateView();
      Chat().Launch();
      return;
   }

   if ( sender == GUI->AIConfig_Button )
   {
      m_cfg.LoadScores();   // relee la tabla por si se ha editado
      PiCopilotAIConfigDialog dlg( m_cfg, m_cfg.Current() );
      if ( dlg.Execute() )
      {
         m_cfg.Save();
         CopilotLog( String().Format( "Configurar IA guardado (N = %d).", m_cfg.threshold ) );
      }
      return;
   }

   if ( sender == GUI->AddModel_ToolButton )
   {
      PiCopilotAddModelDialog dlg;
      if ( dlg.Execute() )
      {
         m_cfg.models.push_back( dlg.Model() );
         m_cfg.currentModel = int( m_cfg.models.size() ) - 1;
         m_cfg.Save();
         UpdateModelList();
         UpdateControls();
      }
      return;
   }

   if ( sender == GUI->RemoveModel_ToolButton )
   {
      const PiCopilotModel& m = m_cfg.Current();
      if ( m.builtin )
         return;
      if ( MessageBox( Tr( u"¿Quitar el modelo \"" ) + m.name + Tr( u"\" de la lista?" ), "PiCopilot",
                       StdIcon::Question, StdButton::Yes, StdButton::No ).Execute() == StdButton::Yes )
      {
         m_cfg.models.erase( m_cfg.models.begin() + m_cfg.currentModel );
         m_cfg.currentModel = 0;
         m_cfg.Save();
         UpdateModelList();
         UpdateControls();
      }
      return;
   }

   if ( sender == GUI->Full_Button )
   {
      LaunchFull();
      return;
   }

   if ( sender == GUI->Cancel_Button )
   {
      if ( m_autoChain || m_autoRunPending )
         StopAutoChain( Tr( u"cancelada por el usuario" ) );
      if ( m_busy && m_process )
      {
         m_job.cancelled = true;
         m_process->Kill();
      }
      return;
   }

   if ( sender == GUI->Mcp_CheckBox )
   {
      m_cfg.watcherEnabled = GUI->Mcp_CheckBox.IsChecked();
      m_cfg.Save();
      m_mcpRetryAt = 0;
      m_mcpLastError.Clear();
      CopilotLog( m_cfg.watcherEnabled ? String( u"Watcher MCP activado." ) : String( u"Watcher MCP apagado." ) );
      UpdateMcpStatus();
      return;
   }

   if ( sender == GUI->Watcher_ToolButton )
   {
      OpenFileDialog d;
      d.SetCaption( Tr( u"Script del watcher MCP (pixinsight-mcp-watcher.js)" ) );
      d.SetFilter( FileFilter( "JavaScript", ".js" ) );
      d.SetInitialPath( m_cfg.watcherSource );
      if ( d.Execute() )
      {
         m_cfg.watcherSource = d.FileName();
         m_cfg.Save();
         m_mcpLastError.Clear();
         UpdateControls();
      }
      return;
   }

   if ( sender == GUI->Guide_ToolButton || sender == GUI->Work_ToolButton )
   {
      bool guide = sender == GUI->Guide_ToolButton;
      GetDirectoryDialog d;
      d.SetCaption( guide ? String( Tr( u"Carpeta guia/ de la guía de procesado" ) ) : String( Tr( u"Carpeta de trabajo de PiCopilot" ) ) );
      d.SetInitialPath( guide ? m_cfg.guideDir : m_cfg.workDir );
      if ( d.Execute() )
      {
         (guide ? m_cfg.guideDir : m_cfg.workDir) = d.Directory();
         m_cfg.Save();
         UpdateControls();
      }
      return;
   }

   for ( size_t i = 0; i < GUI->linearButtons.size(); ++i )
      if ( sender == *GUI->linearButtons[i] )
      {
         LaunchStep( PiCopilotStep::Linear()[i] );
         return;
      }
   for ( size_t i = 0; i < GUI->nonLinearButtons.size(); ++i )
      if ( sender == *GUI->nonLinearButtons[i] )
      {
         LaunchStep( PiCopilotStep::NonLinear()[i] );
         return;
      }
}

void PiCopilotInterface::e_ItemSelected( ComboBox& sender, int itemIndex )
{
   if ( sender == GUI->Model_ComboBox )
   {
      if ( itemIndex >= 0 && itemIndex < int( m_cfg.models.size() ) && itemIndex != m_cfg.currentModel )
      {
         m_cfg.currentModel = itemIndex;
         m_cfg.Save();
         // Cada modelo empieza su propia conversación.
         ResetChat();
         if ( m_chat )
            m_chat->AppendInfo( Tr( u"--- Modelo cambiado a " ) + m_cfg.Current().name + u" ---" );
      }
      UpdateControls();
   }
   else if ( sender == GUI->Language_ComboBox )
   {
      String lang = (itemIndex == 1) ? "en" : "es";
      if ( lang != m_cfg.uiLanguage )
      {
         m_cfg.uiLanguage = lang;
         m_cfg.Save();
         // Los textos ya creados no cambian: se avisa en el idioma elegido.
         SetPiCopilotEnglish( lang == "en" );
         MessageBox( Tr( u"Idioma cambiado: se aplicará al volver a abrir PiCopilot." ), "PiCopilot",
                     StdIcon::Information, StdButton::Ok ).Execute();
      }
   }
}

void PiCopilotInterface::e_EditCompleted( Edit& sender )
{
   String t = sender.Text().Trimmed();
   if ( sender == GUI->Guide_Edit )
      m_cfg.guideDir = t.IsEmpty() ? PiCopilotConfig::DefaultGuideDir() : t;
   else if ( sender == GUI->Work_Edit )
      m_cfg.workDir = t.IsEmpty() ? PiCopilotConfig::DefaultWorkDir() : t;
   else if ( sender == GUI->Claude_Edit )
      m_cfg.claudePath = t.IsEmpty() ? PiCopilotConfig::DefaultClaudePath() : t;
   else if ( sender == GUI->ClaudeArgs_Edit )
      m_cfg.claudeArgs = t;
   else if ( sender == GUI->Data_Edit )
      m_cfg.dataDirs = t;
   else if ( sender == GUI->Watcher_Edit )
   {
      m_cfg.watcherSource = t.IsEmpty() ? PiCopilotConfig::DefaultWatcherSource() : t;
      m_mcpLastError.Clear();
   }
   else
      return;
   m_cfg.Save();
   UpdateControls();
}

void PiCopilotInterface::e_ToggleSection( SectionBar& /*sender*/, Control& /*section*/, bool start )
{
   if ( start )
      SetVariableHeight();
   else
   {
      AdjustToContents();
      SetFixedHeight();
   }
}

// ----------------------------------------------------------------------------
// Construcción del panel
// ----------------------------------------------------------------------------

static void BuildStepButtons( PiCopilotInterface& w,
                              const std::vector<PiCopilotStep>& steps,
                              std::vector<std::unique_ptr<PushButton>>& buttons,
                              std::vector<std::unique_ptr<HorizontalSizer>>& rows,
                              VerticalSizer& sizer, Control& parent,
                              Button::click_event_handler handler )
{
   sizer.SetSpacing( 4 );
   for ( size_t i = 0; i < steps.size(); ++i )
   {
      const PiCopilotStep& s = steps[i];
      PushButton* b = new PushButton( String(), Bitmap::Null(), parent );
      b->SetText( Tr( s.label ) );
      String tip = u"<p><b>" + Tr( s.label ) + Tr( u"</b></p><p>Pide al modelo seleccionado que ejecute este paso de la guía (" ) +
                   s.file + u")" + (s.needsImage ? String( Tr( u" sobre la imagen activa" ) ) : String()) + u".</p>";
      if ( s.comparative )
         tip << Tr( u"<p>Hace un análisis previo, compara varios métodos (GraXpert, MGC, DBE...) con 2 o 3 valores cada uno "
                u"sobre copias, y al final abre un dossier con las imágenes, las métricas y la recomendación del modelo. "
                u"Tú eliges la que prefieras.</p>" );
      b->SetToolTip( tip );
      b->OnClick( handler, w );
      buttons.emplace_back( b );
   }
   for ( size_t i = 0; i < buttons.size(); i += 2 )
   {
      HorizontalSizer* row = new HorizontalSizer;
      row->SetSpacing( 4 );
      row->Add( *buttons[i], 50 );
      if ( i+1 < buttons.size() )
         row->Add( *buttons[i+1], 50 );
      else
         row->AddStretch( 50 );
      sizer.Add( *row );
      rows.emplace_back( row );
   }
   parent.SetSizer( sizer );
}

static void MakeSeparator( Control& c )
{
   c.SetFixedHeight( 1 );
   c.SetStyleSheet( "QWidget { background-color: palette(mid); }" );
}

PiCopilotInterface::GUIData::GUIData( PiCopilotInterface& w )
{
   pcl::Font font = w.Font();
   int labelWidth = font.Width( String( Tr( u"Carpeta de trabajo:" ) ) );

   //

   Title_Label.EnableRichText();
   Title_Label.SetText( u"<b>PiCopilot</b>" );
   Title_Label.SetStyleSheet( "QLabel { font-size: 12pt; }" );

   View_Label.SetToolTip( Tr( u"<p>Imagen sobre la que actuarán los botones: la vista activa en PixInsight.</p>" ) );

   //

   Model_Label.SetText( Tr( u"Seleccionar modelo" ) );

   Model_ComboBox.SetToolTip( Tr( u"<p>Modelo que atenderá el Prompt y los botones.</p>"
                              u"<p><b>Claude</b>: Claude Code en segundo plano, con el MCP de PixInsight; "
                              u"ejecuta los pasos sobre la imagen.<br/>"
                              u"<b>Codex</b>: Codex CLI de OpenAI con el MCP de PixInsight (npm install -g @openai/codex y codex login).<br/>"
                              u"<b>Modelos locales</b>: API OpenAI-compatible (Strata, Ollama, LM Studio).</p>"
                              u"<p>Con los modelos locales la respuesta incluye un script PJSR que puedes "
                              u"revisar y ejecutar desde la ventana de Prompt.</p>" ) );
   Model_ComboBox.OnItemSelected( (ComboBox::item_event_handler)&PiCopilotInterface::e_ItemSelected, w );

   AddModel_ToolButton.SetText( "+" );
   AddModel_ToolButton.SetScaledFixedSize( 22, 22 );
   AddModel_ToolButton.SetToolTip( Tr( u"<p>Añadir un modelo local u OpenAI-compatible.</p>" ) );
   AddModel_ToolButton.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );

   RemoveModel_ToolButton.SetText( u"−" );
   RemoveModel_ToolButton.SetScaledFixedSize( 22, 22 );
   RemoveModel_ToolButton.SetToolTip( Tr( u"<p>Quitar el modelo seleccionado (sólo los añadidos por ti).</p>" ) );
   RemoveModel_ToolButton.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );

   Model_Sizer.SetSpacing( 4 );
   Model_Sizer.Add( Model_ComboBox, 100 );
   Model_Sizer.Add( AddModel_ToolButton );
   Model_Sizer.Add( RemoveModel_ToolButton );

   Prompt_Button.SetText( Tr( u"Prompt" ) );
   Prompt_Button.SetToolTip( Tr( u"<p>Abre la ventana de Prompt para hablar con el modelo seleccionado. "
                             u"Ahí aparecen también las respuestas de los botones.</p>" ) );
   Prompt_Button.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );

   AIConfig_Button.SetText( Tr( u"Configurar IA" ) );
   AIConfig_Button.SetToolTip( Tr( u"<p>Umbral N y puntuación de cada paso para elegir entre el modelo inferior "
                               u"(p. ej. Sonnet) y el superior (p. ej. Opus). Sólo con Claude o Codex.</p>" ) );
   AIConfig_Button.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );

   Prompt_Sizer.SetSpacing( 4 );
   Prompt_Sizer.Add( Prompt_Button, 50 );
   Prompt_Sizer.Add( AIConfig_Button, 50 );

   MakeSeparator( Separator1_Control );

   //

   Linear_SectionBar.SetTitle( Tr( u"Fase Lineal" ) );
   Linear_SectionBar.SetSection( Linear_Control );
   Linear_SectionBar.OnToggleSection( (SectionBar::section_event_handler)&PiCopilotInterface::e_ToggleSection, w );
   BuildStepButtons( w, PiCopilotStep::Linear(), linearButtons, stepRows, Linear_Sizer, Linear_Control,
                     (Button::click_event_handler)&PiCopilotInterface::e_Click );

   NonLinear_SectionBar.SetTitle( Tr( u"Fase No Lineal" ) );
   NonLinear_SectionBar.SetSection( NonLinear_Control );
   NonLinear_SectionBar.OnToggleSection( (SectionBar::section_event_handler)&PiCopilotInterface::e_ToggleSection, w );
   BuildStepButtons( w, PiCopilotStep::NonLinear(), nonLinearButtons, stepRows, NonLinear_Sizer, NonLinear_Control,
                     (Button::click_event_handler)&PiCopilotInterface::e_Click );

   Full_Button.SetText( Tr( u"Resolución Completa" ) );
   Full_Button.SetToolTip( Tr( u"<p>Procesa la imagen activa de principio a fin siguiendo la guía "
                           u"(sólo con Claude o Codex).</p>" ) );
   Full_Button.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );

   MakeSeparator( Separator2_Control );

   //

   Status_Label.SetText( Tr( u"Listo." ) );
   Status_Label.SetTextAlignment( TextAlign::Left|TextAlign::VertCenter );

   Cancel_Button.SetText( Tr( u"Cancelar" ) );
   Cancel_Button.SetToolTip( Tr( u"<p>Detiene la petición en curso.</p>" ) );
   Cancel_Button.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );
   Cancel_Button.Hide();

   Status_Sizer.SetSpacing( 4 );
   Status_Sizer.Add( Status_Label, 100 );
   Status_Sizer.Add( Cancel_Button );

   //

   Guide_Label.SetText( Tr( u"Guía:" ) );
   Guide_Label.SetFixedWidth( labelWidth );
   Guide_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Guide_Edit.SetToolTip( Tr( u"<p>Carpeta <i>guia/</i> de la guía de procesado (SKILL.md, lineal/, no-lineal/...).</p>" ) );
   Guide_Edit.OnEditCompleted( (Edit::edit_event_handler)&PiCopilotInterface::e_EditCompleted, w );
   Guide_ToolButton.SetIcon( w.ScaledResource( ":/icons/select-file.png" ) );
   Guide_ToolButton.SetScaledFixedSize( 20, 20 );
   Guide_ToolButton.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );
   Guide_Sizer.SetSpacing( 4 );
   Guide_Sizer.Add( Guide_Label );
   Guide_Sizer.Add( Guide_Edit, 100 );
   Guide_Sizer.Add( Guide_ToolButton );

   Work_Label.SetText( Tr( u"Carpeta de trabajo:" ) );
   Work_Label.SetFixedWidth( labelWidth );
   Work_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Work_Edit.SetToolTip( Tr( u"<p>Donde PiCopilot guarda los dossiers (dossiers/) y los archivos temporales (tmp/).</p>" ) );
   Work_Edit.OnEditCompleted( (Edit::edit_event_handler)&PiCopilotInterface::e_EditCompleted, w );
   Work_ToolButton.SetIcon( w.ScaledResource( ":/icons/select-file.png" ) );
   Work_ToolButton.SetScaledFixedSize( 20, 20 );
   Work_ToolButton.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );
   Work_Sizer.SetSpacing( 4 );
   Work_Sizer.Add( Work_Label );
   Work_Sizer.Add( Work_Edit, 100 );
   Work_Sizer.Add( Work_ToolButton );

   Claude_Label.SetText( Tr( u"Claude Code:" ) );
   Claude_Label.SetFixedWidth( labelWidth );
   Claude_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Claude_Edit.SetToolTip( Tr( u"<p>Ruta de claude.exe.</p>" ) );
   Claude_Edit.OnEditCompleted( (Edit::edit_event_handler)&PiCopilotInterface::e_EditCompleted, w );
   Claude_Sizer.SetSpacing( 4 );
   Claude_Sizer.Add( Claude_Label );
   Claude_Sizer.Add( Claude_Edit, 100 );

   ClaudeArgs_Label.SetText( Tr( u"Argumentos:" ) );
   ClaudeArgs_Label.SetFixedWidth( labelWidth );
   ClaudeArgs_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   ClaudeArgs_Edit.SetToolTip( Tr( u"<p>Argumentos extra para <i>claude -p</i>. Por defecto permite sin preguntar los MCP "
                               u"de PiCopilot y PixInsight y leer/escribir archivos en la guía y la carpeta de trabajo.</p>" ) );
   ClaudeArgs_Edit.OnEditCompleted( (Edit::edit_event_handler)&PiCopilotInterface::e_EditCompleted, w );
   ClaudeArgs_Sizer.SetSpacing( 4 );
   ClaudeArgs_Sizer.Add( ClaudeArgs_Label );
   ClaudeArgs_Sizer.Add( ClaudeArgs_Edit, 100 );

   Data_Label.SetText( Tr( u"Carpetas de datos:" ) );
   Data_Label.SetFixedWidth( labelWidth );
   Data_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Data_Edit.SetToolTip( Tr( u"<p>Carpetas que Claude puede leer (masters, subs, tomas cortas, cabeceras...), "
                         u"separadas por punto y coma. Por ejemplo: <i>D:/Astro/datos</i>.</p>" ) );
   Data_Edit.OnEditCompleted( (Edit::edit_event_handler)&PiCopilotInterface::e_EditCompleted, w );
   Data_Sizer.SetSpacing( 4 );
   Data_Sizer.Add( Data_Label );
   Data_Sizer.Add( Data_Edit, 100 );

   Mcp_CheckBox.SetText( Tr( u"Watcher MCP" ) );
   Mcp_CheckBox.SetToolTip( Tr( u"<p>Atiende los comandos del MCP de PixInsight (los que usa Claude) desde el propio "
                            u"módulo, sin tener abierto el script del watcher. No lances a la vez el script antiguo.</p>"
                            u"<p>mcp-pause.bat / mcp-resume.bat siguen funcionando; mcp-stop.bat lo apaga.</p>" ) );
   Mcp_CheckBox.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );
   Mcp_Label.SetTextAlignment( TextAlign::Left|TextAlign::VertCenter );
   Mcp_Sizer.SetSpacing( 6 );
   Mcp_Sizer.Add( Mcp_CheckBox );
   Mcp_Sizer.Add( Mcp_Label, 100 );

   Watcher_Label.SetText( Tr( u"Watcher MCP:" ) );
   Watcher_Label.SetFixedWidth( labelWidth );
   Watcher_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Watcher_Edit.SetToolTip( Tr( u"<p>Script pixinsight-mcp-watcher.js del que PiCopilot toma los comandos del MCP. "
                            u"Se relee en cada comando: si lo cambias, no hace falta recompilar el módulo.</p>" ) );
   Watcher_Edit.OnEditCompleted( (Edit::edit_event_handler)&PiCopilotInterface::e_EditCompleted, w );
   Watcher_ToolButton.SetIcon( w.ScaledResource( ":/icons/select-file.png" ) );
   Watcher_ToolButton.SetScaledFixedSize( 20, 20 );
   Watcher_ToolButton.OnClick( (Button::click_event_handler)&PiCopilotInterface::e_Click, w );
   Watcher_Sizer.SetSpacing( 4 );
   Watcher_Sizer.Add( Watcher_Label );
   Watcher_Sizer.Add( Watcher_Edit, 100 );
   Watcher_Sizer.Add( Watcher_ToolButton );

   // Idioma de la interfaz (se aplica al volver a abrir el panel).
   Language_Label.SetText( Tr( u"Idioma:" ) );
   Language_Label.SetFixedWidth( labelWidth );
   Language_Label.SetTextAlignment( TextAlign::Right|TextAlign::VertCenter );
   Language_ComboBox.AddItem( u"Español" );
   Language_ComboBox.AddItem( u"English" );
   Language_ComboBox.SetCurrentItem( w.m_cfg.uiLanguage == "en" ? 1 : 0 );
   Language_ComboBox.SetToolTip( Tr( u"<p>Idioma de los textos de PiCopilot. Se aplica al volver a abrir el panel.</p>" ) );
   Language_ComboBox.OnItemSelected( (ComboBox::item_event_handler)&PiCopilotInterface::e_ItemSelected, w );
   Language_Sizer.SetSpacing( 4 );
   Language_Sizer.Add( Language_Label );
   Language_Sizer.Add( Language_ComboBox );
   Language_Sizer.AddStretch();

   Config_Sizer.SetSpacing( 4 );
   Config_Sizer.Add( Language_Sizer );
   Config_Sizer.Add( Guide_Sizer );
   Config_Sizer.Add( Work_Sizer );
   Config_Sizer.Add( Claude_Sizer );
   Config_Sizer.Add( ClaudeArgs_Sizer );
   Config_Sizer.Add( Data_Sizer );
   Config_Sizer.Add( Watcher_Sizer );
   Config_Control.SetSizer( Config_Sizer );

   Config_SectionBar.SetTitle( Tr( u"Configuración" ) );
   Config_SectionBar.SetSection( Config_Control );
   Config_SectionBar.OnToggleSection( (SectionBar::section_event_handler)&PiCopilotInterface::e_ToggleSection, w );

   //

   Global_Sizer.SetMargin( 8 );
   Global_Sizer.SetSpacing( 6 );
   Global_Sizer.Add( Title_Label );
   Global_Sizer.Add( View_Label );
   Global_Sizer.Add( Model_Label );
   Global_Sizer.Add( Model_Sizer );
   Global_Sizer.Add( Prompt_Sizer );
   Global_Sizer.AddSpacing( 4 );
   Global_Sizer.Add( Separator1_Control );
   Global_Sizer.AddSpacing( 4 );
   Global_Sizer.Add( Linear_SectionBar );
   Global_Sizer.Add( Linear_Control );
   Global_Sizer.Add( NonLinear_SectionBar );
   Global_Sizer.Add( NonLinear_Control );
   Global_Sizer.Add( Full_Button );
   Global_Sizer.AddSpacing( 4 );
   Global_Sizer.Add( Separator2_Control );
   Global_Sizer.Add( Status_Sizer );
   Global_Sizer.Add( Mcp_Sizer );
   Global_Sizer.Add( Config_SectionBar );
   Global_Sizer.Add( Config_Control );

   w.SetSizer( Global_Sizer );

   Config_Control.Hide();

   w.EnsureLayoutUpdated();
   w.AdjustToContents();
   w.SetFixedWidth();
   w.SetFixedHeight();

   //

   UpdateTimer.SetInterval( 1.0 );
   UpdateTimer.SetPeriodic( true );
   UpdateTimer.OnTimer( (Timer::timer_event_handler)&PiCopilotInterface::e_Timer, w );
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotInterface.cpp
