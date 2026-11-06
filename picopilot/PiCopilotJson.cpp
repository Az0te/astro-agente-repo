// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotJson.cpp - Lector/escritor JSON mínimo.
// ----------------------------------------------------------------------------

#include "PiCopilotJson.h"

#include <cstdlib>
#include <cstring>

namespace pcl
{

// ----------------------------------------------------------------------------

static const JsonValue s_null;

const JsonValue& JsonValue::operator []( const char* key ) const
{
   if ( type == Object )
   {
      String k( key );
      for ( const auto& m : o )
         if ( m.first == k )
            return m.second;
   }
   return s_null;
}

const JsonValue& JsonValue::operator []( size_t i ) const
{
   if ( type == Array && i < a.size() )
      return a[i];
   return s_null;
}

// ----------------------------------------------------------------------------

static String NumberToText( double x )
{
   if ( x == double( int64( x ) ) && x > -1e15 && x < 1e15 )
      return String( int64( x ) );
   String t = String().Format( "%.6g", x );
   return t;
}

String JsonValue::ToText() const
{
   switch ( type )
   {
   case Null:   return String();
   case Bool:   return b ? "true" : "false";
   case Number: return NumberToText( n );
   case Str:    return s;
   default:     return ToJson();
   }
}

String JsonValue::Quote( const String& s )
{
   String r = '\"';
   for ( String::const_iterator i = s.Begin(); i != s.End(); ++i )
   {
      char16_type c = *i;
      switch ( c )
      {
      case '\"': r << "\\\""; break;
      case '\\': r << "\\\\"; break;
      case '\n': r << "\\n";  break;
      case '\r': r << "\\r";  break;
      case '\t': r << "\\t";  break;
      case '\b': r << "\\b";  break;
      case '\f': r << "\\f";  break;
      default:
         if ( c < 0x20 )
            r << String().Format( "\\u%04x", unsigned( c ) );
         else
            r << c;
         break;
      }
   }
   r << '\"';
   return r;
}

String JsonValue::ToJson() const
{
   switch ( type )
   {
   case Null:   return "null";
   case Bool:   return b ? "true" : "false";
   case Number: return NumberToText( n );
   case Str:    return Quote( s );
   case Array:
      {
         String r = '[';
         for ( size_t i = 0; i < a.size(); ++i )
         {
            if ( i > 0 )
               r << ',';
            r << a[i].ToJson();
         }
         return r << ']';
      }
   case Object:
      {
         String r = '{';
         for ( size_t i = 0; i < o.size(); ++i )
         {
            if ( i > 0 )
               r << ',';
            r << Quote( o[i].first ) << ':' << o[i].second.ToJson();
         }
         return r << '}';
      }
   }
   return String();
}

// ----------------------------------------------------------------------------

namespace
{

class JsonParser
{
public:

   JsonParser( const IsoString& text ) : begin( text.c_str() ), p( begin ), end( begin + text.Length() )
   {
   }

   bool Run( JsonValue& out, String& whyNot )
   {
      SkipWS();
      if ( !Value( out, 0 ) )
      {
         whyNot = error.IsEmpty() ? String( u"JSON no válido" ) : error;
         return false;
      }
      return true;
   }

private:

   const char* begin;
   const char* p;
   const char* end;
   String      error;

