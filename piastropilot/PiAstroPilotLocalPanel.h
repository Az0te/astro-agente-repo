// ----------------------------------------------------------------------------
// PiAstroPilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiAstroPilotLocalPanel.h - Panel de IA local bajo el chat (build 117).
//
// Como el del Lite y los chats de Siril y SASpro (23 nov 2026): sólo con un
// modelo local (Ollama o RDNA-FAST / llama-server). Modelo cargado
// (cuantización, parámetros, tamaño, contexto), % del modelo en la GPU, memoria
// y carga de la gráfica, contexto usado, estado, tok/s y avisos. Lo lee un
// PowerShell aparte (HTTP a /api/ps, /props y /slots, y Get-Counter) que se
// lanza sin esperarlo cada ~5 s; si falla, el panel muestra «—» y el chat sigue.
// ----------------------------------------------------------------------------

#ifndef __PiAstroPilotLocalPanel_h
#define __PiAstroPilotLocalPanel_h

#include <pcl/Control.h>
#include <pcl/ExternalProcess.h>
#include <pcl/GroupBox.h>
#include <pcl/Label.h>
#include <pcl/PushButton.h>
#include <pcl/Sizer.h>

#include "PiAstroPilotAgent.h"
#include "PiAstroPilotJson.h"

#include <memory>

namespace pcl
{

// ----------------------------------------------------------------------------

class PiAstroPilotLocalPanel : public GroupBox
{
public:

   PiAstroPilotLocalPanel();
   virtual ~PiAstroPilotLocalPanel();

   // Cada tic de la interfaz (1 s): modelo elegido, si se espera al modelo, carpeta temporal y si la interfaz se ve.
   // Con un modelo en la nube o con la interfaz oculta el panel se esconde y no lee nada.
   void Tick( const PiAstroPilotModel& model, bool busy, const String& tempDir, bool visible );

   // Tokens de la última respuesta local (usage del servidor) y tok/s si el servidor los da (llama-server: timings).
   void NoteUsage( int promptTokens, int completionTokens, double tokensPerSecond, int contextTokens );

   // Para al cerrar: mata el PowerShell si sigue.
   void Stop();

private:

   VerticalSizer     Global_Sizer;
      HorizontalSizer   Top_Sizer;
         Label             Model_Label;
         Label             Gpu_Label;
      HorizontalSizer   Mem_Sizer;
         Label             MemTitle_Label;
         Control           Mem_Bar;
         Label             Mem_Label;
      HorizontalSizer   Ctx_Sizer;
         Label             CtxTitle_Label;
         Control           Ctx_Bar;
         Label             Ctx_Label;
      HorizontalSizer   Load_Sizer;
         Label             Load_Label;
         PushButton        Unload_Button;

   std::unique_ptr<ExternalProcess> m_proc, m_oldProc, m_unload;
   ByteArray  m_out;
   bool       m_running = false;
   double     m_startedAt = 0, m_nextAt = 0;
   int        m_failures = 0;
   bool       m_scriptWritten = false;

   JsonValue  m_data;            // última lectura: { ps, props, slots (texto JSON), gpu { gpu, motor, vram, total } }
   double     m_dataAt = 0;
   String     m_dataKey;         // proveedor y URL de la lectura (al cambiar de modelo no se pinta la anterior)

   PiAstroPilotModel m_model;
   bool       m_busy = false;
   bool       m_rdna = false;
   String     m_ollamaBase, m_rdnaBase;
   StringList m_loaded;          // modelos cargados en Ollama (botón «Descargar»)

   int        m_lastIn = 0, m_lastOut = 0, m_lastCtx = 0;
   double     m_lastTps = 0;
   String     m_lastKey;

   double     m_memFrac = 0, m_ctxFrac = 0;
   uint32     m_memColor = 0xff4caf50, m_ctxColor = 0xff4caf50;

   void StartRead( const String& tempDir );
   void Refresh();

   void e_Paint( Control& sender, const pcl::Rect& updateRect );
   void e_Stdout( ExternalProcess& sender );
   void e_Finished( ExternalProcess& sender, int exitCode, bool exitOk );
   void e_Error( ExternalProcess& sender, ExternalProcess::error_code error );
   void e_Click( Button& sender, bool checked );
};

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiAstroPilotLocalPanel_h

// ----------------------------------------------------------------------------
// EOF PiAstroPilotLocalPanel.h
