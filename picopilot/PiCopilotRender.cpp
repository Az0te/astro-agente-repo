// ----------------------------------------------------------------------------
// PiCopilot - Asistente de IA para PixInsight
// ----------------------------------------------------------------------------
// PiCopilotRender.cpp - Presentación del chat en HTML.
// ----------------------------------------------------------------------------

#include "PiCopilotRender.h"
#include "PiCopilotI18n.h"
#include "PiCopilotJson.h"

#include <pcl/ByteArray.h>
#include <pcl/File.h>
#include <pcl/StringList.h>

namespace pcl
{

// ----------------------------------------------------------------------------

String PiCopilotRender::Escape( const String& s )
{
   String r;
   r.Reserve( s.Length() + 16 );
   for ( size_type i = 0; i < s.Length(); ++i )
   {
      char16_t c = s[i];
      switch ( c )
      {
      case '&': r << "&amp;"; break;
      case '<': r << "&lt;"; break;
      case '>': r << "&gt;"; break;
      case '"': r << "&quot;"; break;
      default:  r << c; break;
      }
   }
   return r;
}

// Formato en línea sobre texto ya escapado: `código`, **negrita**, *cursiva*, [enlace](url).
static String InlineBase( const String& raw )
{
   String s = PiCopilotRender::Escape( raw ), out;
   size_type i = 0, n = s.Length();
   bool bold = false, ital = false;
   while ( i < n )
   {
      char16_t c = s[i];
      if ( c == '`' )
      {
         size_type j = s.Find( '`', i + 1 );
         if ( j != String::notFound )
         {
            out << "<code>" << s.Substring( i + 1, j - i - 1 ) << "</code>";
            i = j + 1;
            continue;
         }
      }
      if ( c == '*' && i + 1 < n && s[i+1] == '*' )
      {
         out << (bold ? "</b>" : "<b>");
         bold = !bold;
         i += 2;
         continue;
      }
      if ( c == '*' && (ital || (i + 1 < n && s[i+1] != ' ')) )
      {
         out << (ital ? "</i>" : "<i>");
         ital = !ital;
         ++i;
         continue;
      }
      if ( c == '[' )
      {
         size_type j = s.Find( "](", i );
         size_type k = (j != String::notFound) ? s.Find( ')', j ) : String::notFound;
         if ( j != String::notFound && k != String::notFound && s.Find( '\n', i ) > k )
         {
            out << "<a href=\"" << s.Substring( j + 2, k - j - 2 ) << "\">" << s.Substring( i + 1, j - i - 1 ) << "</a>";
            i = k + 1;
            continue;
         }
      }
      out << c;
      ++i;
   }
   if ( ital ) out << "</i>";
   if ( bold ) out << "</b>";
   return out;
}

static bool IsTableRow( const String& l )
{
   String t = l.Trimmed();
   return t.StartsWith( '|' ) && t.EndsWith( '|' ) && t.Length() > 2;
}

static bool IsTableSep( const String& l )
{
   String t = l.Trimmed();
   if ( !IsTableRow( t ) ) return false;
   for ( size_type i = 0; i < t.Length(); ++i )
      if ( t[i] != '|' && t[i] != '-' && t[i] != ':' && t[i] != ' ' )
         return false;
   return true;
}

static StringList Cells( const String& l )
{
   String t = l.Trimmed();
   t = t.Substring( 1, t.Length() - 2 );
   StringList c;
   t.Break( c, '|', true );
   return c;
}

// Enlaces de paso (Rafael, 7 nov 2026): "Siguiente paso: ..." / "Paso siguiente: ..." / "Next step: ..." y las líneas que
// empiezan por "Paso N ..." se pintan como enlace subrayado. Al pulsarlo, la página deja el texto en window.picoClick
// (con el número de mensaje, data-m) y el diálogo del Prompt lo recoge con su temporizador: ejecuta el script pendiente
// de ese mensaje o le pide el paso al modelo.
static String StepAnchor( const String& target, const String& after )
{
   String plain = target;
   plain.ReplaceString( "**", "" );
   plain.ReplaceString( "`", "" );
   plain = plain.Trimmed();
   if ( plain.IsEmpty() )
      return String();
   return String( "<a class=\"step\" href=\"#\" data-m=\"@M@\" data-step=\"" ) + PiCopilotRender::Escape( plain ) +
          "\" onclick=\"return picoStep(this)\">" + InlineBase( target ) + "</a>" + InlineBase( after );
}

static String Inline( const String& raw )
{
   String low = raw.Lowercase();
   static const char* keys[] = { "siguiente paso:", "paso siguiente:", "siguiente paso (", "next step:", nullptr };
   for ( int k = 0; keys[k] != nullptr; ++k )
   {
      size_type p = low.Find( keys[k] );
      if ( p == String::notFound )
         continue;
      size_type e = p + IsoString( keys[k] ).Length();
      if ( keys[k][IsoString( keys[k] ).Length() - 1] == '(' )   // "Siguiente paso (Paso 11): ..."
         e = p + IsoString( keys[k] ).Length() - 1;
      String before = raw.Left( e ), rest = raw.Substring( e );
      // El rótulo en negrita ("**Siguiente paso:** ...") se queda fuera del enlace.
      if ( rest.StartsWith( "**" ) ) { before << "**"; rest = rest.Substring( 2 ); }
      size_type dot = rest.Find( ". " );
      String target = (dot != String::notFound) ? rest.Left( dot + 1 ) : rest, after = (dot != String::notFound) ? rest.Substring( dot + 1 ) : String();
      String a = StepAnchor( target, after );
      if ( !a.IsEmpty() )
         return InlineBase( before ) + a;
   }
   String t = raw.Trimmed();
   size_type s = 0;
   while ( s < t.Length() && t[s] == '*' ) ++s;
   if ( t.Substring( s ).StartsWith( "Paso " ) && t.Length() > s + 5 && t[s+5] >= '0' && t[s+5] <= '9' )
   {
      size_type dot = t.Find( ". " );
      String target = (dot != String::notFound) ? t.Left( dot + 1 ) : t, after = (dot != String::notFound) ? t.Substring( dot + 1 ) : String();
      String a = StepAnchor( target, after );
      if ( !a.IsEmpty() )
         return a;
   }
   return InlineBase( raw );
}

String PiCopilotRender::Markdown( const String& md )
{
   StringList lines;
   String src = md;
   src.ReplaceString( "\r\n", "\n" );
   src.Break( lines, '\n' );
   String out, para;
   bool inCode = false, inUl = false, inOl = false;
   auto flushPara = [&]()
   {
      if ( !para.IsEmpty() ) { out << "<p>" << para << "</p>"; para.Clear(); }
   };
   auto closeLists = [&]()
   {
      if ( inUl ) { out << "</ul>"; inUl = false; }
      if ( inOl ) { out << "</ol>"; inOl = false; }
   };
   for ( size_type i = 0; i < lines.Length(); ++i )
   {
      const String& line = lines[i];
      String t = line.Trimmed();
      if ( t.StartsWith( "```" ) )
      {
         flushPara(); closeLists();
         if ( !inCode )
         {
            String lang = t.Substring( 3 ).Trimmed();
            out << "<pre class=\"code\"><div class=\"lang\">" << Escape( lang.IsEmpty() ? String( u"código" ) : lang ) << "</div><code>";
            inCode = true;
         }
         else
         {
            out << "</code></pre>";
            inCode = false;
         }
         continue;
      }
      if ( inCode )
      {
         out << Escape( line ) << "\n";
         continue;
      }
      if ( t.IsEmpty() )
      {
         flushPara(); closeLists();
         continue;
      }
      // Tabla: fila de cabecera seguida de |---|.
      if ( IsTableRow( t ) && i + 1 < lines.Length() && IsTableSep( lines[i+1] ) )
      {
         flushPara(); closeLists();
         out << "<table><tr>";
         for ( const String& c : Cells( t ) ) out << "<th>" << Inline( c ) << "</th>";
         out << "</tr>";
         i += 2;
         for ( ; i < lines.Length() && IsTableRow( lines[i] ); ++i )
         {
            out << "<tr>";
            for ( const String& c : Cells( lines[i] ) ) out << "<td>" << Inline( c ) << "</td>";
            out << "</tr>";
         }
         --i;
         out << "</table>";
         continue;
      }
      if ( t.StartsWith( '#' ) )
      {
         flushPara(); closeLists();
         int level = 0;
         while ( level < int( t.Length() ) && t[level] == '#' ) ++level;
         level = Range( level, 1, 4 );
         String hl = String().Format( "%d", level + 1 ); out << "<h" << hl << ">" << Inline( t.Substring( level ).Trimmed() ) << "</h" << hl << ">";
         continue;
      }
      if ( t == "---" || t == "***" )
      {
         flushPara(); closeLists();
         out << "<hr>";
         continue;
      }
      if ( t.StartsWith( "- " ) || t.StartsWith( "* " ) || t.StartsWith( u"• " ) )
      {
         flushPara();
         if ( inOl ) { out << "</ol>"; inOl = false; }
         if ( !inUl ) { out << "<ul>"; inUl = true; }
         out << "<li>" << Inline( t.Substring( 2 ).Trimmed() ) << "</li>";
         continue;
      }
      {
         size_type d = 0;
         while ( d < t.Length() && t[d] >= '0' && t[d] <= '9' ) ++d;
         if ( d > 0 && d + 1 < t.Length() && (t[d] == '.' || t[d] == ')') && t[d+1] == ' ' )
         {
            flushPara();
            if ( inUl ) { out << "</ul>"; inUl = false; }
            if ( !inOl ) { out << "<ol>"; inOl = true; }
            out << "<li>" << Inline( t.Substring( d + 2 ).Trimmed() ) << "</li>";
            continue;
         }
      }
      if ( t.StartsWith( '>' ) )
      {
         flushPara(); closeLists();
         out << "<blockquote>" << Inline( t.Substring( 1 ).Trimmed() ) << "</blockquote>";
         continue;
      }
      // Sub-elementos de lista sangrados: se añaden a la lista abierta.
      if ( (inUl || inOl) && (line.StartsWith( "  " ) || line.StartsWith( '\t' )) )
      {
         out << "<div class=\"sub\">" << Inline( t ) << "</div>";
         continue;
      }
      closeLists();
      if ( !para.IsEmpty() ) para << "<br>";
      para << Inline( t );
   }
   if ( inCode ) out << "</code></pre>";
   flushPara(); closeLists();
   return out;
}

// ----------------------------------------------------------------------------
// Resultados de los scripts: fichas con los datos.

static String Humanize( const String& key )
{
   String k = key;
   k.ReplaceString( "_", " " );
   if ( !k.IsEmpty() ) k = k.Left( 1 ).Uppercase() + k.Substring( 1 );
   return k;
}

static String ScalarHtml( const JsonValue& v )
{
   switch ( v.type )
   {
   case JsonValue::Bool:   return v.b ? String( "<span class=\"ok\">s&iacute;</span>" ) : String( "<span class=\"bad\">no</span>" );
   case JsonValue::Number: return "<span class=\"num\">" + v.ToText() + "</span>";
   case JsonValue::Null:   return "<span class=\"muted\">&mdash;</span>";
   case JsonValue::Str:    return PiCopilotRender::Escape( v.s );
   default:                return PiCopilotRender::Escape( v.ToText() );
   }
}

static bool IsScalar( const JsonValue& v )
{
   return v.type != JsonValue::Array && v.type != JsonValue::Object;
}

static String ListHtml( const JsonValue& arr, const char* cls, const char* icon )
{
   String h;
   if ( arr.type != JsonValue::Array || arr.a.empty() )
      return h;
   h << "<ul class=\"" << cls << "\">";
   for ( const JsonValue& e : arr.a )
      h << "<li><span class=\"ico\">" << icon << "</span>" << (IsScalar( e ) ? PiCopilotRender::Escape( e.ToText() ) : PiCopilotRender::Escape( e.ToJson() )) << "</li>";
   h << "</ul>";
   return h;
}

// Array de objetos → tabla (columnas: unión de claves escalares, máx. 8; filas máx. 40).
static String ObjectArrayTable( const JsonValue& arr )
{
   // Columnas: claves escalares y, de los objetos anidados (p. ej. "metricas"), sus claves escalares ("metricas.x").
   StringList cols;
   for ( const JsonValue& e : arr.a )
      if ( e.type == JsonValue::Object )
         for ( const auto& kv : e.o )
         {
            if ( kv.first == "previa" || kv.first == "previa_modelo" || kv.first == "jpg" )   // miniaturas: van en la rejilla
               continue;
            if ( kv.second.type == JsonValue::Object )
            {
               for ( const auto& kv2 : kv.second.o )
                  if ( IsScalar( kv2.second ) && !cols.Contains( kv.first + "." + kv2.first ) && cols.Length() < 10 )
                     cols << kv.first + "." + kv2.first;
            }
            else if ( (IsScalar( kv.second ) || kv.second.type == JsonValue::Array) && !cols.Contains( kv.first ) && cols.Length() < 10 )
               cols << kv.first;
         }
   String h = "<table><tr>";
   for ( const String& c : cols )
   {
      size_type dot = c.Find( '.' );
      h << "<th>" << PiCopilotRender::Escape( Humanize( dot == String::notFound ? c : c.Substring( dot + 1 ) ) ) << "</th>";
   }
   h << "</tr>";
   size_t n = 0;
   for ( const JsonValue& e : arr.a )
   {
      if ( ++n > 40 ) { h << "<tr><td colspan=\"" << String().Format( "%d", int( cols.Length() ) ) << "\" class=\"muted\">&hellip; " << String().Format( "%d", int( arr.a.size() - 40 ) ) << " filas m&aacute;s</td></tr>"; break; }
      h << "<tr>";
      for ( const String& c : cols )
      {
         size_type dot = c.Find( '.' );
         const JsonValue& v = (dot == String::notFound) ? e[IsoString( c ).c_str()]
                                                        : e[IsoString( c.Left( dot ) ).c_str()][IsoString( c.Substring( dot + 1 ) ).c_str()];
         h << "<td>" << (IsScalar( v ) ? ScalarHtml( v ) : PiCopilotRender::Escape( v.ToText() )) << "</td>";
      }
      h << "</tr>";
   }
   return h + "</table>";
}

static void DataRows( const JsonValue& obj, const String& prefix, String& rows, String& extra, int depth )
{
   static const char* skip[] = { "no_cumple", "control", nullptr };
   for ( const auto& kv : obj.o )
   {
      bool sk = false;
      if ( depth == 0 ) for ( int i = 0; skip[i]; ++i ) if ( kv.first == skip[i] ) sk = true;
      if ( kv.first == "previa" || kv.first == "previa_modelo" || kv.first == "jpg" ) sk = true;   // miniaturas: van en la rejilla
      if ( sk ) continue;
      String name = prefix.IsEmpty() ? Humanize( kv.first ) : prefix + u" · " + kv.first;
      const JsonValue& v = kv.second;
      if ( IsScalar( v ) )
         rows << "<tr><th>" << PiCopilotRender::Escape( name ) << "</th><td>" << ScalarHtml( v ) << "</td></tr>";
      else if ( v.type == JsonValue::Object && depth < 2 )
         DataRows( v, name, rows, extra, depth + 1 );
      else if ( v.type == JsonValue::Array && !v.a.empty() && v.a[0].type == JsonValue::Object )
         extra << "<h4>" << PiCopilotRender::Escape( name ) << "</h4>" << ObjectArrayTable( v );
      else if ( v.type == JsonValue::Array )
      {
         String list;
         for ( size_t i = 0; i < v.a.size() && i < 30; ++i )
            list << (i ? ", " : "") << (IsScalar( v.a[i] ) ? ScalarHtml( v.a[i] ) : PiCopilotRender::Escape( v.a[i].ToText() ));
         if ( v.a.size() > 30 ) list << " &hellip;";
         rows << "<tr><th>" << PiCopilotRender::Escape( name ) << "</th><td>" << (v.a.empty() ? String( "<span class=\"muted\">&mdash;</span>" ) : list) << "</td></tr>";
      }
      else
         rows << "<tr><th>" << PiCopilotRender::Escape( name ) << "</th><td>" << PiCopilotRender::Escape( v.ToText() ) << "</td></tr>";
   }
}

static String ResultCard( const JsonValue& r, const String& json )
{
   String h = "<div class=\"card\">";
   const JsonValue& nc = r["no_cumple"];
   const JsonValue& ctl = r["control"];
   bool hasNc = nc.type == JsonValue::Array && !nc.a.empty();
   h << "<div class=\"cardtitle\">" << (hasNc ? "<span class=\"badge bad\">" + String( Tr( u"No cumple" ) ) + "</span>"
                                             : "<span class=\"badge ok\">" + String( Tr( u"Cumple" ) ) + "</span>")
     << " " << Tr( u"Resultado de las llamadas" ) << "</div>";
   h << ListHtml( nc, "nc", "&#10007;" );
   h << ListHtml( ctl["medido"], "med", "&#10003;" );
   h << ListHtml( ctl["revisar_a_ojo"], "ojo", "&#128065;" );
   String rows, extra;
   if ( r.type == JsonValue::Object )
      DataRows( r, String(), rows, extra, 0 );
   if ( !rows.IsEmpty() )
      h << "<table class=\"kv\">" << rows << "</table>";
   h << extra;
   h << "<details><summary>JSON</summary><pre class=\"code\"><code>" << PiCopilotRender::Escape( json ) << "</code></pre></details>";
   return h + "</div>";
}

String PiCopilotRender::Info( const String& text )
{
   // "…Resultado:\n{json}" → ficha; el resto, texto con estilo según el tipo de aviso.
   size_type p = text.Find( '{' );
   if ( p != String::notFound )
   {
      String head = text.Left( p ), json = text.Substring( p ).Trimmed();
      size_type q = json.FindLast( '}' );
      if ( q != String::notFound ) json = json.Left( q + 1 );
      JsonValue v; String why;
      if ( JsonValue::Parse( json.ToUTF8(), v, why ) && v.type == JsonValue::Object )
         return "<div class=\"info\">" + Escape( head.Trimmed() ) + "</div>" + ResultCard( v, json );
   }
   String cls = "info";
   if ( text.Contains( u"falló" ) || text.Contains( u"failed" ) || text.Contains( u"Error" ) || text.Contains( u"error" ) )
      cls = "info err";
   else if ( text.StartsWith( u">>>" ) )
      cls = "info plan";
   else if ( text.StartsWith( u"---" ) )
      cls = "info step";
   String e = Escape( text );
   e.ReplaceString( "\n", "<br>" );
   return "<div class=\"" + cls + "\">" + e + "</div>";
}

static const char* s_css =
   "body{margin:0;padding:10px 12px;background:#232629;color:#d8dadc;font:13px/1.45 'Segoe UI',Tahoma,sans-serif}"
   ".msg{margin:10px 0}"
   ".who{font-size:11px;color:#8a9199;margin-bottom:3px}.who b{color:#c8ccd0}"
   ".user .bubble{background:#2f4f73;color:#eef4fb;border-radius:10px 10px 2px 10px;padding:7px 11px;margin-left:15%;white-space:pre-wrap}"
   ".user .who{text-align:right}"
   ".asst .bubble{background:#2b2f33;border:1px solid #3a4046;border-left:3px solid #6aa6e8;border-radius:6px;padding:8px 12px}"
   "h2,h3,h4,h5{margin:10px 0 5px;color:#9cc7f5}h2{font-size:16px}h3{font-size:14.5px}h4{font-size:13.5px}h5{font-size:13px}"
   "p{margin:5px 0}b{color:#ffffff}i{color:#e8d9a8}a{color:#79b8ff}"
   "a.step{text-decoration:underline;cursor:pointer;color:#7fd0ff;font-weight:600}a.step.done{color:#8a9199}"
   "code{font-family:Consolas,Menlo,monospace;font-size:12px;background:#1b1d1f;color:#e6c07b;padding:1px 4px;border-radius:3px}"
   "pre.code{background:#1b1d1f;border:1px solid #33383d;border-radius:5px;padding:6px 9px;overflow-x:auto;white-space:pre}"
   "pre.code code{background:none;padding:0;color:#c9d1d9}.lang{font-size:10px;color:#7d8590;margin-bottom:3px}"
   "table{border-collapse:collapse;margin:6px 0;font-size:12.5px}"
   "th,td{border:1px solid #3d444b;padding:3px 8px;text-align:left;vertical-align:top}"
   "th{background:#30363c;color:#cfd6dd;font-weight:600}tr:nth-child(even) td{background:#272b2f}"
   "table.kv th{width:1%;white-space:nowrap}"
   ".num{color:#7ee0b8;font-family:Consolas,monospace}"
   "ul,ol{margin:4px 0 4px 20px;padding:0}li{margin:2px 0}.sub{margin-left:18px;color:#b9bec4}"
   "blockquote{border-left:3px solid #556;margin:5px 0;padding:2px 10px;color:#aab}"
   "hr{border:none;border-top:1px solid #3a4046;margin:8px 0}"
   ".info{font-size:11.5px;color:#8a9199;margin:6px 0}"
   ".info.err{color:#ff8f8f}.info.plan{color:#ffd479;font-weight:600}.info.step{color:#9cc7f5;font-weight:600}"
   ".card{background:#262a2e;border:1px solid #3a4046;border-radius:6px;padding:8px 12px;margin:6px 0}"
   ".cardtitle{font-weight:600;margin-bottom:6px;color:#dfe3e7}"
   ".badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;margin-right:4px}"
   ".badge.ok{background:#1f5134;color:#9ff0c0}.badge.bad{background:#5a2024;color:#ffb1b1}"
   "ul.nc,ul.med,ul.ojo{list-style:none;margin:4px 0;padding:0}"
   "ul.nc li{color:#ff9a9a}ul.med li{color:#9fe3b7}ul.ojo li{color:#ffd58a}"
   ".ico{display:inline-block;width:18px}"
   ".ok{color:#7ee0a0}.bad{color:#ff8f8f}.muted{color:#6c737a}"
   "details{margin-top:6px}summary{cursor:pointer;color:#7d8590;font-size:11px}"
   ".grid{margin:6px 0;font-size:0}.row{white-space:nowrap}"
   "figure{display:inline-block;vertical-align:top;margin:0 1% 8px 0;width:48.5%;font-size:12px;background:#1b1d1f;border:1px solid #33383d;border-radius:5px;overflow:hidden;box-sizing:border-box}"
   "figure img{display:block;width:100%;height:auto}"
   "figcaption{font-size:11px;color:#c8ccd0;padding:3px 6px}"
   "figure.rec{border:2px solid #4fbf7a}";

static String StepIndex( String html, int index )
{
   html.ReplaceString( String( "data-m=\"@M@\"" ), String( "data-m=\"" ) + String().Format( "%d", index ) + "\"" );
   return html;
}

String PiCopilotRender::Page( const std::vector<PiCopilotChatEntry>& entries )
{
   String h = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>";
   h << s_css << "</style><script>var picoClick='';function picoStep(a){picoClick=a.getAttribute('data-m')+'|'+"
        "a.getAttribute('data-step');a.className='step done';return false;}</script></head><body>";
   int index = -1;
   for ( const PiCopilotChatEntry& e : entries )
   {
      ++index;
      switch ( e.kind )
      {
      case PiCopilotChatEntry::User:
         h << "<div class=\"msg user\"><div class=\"who\">" << Escape( e.time ) << " &middot; <b>" << Escape( e.title ) << "</b></div>"
           << "<div class=\"bubble\">" << Escape( e.text ) << "</div></div>";
         break;
      case PiCopilotChatEntry::Assistant:
         h << "<div class=\"msg asst\"><div class=\"who\">" << Escape( e.time ) << " &middot; <b>" << Escape( e.title ) << "</b></div>"
           << "<div class=\"bubble\">" << StepIndex( Markdown( e.text ), index ) << "</div></div>";
         break;
      default:
         h << "<div class=\"msg\"><div class=\"who\">" << Escape( e.time ) << "</div>" << Info( e.text );
         if ( !e.images.empty() )
         {
            // Rejilla de vistas previas, incrustadas en base64 (el WebView no carga ficheros locales desde SetHTML).
            // Una fila por imagen: a la izquierda la imagen y a la derecha su gradiente (si el siguiente es "(modelo)").
            auto fig = [&]( const std::pair<String, String>& im ) -> String
            {
               // Referencia al fichero (la página se carga desde un .html en disco: con base64 pasaba de los 2 MB
               // que admite SetHTML y el WebView se quedaba sin actualizar, 5 nov 2026).
               String url = im.second;
               url.ReplaceString( u"\\", u"/" );
               if ( !File::Exists( im.second ) )
                  return String();
               return String( im.first.Contains( u"RECOMENDADO" ) ? "<figure class=\"rec\">" : "<figure>" ) + "<img src=\"file:///"
                    + Escape( url ) + "\"><figcaption>" + Escape( im.first ) + "</figcaption></figure>";
            };
            h << "<div class=\"grid\">";
            for ( size_t i = 0; i < e.images.size(); ++i )
            {
               h << "<div class=\"row\">" << fig( e.images[i] );
               if ( i + 1 < e.images.size() && e.images[i+1].first.Contains( u"(modelo)" ) )
                  h << fig( e.images[++i] );
               h << "</div>";
            }
            h << "</div>";
         }
         h << "</div>";
         break;
      }
   }
   h << "<div id=\"end\"></div><script>window.scrollTo(0, document.body.scrollHeight);</script></body></html>";
   return h;
}

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotRender.cpp
