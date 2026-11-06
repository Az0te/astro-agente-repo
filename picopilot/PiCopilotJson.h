// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotJson.h - Lector/escritor JSON mínimo (sin dependencias externas).
// ----------------------------------------------------------------------------

#ifndef __PiCopilotJson_h
#define __PiCopilotJson_h

#include <pcl/String.h>

#include <utility>
#include <vector>

namespace pcl
{

// ----------------------------------------------------------------------------

class JsonValue
{
public:

   enum Type { Null, Bool, Number, Str, Array, Object };

   Type                                       type = Null;
   bool                                       b = false;
   double                                     n = 0;
   String                                     s;
   std::vector<JsonValue>                     a;
   std::vector<std::pair<String, JsonValue>>  o;

   bool IsNull() const { return type == Null; }

   // Miembro de un objeto; devuelve un valor nulo si no existe.
   const JsonValue& operator []( const char* key ) const;

   // Elemento de un array; devuelve un valor nulo si está fuera de rango.
   const JsonValue& operator []( size_t i ) const;

   size_t Size() const { return (type == Array) ? a.size() : (type == Object) ? o.size() : 0; }

   // Representación como texto: cadenas tal cual, números sin ceros
   // superfluos, objetos y arrays serializados en una línea.
   String ToText() const;

   // Serialización JSON compacta.
   String ToJson() const;

   // Analiza texto UTF-8. Si falla, devuelve false y deja el error en whyNot.
   static bool Parse( const IsoString& utf8, JsonValue& out, String& whyNot );

   // Escapa una cadena como literal JSON (con comillas).
   static String Quote( const String& s );
};

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiCopilotJson_h

// ----------------------------------------------------------------------------
// EOF PiCopilotJson.h
