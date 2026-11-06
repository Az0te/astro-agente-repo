// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotInterface.h - Panel lateral de PiCopilot.
//
// El panel es una ProcessInterface normal, así que se puede acoplar a los
// paneles laterales de PixInsight. Las peticiones a los modelos se lanzan como
// procesos externos asíncronos (ExternalProcess): la interfaz recibe eventos
// cuando hay salida o cuando terminan, y PixInsight nunca queda bloqueado.
// ----------------------------------------------------------------------------

#ifndef __PiCopilotInterface_h
#define __PiCopilotInterface_h

#include <pcl/CheckBox.h>
#include <pcl/ComboBox.h>
#include <pcl/Control.h>
#include <pcl/Edit.h>
#include <pcl/ExternalProcess.h>
#include <pcl/Label.h>
#include <pcl/ProcessInterface.h>
#include <pcl/PushButton.h>
#include <pcl/SectionBar.h>
#include <pcl/Sizer.h>
#include <pcl/Timer.h>
#include <pcl/ToolButton.h>

#include "PiCopilotAgent.h"
#include "PiCopilotInstance.h"

#include <memory>
#include <utility>
#include <vector>

namespace pcl
{

class PiCopilotChatDialog;
class PiCopilotDossierDialog;

// ----------------------------------------------------------------------------

class PiCopilotInterface : public ProcessInterface
{
public:

   PiCopilotInterface();
   virtual ~PiCopilotInterface();

   IsoString Id() const override;
   MetaProcess* Process() const override;
   String IconImageSVGFile() const override;
   InterfaceFeatures Features() const override;
   void ApplyInstance() const override;
   void ResetInstance() override;
   bool Launch( const MetaProcess&, const ProcessImplementation*, bool& dynamic, unsigned& /*flags*/ ) override;
   ProcessImplementation* NewProcess() const override;
   bool ValidateProcess( const ProcessImplementation&, String& whyNot ) const override;
   bool RequiresInstanceValidation() const override;
   bool ImportProcess( const ProcessImplementation& ) override;
   bool WantsImageNotifications() const override;
   void ImageFocused( const View& ) override;

   // Llamadas desde la ventana de Prompt.
   bool SubmitChat( const String& text );
   void ResetChat();
   void CleanTempFiles();   // previas y scripts temporales (también al pulsar Limpiar)
   void RunScript( const String& code );

   bool IsBusy() const { return m_busy; }

private:

   PiCopilotInstance m_instance;
   PiCopilotConfig   m_cfg;

   // Trabajo en curso (uno a la vez).
   // Fix: corrección de un script que ha fallado; Interpret: interpretar lo que ha medido el script.
   enum class JobKind { Chat, Step, Full, Fix, Interpret };

   int  m_scriptFixes = 0;          // correcciones pedidas seguidas para el script de la tarea actual
   bool m_interpretPending = false; // falta devolverle al modelo el resultado del script de la tarea
   bool m_scriptWaiting = false;    // hay un script propuesto que el usuario aún no ha ejecutado
   bool m_scriptRunning = false;    // se está ejecutando un script de la respuesta (estado del panel)

   struct Job
   {
      JobKind        kind = JobKind::Chat;
      String         title;
      PiCopilotModel model;
      String         viewId;
      IsoString      stdinData;
      ByteArray      out;
      ByteArray      err;
      size_type      parsed = 0;       // bytes de stdout ya procesados (stream-json)
      String         resultText;       // resultado final (Claude)
      String         pendingText;      // último texto aún no mostrado (stream-json)
      String         tierModel;        // modelo inferior/superior elegido (Configurar IA)
      bool           resultIsError = false;
      StringList     tempFiles;
      double         startTime = 0;
      bool           cancelled = false;
      bool           retried = false;  // ya se pidió una vez el script que faltaba
      String         codexLastMessage; // fichero con la respuesta final de codex exec (-o)
   };

   bool m_retryPending = false;        // repetir la petición HTTP en el próximo tic
   String m_nextImage;                 // JPG para el próximo mensaje HTTP (revisión a ojo del estirado)
   String m_lastFailedScript;          // último script que falló (para no reintentar el mismo)

   String MakePreview( const String& viewId );   // JPG reducido (~640 px) de una vista, o vacío
   // JPG reducido (~480 px) con el estirado de refId (todas las previas comparables); los modelos se normalizan.
   String MakeComparePreview( const String& viewId, const String& refId, bool model );
   // Previas de los candidatos de un resultado con "candidatos" (vista y modelo): original, corregidas y modelos.
   std::vector<std::pair<String, String>> CandidatePreviews( const String& resultJson );

   std::unique_ptr<ExternalProcess>  m_process;
   Job                               m_job;
   bool                              m_busy = false;

   // Conversación.
   std::vector<PiCopilotChatMessage> m_history;           // modelos HTTP
   String                            m_claudeSession;     // --session-id / --resume
   bool                              m_claudeSessionStarted = false;
   String                            m_claudePhase;       // "lineal" | "no-lineal" | "completa"

   bool EnterPhase( const String& phase );               // true si empieza sesión nueva

   // Dossiers que esperamos que escriba el modelo.
   struct PendingDossier
   {
      String path;
      double since = 0;
   };
   std::vector<PendingDossier> m_pendingDossiers;