   void SkipWS()
   {
      while ( p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') )
         ++p;
   }

   bool Fail( const char* msg )
   {
      error = String::UTF8ToUTF16( msg ) + String().Format( " (byte %d)", int( p - begin ) );
      return false;
   }

   static int Hex( char c )
   {
      if ( c >= '0' && c <= '9' ) return c - '0';
      if ( c >= 'a' && c <= 'f' ) return c - 'a' + 10;
      if ( c >= 'A' && c <= 'F' ) return c - 'A' + 10;
      return -1;
   }

   bool StringLiteral( String& out )
   {
      // *p == '"'
      ++p;
      IsoString utf8;
      String result;
      for ( ;; )
      {
         if ( p >= end )
            return Fail( "Cadena sin cerrar" );
         char c = *p++;
         if ( c == '\"' )
            break;
         if ( c != '\\' )
         {
            utf8 << c;
            continue;
         }
         if ( p >= end )
            return Fail( "Escape incompleto" );
         char e = *p++;
         switch ( e )
         {
         case '\"': utf8 << '\"'; break;
         case '\\': utf8 << '\\'; break;
         case '/':  utf8 << '/';  break;
         case 'b':  utf8 << '\b'; break;
         case 'f':  utf8 << '\f'; break;
         case 'n':  utf8 << '\n'; break;
         case 'r':  utf8 << '\r'; break;
         case 't':  utf8 << '\t'; break;
         case 'u':
            {
               if ( end - p < 4 )
                  return Fail( "Escape \\u incompleto" );
               unsigned u = 0;
               for ( int k = 0; k < 4; ++k )
               {
                  int h = Hex( p[k] );
                  if ( h < 0 )
                     return Fail( "Escape \\u no válido" );
                  u = (u << 4) | unsigned( h );
               }
               p += 4;
               // Volcamos lo acumulado y añadimos la unidad UTF-16 tal cual,
               // así los pares sustitutos quedan bien formados.
               result << utf8.UTF8ToUTF16();
               utf8.Clear();
               result << char16_type( u );
            }
            break;
         default:
            return Fail( "Escape desconocido" );
         }
      }
      result << utf8.UTF8ToUTF16();
      out = result;
      return true;
   }

   bool Value( JsonValue& v, int depth )
   {
      if ( depth > 200 )
         return Fail( "Anidamiento excesivo" );
      SkipWS();
      if ( p >= end )
         return Fail( "Fin inesperado" );

      char c = *p;
      if ( c == '{' )
      {
         ++p;
         v.type = JsonValue::Object;
         SkipWS();
         if ( p < end && *p == '}' )
         {
            ++p;
            return true;
         }
         for ( ;; )
         {
            SkipWS();
            if ( p >= end || *p != '\"' )
               return Fail( "Se esperaba una clave" );
            String key;
            if ( !StringLiteral( key ) )
               return false;
            SkipWS();
            if ( p >= end || *p != ':' )
               return Fail( "Se esperaba ':'" );
            ++p;
            JsonValue item;
            if ( !Value( item, depth+1 ) )
               return false;
            v.o.emplace_back( key, std::move( item ) );
            SkipWS();
            if ( p < end && *p == ',' )
            {
               ++p;
               continue;
            }
            if ( p < end && *p == '}' )
            {
               ++p;
               return true;
            }
            return Fail( "Se esperaba ',' o '}'" );
         }
      }
      if ( c == '[' )
      {
         ++p;
         v.type = JsonValue::Array;
         SkipWS();
         if ( p < end && *p == ']' )
         {
            ++p;
            return true;
         }
         for ( ;; )
         {
            JsonValue item;
            if ( !Value( item, depth+1 ) )
               return false;
            v.a.push_back( std::move( item ) );
            SkipWS();
            if ( p < end && *p == ',' )
            {
               ++p;
               continue;
            }
            if ( p < end && *p == ']' )
            {
               ++p;
               return true;
            }
            return Fail( "Se esperaba ',' o ']'" );
         }
      }
      if ( c == '\"' )
      {
         v.type = JsonValue::Str;
         return StringLiteral( v.s );
      }
      if ( end - p >= 4 && ::strncmp( p, "true", 4 ) == 0 )
      {
         p += 4;
         v.type = JsonValue::Bool;
         v.b = true;
         return true;
      }
      if ( end - p >= 5 && ::strncmp( p, "false", 5 ) == 0 )
      {
         p += 5;
         v.type = JsonValue::Bool;
         v.b = false;
         return true;
      }
      if ( end - p >= 4 && ::strncmp( p, "null", 4 ) == 0 )
      {
         p += 4;
         v.type = JsonValue::Null;
         return true;
      }
      if ( c == '-' || (c >= '0' && c <= '9') )
      {
         const char* q = p;
         while ( q < end && (*q == '-' || *q == '+' || *q == '.' || *q == 'e' || *q == 'E' || (*q >= '0' && *q <= '9')) )
            ++q;
         IsoString num( p, 0, size_type( q - p ) );
         v.type = JsonValue::Number;
         v.n = ::strtod( num.c_str(), nullptr );
         p = q;
         return true;
      }
      return Fail( "Valor no reconocido" );
   }
};

} // namespace

bool JsonValue::Parse( const IsoString& utf8, JsonValue& out, String& whyNot )
{
   out = JsonValue();
   // Saltar BOM UTF-8 si lo hay.
   IsoString text = utf8;
   if ( text.Length() >= 3 && uint8( text[0] ) == 0xEF && uint8( text[1] ) == 0xBB && uint8( text[2] ) == 0xBF )
      text.DeleteLeft( 3 );
   return JsonParser( text ).Run( out, whyNot );
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotJson.cpp
