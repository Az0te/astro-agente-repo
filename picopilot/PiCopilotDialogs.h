// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotDialogs.h - Ventanas de Prompt (chat), añadir modelo y dossier.
//
// En PixInsight todos los Dialog son modales para la aplicación entera, así
// que las ventanas que deben dejar trabajar en paralelo (Prompt y Dossier)
// son ProcessInterface, como el panel: flotantes, acoplables y no modales.
// Sólo "Añadir modelo" sigue siendo un Dialog, porque es una pregunta corta.
// ----------------------------------------------------------------------------

#ifndef __PiCopilotDialogs_h
#define __PiCopilotDialogs_h

#include <pcl/CheckBox.h>
#include <pcl/ComboBox.h>
#include <pcl/Dialog.h>
#include <pcl/Edit.h>
#include <pcl/Label.h>
#include <pcl/ExternalProcess.h>
#include <pcl/ProcessInterface.h>
#include <pcl/PushButton.h>
#include <pcl/SpinBox.h>
#include <pcl/Sizer.h>
#include <pcl/TextBox.h>
#include <pcl/Timer.h>
#include <pcl/TreeBox.h>
#include <pcl/WebView.h>

#include "PiCopilotAgent.h"
#include "PiCopilotJson.h"
#include "PiCopilotRender.h"

#include <memory>
#include <vector>

namespace pcl
{

// ----------------------------------------------------------------------------
// Ventana de Prompt: conversación libre con el modelo seleccionado. También
// muestra las respuestas de los botones de las fases.
// ----------------------------------------------------------------------------

class PiCopilotChatDialog : public ProcessInterface
{
public:

   PiCopilotChatDialog();
   virtual ~PiCopilotChatDialog();

   IsoString Id() const override;
   MetaProcess* Process() const override;
   String IconImageSVGFile() const override;
   InterfaceFeatures Features() const override;
   bool Launch( const MetaProcess&, const ProcessImplementation*, bool& dynamic, unsigned& /*flags*/ ) override;
   bool IsInstanceGenerator() const override { return false; }
   bool CanImportInstances() const override { return false; }

   using ProcessInterface::Launch;

   void SetContext( const String& modelName, const String& viewId );
   void SetBusy( bool busy );

   void AppendUser( const String& text );
   void AppendAssistant( const String& modelName, const String& text );
   void AppendInfo( const String& text );
   void AppendInfo( const String& text, const std::vector<std::pair<String, String>>& images );

   // Vacía la ventana; el modelo conserva el contexto de la conversación.
   void ClearView();

   // Borra la ventana y empieza una conversación nueva.
   void ClearConversation();

private:

   struct GUIData
   {
      GUIData( PiCopilotChatDialog& );

      VerticalSizer     Global_Sizer;
         Label             Context_Label;
         WebView           History_WebView;   // HTML: Markdown de las respuestas y fichas de resultados
         Label             Prompt_Label;
         TextBox           Prompt_TextBox;
         HorizontalSizer   Buttons_Sizer;
            PushButton        Send_Button;
            PushButton        RunCalls_Button;
            CheckBox          AutoRun_CheckBox;
            CheckBox          Internet_CheckBox;
            PushButton        Clear_Button;
            PushButton        New_Button;
         HorizontalSizer   Voice_Sizer;   // voz (accesibilidad): dictar el prompt y leer las respuestas
            PushButton        Dictate_Button;
            CheckBox          Voice_CheckBox;
            PushButton        ReadAloud_Button;
            PushButton        StopVoice_Button;
            Label             VoiceRate_Label;
            SpinBox           VoiceRate_SpinBox;
         Timer             Link_Timer;   // recoge los enlaces de paso pulsados en el WebView (y el fin del dictado)
   };

   GUIData* GUI = nullptr;

   String m_context;
   std::vector<PiCopilotChatEntry> m_entries;
   String m_lastCalls;
   bool   m_busy = false;

   void Refresh();
   void RefreshHistory();
   void e_LinkTimer( Timer& sender );
   void e_LinkResult( WebView& sender, const Variant& result );

   void e_Click( Button& sender, bool checked );
   void e_VoiceRate( SpinBox& sender, int value );

   // Voz (Rafael, 8 nov 2026): voces y reconocedor de Windows (System.Speech) en un PowerShell aparte, sin internet.
   std::unique_ptr<ExternalProcess> m_voice, m_dictation;
   String m_dictationOut;
   bool   m_voiceOn = false;
   int    m_voiceRate = 0;
   void Speak( const String& markdown );
   void StopVoice();
   void StartDictation();
   void FinishDictation();

   friend struct GUIData;
};

// ----------------------------------------------------------------------------
// Añadir un modelo OpenAI-compatible (local o remoto).
// ----------------------------------------------------------------------------

class PiCopilotAddModelDialog : public Dialog
{
public:

   PiCopilotAddModelDialog();

   PiCopilotModel Model() const;

private:

