// ----------------------------------------------------------------------------
// PiAstroPilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiAstroPilotRender.h - Presentación del chat en HTML: Markdown de las respuestas
// (títulos, negrita, cursiva, código, tablas, listas) y fichas de resultados
// de los scripts (no_cumple en rojo, medido en verde, revisar a ojo en ámbar,
// tablas con los datos). Se muestra en un WebView.
// ----------------------------------------------------------------------------

#ifndef __PiAstroPilotRender_h
#define __PiAstroPilotRender_h

#include <pcl/String.h>

#include <utility>
#include <vector>

namespace pcl
{

struct PiAstroPilotChatEntry
{
   enum Kind { User, Assistant, Info };
   Kind   kind = Info;
   String title;   // nombre del modelo, "Tú"...
   String time;
   String text;
   // Vistas previas (rótulo, ruta del JPG) que se muestran en rejilla debajo del texto (p. ej. candidatos de gradiente).
   std::vector<std::pair<String, String>> images;
};

namespace PiAstroPilotRender
{
   String Escape( const String& );
   String Markdown( const String& md );
   String Info( const String& text );
   String Page( const std::vector<PiAstroPilotChatEntry>& entries );
}

} // pcl

#endif   // __PiAstroPilotRender_h

// ----------------------------------------------------------------------------
// EOF PiAstroPilotRender.h
