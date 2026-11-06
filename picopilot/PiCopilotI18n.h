// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotI18n.h - Idioma de la interfaz (español / inglés).
//
// Los textos del código están en español; Tr() devuelve la traducción inglesa
// cuando la interfaz está en inglés y el texto está en la tabla (si no, el
// original). Lo que se manda a los modelos sigue en español: la guía lo está y
// los modelos contestan en el idioma del usuario.
// ----------------------------------------------------------------------------

#ifndef __PiCopilotI18n_h
#define __PiCopilotI18n_h

#include <pcl/String.h>

namespace pcl
{

bool   PiCopilotEnglish();
void   SetPiCopilotEnglish( bool );
String Tr( const String& es );

} // pcl

#endif   // __PiCopilotI18n_h