   VerticalSizer     Global_Sizer;
      Label             Info_Label;
      HorizontalSizer   Preset_Sizer;
         Label             Preset_Label;
         ComboBox          Preset_ComboBox;
      HorizontalSizer   Name_Sizer;
         Label             Name_Label;
         Edit              Name_Edit;
      HorizontalSizer   Endpoint_Sizer;
         Label             Endpoint_Label;
         Edit              Endpoint_Edit;
      HorizontalSizer   ModelId_Sizer;
         Label             ModelId_Label;
         Edit              ModelId_Edit;
      HorizontalSizer   Key_Sizer;
         Label             Key_Label;
         Edit              Key_Edit;
      HorizontalSizer   Buttons_Sizer;
         PushButton        OK_Button;
         PushButton        Cancel_Button;

   void e_ItemSelected( ComboBox& sender, int itemIndex );
   void e_Click( Button& sender, bool checked );
};

// ----------------------------------------------------------------------------
// Configurar IA: umbral N y ajuste de la puntuación de cada paso para elegir
// entre el modelo inferior (Sonnet / gpt-5-mini) y el superior (Opus / gpt-5).
// ----------------------------------------------------------------------------

class PiCopilotAIConfigDialog : public Dialog
{
public:

   PiCopilotAIConfigDialog( PiCopilotConfig& cfg, const PiCopilotModel& model );

private:

   struct Row
   {
      String      key;
      int         base = -1;
      Label*      name = nullptr;
      Label*      baseLabel = nullptr;
      SpinBox*    delta = nullptr;
      Label*      result = nullptr;
      HorizontalSizer* sizer = nullptr;
   };

   PiCopilotConfig& m_cfg;
   PiCopilotModel   m_model;
   std::vector<Row> m_rows;
   std::vector<std::unique_ptr<Control>> m_ownedControls;
   std::vector<std::unique_ptr<pcl::Sizer>> m_ownedSizers;

   VerticalSizer     Global_Sizer;
      Label             Info_Label;
      HorizontalSizer   N_Sizer;
         Label             N_Label;
         SpinBox           N_SpinBox;
         Label             Low_Label;
         Edit              Low_Edit;
         Label             High_Label;
         Edit              High_Edit;
      HorizontalSizer   Limits_Sizer;
         Label             TurnsStep_Label;
         SpinBox           TurnsStep_SpinBox;
         Label             TurnsFull_Label;
         SpinBox           TurnsFull_SpinBox;
         Label             Retries_Label;
         SpinBox           Retries_SpinBox;
      HorizontalSizer   Columns_Sizer;
         VerticalSizer     Linear_Sizer;
            Label             Linear_Title;
         VerticalSizer     NonLinear_Sizer;
            Label             NonLinear_Title;
      HorizontalSizer   Buttons_Sizer;
         PushButton        Default_Button;
         PushButton        Save_Button;
         PushButton        Cancel_Button;

   void AddRow( VerticalSizer& sizer, const String& key, const String& label, int labelWidth );
   void UpdateResults();

   void e_ValueUpdated( SpinBox& sender, int value );
   void e_Click( Button& sender, bool checked );
};

// ----------------------------------------------------------------------------
// Dossier de una comparativa: candidatos, métricas y recomendación del
// modelo. El usuario puede ver cada imagen y quedarse con la que quiera.
// ----------------------------------------------------------------------------

class PiCopilotDossierDialog : public ProcessInterface
{
public:

   PiCopilotDossierDialog();
   virtual ~PiCopilotDossierDialog();

   IsoString Id() const override;
   MetaProcess* Process() const override;
   String IconImageSVGFile() const override;
   InterfaceFeatures Features() const override;
   bool Launch( const MetaProcess&, const ProcessImplementation*, bool& dynamic, unsigned& /*flags*/ ) override;
   bool IsInstanceGenerator() const override { return false; }
   bool CanImportInstances() const override { return false; }

   using ProcessInterface::Launch;

   bool Load( const String& jsonPath, String& whyNot );

private:

   struct GUIData
   {
      GUIData( PiCopilotDossierDialog& );

      VerticalSizer     Global_Sizer;
         Label             Title_Label;
         Label             Analysis_Label;
         TreeBox           Candidates_TreeBox;
         Label             Recommendation_Label;
         HorizontalSizer   Buttons_Sizer;
            PushButton        View_Button;
            PushButton        Use_Button;
            PushButton        Report_Button;
   };

   GUIData* GUI = nullptr;

   String    m_path;
   JsonValue m_data;
   String    m_recommended;

   void Populate();
   String SelectedView() const;
   const JsonValue* Candidate( const String& viewId ) const;
   void ShowCandidate( const String& viewId );

   void e_Click( Button& sender, bool checked );
   void e_NodeDoubleClicked( TreeBox& sender, TreeBox::Node& node, int col );

   friend struct GUIData;
};

// ----------------------------------------------------------------------------

PCL_BEGIN_LOCAL
extern PiCopilotChatDialog*    ThePiCopilotChat;
extern PiCopilotDossierDialog* ThePiCopilotDossier;
PCL_END_LOCAL

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiCopilotDialogs_h

// ----------------------------------------------------------------------------
// EOF PiCopilotDialogs.h
