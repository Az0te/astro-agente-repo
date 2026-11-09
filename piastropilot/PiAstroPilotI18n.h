// ----------------------------------------------------------------------------
// PiAstroPilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiAstroPilotI18n.h - Idioma de la interfaz (español / inglés).
//
// Los textos del código están en español; Tr() devuelve la traducción inglesa
// cuando la interfaz está en inglés y el texto está en la tabla (si no, el
// original). Lo que se manda a los modelos sigue en español: la guía lo está y
// los modelos contestan en el idioma del usuario.
// ----------------------------------------------------------------------------

#ifndef __PiAstroPilotI18n_h
#define __PiAstroPilotI18n_h

#include <pcl/String.h>

namespace pcl
{

bool   PiAstroPilotEnglish();
void   SetPiAstroPilotEnglish( bool );
String Tr( const String& es );

} // pcl

#endif   // __PiAstroPilotI18n_h