   PiCopilotChatDialog*    m_chat = nullptr;     // ventanas no modales (ProcessInterface)
   PiCopilotDossierDialog* m_dossier = nullptr;

   // Watcher MCP integrado: sustituye al script pixinsight-mcp-watcher.js.
   bool   m_mcpRunning = false;  // ejecutando comandos ahora mismo
   double m_mcpRetryAt = 0;      // tras un error, no reintentar antes de este instante
   int    m_mcpCount = 0;        // comandos atendidos en esta sesión
   String m_mcpLastError;

   String m_viewId;              // vista activa
   bool   m_fullVisible = true;  // botón "Resolución Completa" visible
   bool   m_aiVisible = true;    // botón "Configurar IA" visible

   struct GUIData
   {
      GUIData( PiCopilotInterface& );

      VerticalSizer     Global_Sizer;
         Label             Title_Label;
         Label             View_Label;
         Label             Model_Label;
         HorizontalSizer   Model_Sizer;
            ComboBox          Model_ComboBox;
            ToolButton        AddModel_ToolButton;
            ToolButton        RemoveModel_ToolButton;
         HorizontalSizer   Prompt_Sizer;
            PushButton        Prompt_Button;
            PushButton        AIConfig_Button;
         Control           Separator1_Control;
         SectionBar        Linear_SectionBar;
         Control           Linear_Control;
            VerticalSizer     Linear_Sizer;
         SectionBar        NonLinear_SectionBar;
         Control           NonLinear_Control;
            VerticalSizer     NonLinear_Sizer;
         PushButton        Full_Button;
         Control           Separator2_Control;
         HorizontalSizer   Status_Sizer;
            Label             Status_Label;
            PushButton        Cancel_Button;
         HorizontalSizer   Mcp_Sizer;
            CheckBox          Mcp_CheckBox;
            Label             Mcp_Label;
         SectionBar        Config_SectionBar;
         Control           Config_Control;
            VerticalSizer     Config_Sizer;
               HorizontalSizer   Guide_Sizer;
                  Label             Guide_Label;
                  Edit              Guide_Edit;
                  ToolButton        Guide_ToolButton;
               HorizontalSizer   Work_Sizer;
                  Label             Work_Label;
                  Edit              Work_Edit;
                  ToolButton        Work_ToolButton;
               HorizontalSizer   Claude_Sizer;
                  Label             Claude_Label;
                  Edit              Claude_Edit;
               HorizontalSizer   ClaudeArgs_Sizer;
                  Label             ClaudeArgs_Label;
                  Edit              ClaudeArgs_Edit;
               HorizontalSizer   Data_Sizer;
                  Label             Data_Label;
                  Edit              Data_Edit;
               HorizontalSizer   Watcher_Sizer;
                  Label             Watcher_Label;
                  Edit              Watcher_Edit;
                  ToolButton        Watcher_ToolButton;
               HorizontalSizer   Language_Sizer;
                  Label             Language_Label;
                  ComboBox          Language_ComboBox;

      std::vector<std::unique_ptr<HorizontalSizer>> stepRows;
      std::vector<std::unique_ptr<PushButton>>      linearButtons;
      std::vector<std::unique_ptr<PushButton>>      nonLinearButtons;

      Timer UpdateTimer;
   };

   GUIData* GUI = nullptr;

   void UpdateControls();
   void UpdateModelList();
   void UpdateStatus();
   void UpdateView();
   void UpdateMcpStatus();

   void PollMcp();
   bool PrepareMcpRunner( String& whyNot );
   bool WatcherLibrary( String& lib, String& whyNot );
   String RunWithWatcher( const String& code, const String& prelude );

   PiCopilotChatDialog& Chat();
   void ShowDossier( const String& path );

   void LaunchStep( const PiCopilotStep& step );
   void LaunchFull();
   bool StartJob( JobKind kind, const String& title, const String& prompt, bool newHttpConversation,
                  const String& stepKey = String() );
   bool StartClaude( const String& prompt );
   bool StartCodex( const String& prompt );
   void ParseCodexStream();
   bool StartHttp();
   void FinishJob( const String& response, bool error );
   void ParseClaudeStream( bool final );
   String NewDossierPath( const String& tag );
   bool EnsureDir( const String& dir );

   void e_Click( Button& sender, bool checked );
   void e_ItemSelected( ComboBox& sender, int itemIndex );
   void e_EditCompleted( Edit& sender );
   void e_ToggleSection( SectionBar& sender, Control& section, bool start );
   void e_Timer( Timer& sender );
   void e_ProcessStarted( ExternalProcess& sender );
   void e_ProcessStdout( ExternalProcess& sender );
   void e_ProcessStderr( ExternalProcess& sender );
   void e_ProcessFinished( ExternalProcess& sender, int exitCode, bool exitOk );
   void e_ProcessError( ExternalProcess& sender, ExternalProcess::error_code error );

   friend struct GUIData;
};

// ----------------------------------------------------------------------------

PCL_BEGIN_LOCAL
extern PiCopilotInterface* ThePiCopilotInterface;
PCL_END_LOCAL

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiCopilotInterface_h

// ----------------------------------------------------------------------------
// EOF PiCopilotInterface.h
