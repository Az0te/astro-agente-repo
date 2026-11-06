//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiCopilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiCopilotProcess.cpp - Released 2026-09-26T15:04:47Z
// ----------------------------------------------------------------------------
// This file is part of the standard PiCopilot PixInsight module.
//
// Copyright (c) 2003-2026 Pleiades Astrophoto S.L. All Rights Reserved.
//
// The use of this source code is governed by the PixInsight Class Library
// License Version 2.0, which can be found in the LICENSE file included with
// this distribution, as well as at:
// https://pixinsight.com/license/PCL-License-2.0.html
// ----------------------------------------------------------------------------

#include "PiCopilotInstance.h"
#include "PiCopilotInterface.h"
#include "PiCopilotParameters.h"
#include "PiCopilotProcess.h"

#include <pcl/Arguments.h>
#include <pcl/Console.h>
#include <pcl/Exception.h>
#include <pcl/View.h>

namespace pcl
{

// ----------------------------------------------------------------------------

PiCopilotProcess* ThePiCopilotProcess = nullptr;

// ----------------------------------------------------------------------------

PiCopilotProcess::PiCopilotProcess()
{
   ThePiCopilotProcess = this;

   /*
    * Instantiate process parameters.
    */
   new PiCopilotParameterOne( this );
   new PiCopilotParameterTwo( this );
   new PiCopilotParameterThree( this );
   new PiCopilotParameterFour( this );
   new PiCopilotParameterFive( this );
}

// ----------------------------------------------------------------------------

IsoString PiCopilotProcess::Id() const
{
   return "PiCopilot";
}

// ----------------------------------------------------------------------------

IsoString PiCopilotProcess::Category() const
{
   /*
    * Comma-separated list of categories to which this process belongs.
    * Return an empty IsoString() if no category is applicable to this process,
    * which is *not recommended*.
    */
   return IsoString();
}

// ----------------------------------------------------------------------------

uint32 PiCopilotProcess::Version() const
{
   return 0x100;
}

// ----------------------------------------------------------------------------

String PiCopilotProcess::IconImageSVGFile() const
{
   return "@module_icons_dir/PiCopilot.svg";
}

// ----------------------------------------------------------------------------

ProcessInterface* PiCopilotProcess::DefaultInterface() const
{
   return ThePiCopilotInterface;
}

// ----------------------------------------------------------------------------

ProcessImplementation* PiCopilotProcess::Create() const
{
   return new PiCopilotInstance( this );
}

// ----------------------------------------------------------------------------

ProcessImplementation* PiCopilotProcess::Clone( const ProcessImplementation& p ) const
{
   const PiCopilotInstance* instance = dynamic_cast<const PiCopilotInstance*>( &p );
   return (instance != nullptr) ? new PiCopilotInstance( *instance ) : nullptr;
}

// ----------------------------------------------------------------------------

bool PiCopilotProcess::CanProcessCommandLines() const
{
   return true;
}

// ----------------------------------------------------------------------------

static void ShowHelp()
{
   Console().Write(
"<raw>"
"Usage: PiCopilot [<arg_list>] [<view_list>]"
"\n"
"\n--interface"
"\n"
"\n      Launches the interface of this process."
"\n"
"\n--help"
"\n"
"\n      Displays this help and exits."
"</raw>" );
}

int PiCopilotProcess::ProcessCommandLine( const StringList& argv ) const
{
   ArgumentList arguments = ExtractArguments( argv, ArgumentItemMode::AsViews, ArgumentOption::AllowWildcards );

   PiCopilotInstance instance( this );

   bool launchInterface = false;
   int count = 0;

   for ( const Argument& arg : arguments )
   {
      if ( arg.IsNumeric() )
      {
         throw Error( "Unknown numeric argument: " + arg.Token() );
      }
      else if ( arg.IsString() )
      {
         throw Error( "Unknown string argument: " + arg.Token() );
      }
      else if ( arg.IsSwitch() )
      {
         throw Error( "Unknown switch argument: " + arg.Token() );
      }
      else if ( arg.IsLiteral() )
      {
         // These are standard parameters that all processes should provide.
         if ( arg.Id() == "-interface" )
            launchInterface = true;
         else if ( arg.Id() == "-help" )
         {
            ShowHelp();
            return 0;
         }
         else
            throw Error( "Unknown argument: " + arg.Token() );
      }
      else if ( arg.IsItemList() )
      {
         ++count;

         if ( arg.Items().IsEmpty() )
            throw Error( "No view(s) found: " + arg.Token() );

         for ( StringList::const_iterator j = arg.Items().Begin(); j != arg.Items().End(); ++j )
         {
            View v = View::ViewById( *j );
            if ( v.IsNull() )
               throw Error( "No such view: " + *j );
            instance.LaunchOn( v );
         }
      }
   }

   if ( launchInterface )
      instance.LaunchInterface();
   else if ( count == 0 )
   {
      if ( ImageWindow::ActiveWindow().IsNull() )
         throw Error( "There is no active image window." );
      instance.LaunchOnCurrentView();
   }

   return 0;
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotProcess.cpp - Released 2026-09-26T15:04:47Z
