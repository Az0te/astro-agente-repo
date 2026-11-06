//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiCopilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiCopilotModule.cpp - Released 2026-09-26T15:04:47Z
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

#define MODULE_VERSION_MAJOR     1
#define MODULE_VERSION_MINOR     1
#define MODULE_VERSION_REVISION  0
#define MODULE_VERSION_BUILD     0
#define MODULE_VERSION_LANGUAGE  eng

#define MODULE_RELEASE_YEAR      2026
#define MODULE_RELEASE_MONTH     11
#define MODULE_RELEASE_DAY       2

#include "PiCopilotModule.h"
#include "PiCopilotProcess.h"
#include "PiCopilotInterface.h"
#include "PiCopilotDialogs.h"

namespace pcl
{

// ----------------------------------------------------------------------------

PiCopilotModule::PiCopilotModule()
{
}

// ----------------------------------------------------------------------------

const char* PiCopilotModule::Version() const
{
   return PCL_MODULE_VERSION( MODULE_VERSION_MAJOR,
                              MODULE_VERSION_MINOR,
                              MODULE_VERSION_REVISION,
                              MODULE_VERSION_BUILD,
                              MODULE_VERSION_LANGUAGE );
}

// ----------------------------------------------------------------------------

IsoString PiCopilotModule::Name() const
{
   /*
    * Replace with the actual name of this module. Must be unique.
    */
   return "PiCopilot";
}

// ----------------------------------------------------------------------------

String PiCopilotModule::Description() const
{
   /*
    * Replace with a short (one-line) description of this module.
    */
   return "PiCopilot: AI assistant panel for PixInsight (Claude, Codex, local models)";
}

// ----------------------------------------------------------------------------

String PiCopilotModule::Company() const
{
   /*
    * Replace with the name of the company that has developed this module, or
    * return an empty String() if not applicable.
    */
   return String();
}

// ----------------------------------------------------------------------------

String PiCopilotModule::Author() const
{
   /*
    * Comma-separated list of module authors.
    * Replace with the name(s) of the actual author(s) of this module.
    */
   return "Rafael";
}

// ----------------------------------------------------------------------------

String PiCopilotModule::Copyright() const
{
   /*
    * Replace with the actual copyright information.
    */
   return "Copyright (c) 2026 Rafael";
}

// ----------------------------------------------------------------------------

String PiCopilotModule::TradeMarks() const
{
   /*
    * Comma-separated list of trade marks.
    * PixInsight should always be included in the list.
    */
   return "PixInsight";
}

// ----------------------------------------------------------------------------

String PiCopilotModule::OriginalFileName() const
{
#ifdef __PCL_FREEBSD
   return "PiCopilot-pxm.so";
#endif
#ifdef __PCL_LINUX
   return "PiCopilot-pxm.so";
#endif
#ifdef __PCL_MACOSX
   return "PiCopilot-pxm.dylib";
#endif
#ifdef __PCL_WINDOWS
   return "PiCopilot-pxm.dll";
#endif
}

// ----------------------------------------------------------------------------

void PiCopilotModule::GetReleaseDate( int& year, int& month, int& day ) const
{
   year  = MODULE_RELEASE_YEAR;
   month = MODULE_RELEASE_MONTH;
   day   = MODULE_RELEASE_DAY;
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------

/*
 * Module installation routine.
 *
 * If this routine is defined as a public symbol in a module, the PixInsight
 * core application will call it just after loading and initializing the module
 * shared object or dynamic-link library.
 *
 * The mode argument specifies the kind of installation being performed by the
 * core application. See the pcl::InstallMode namespace for more information.
 */
PCL_MODULE_EXPORT int InstallPixInsightModule( int mode )
{
   /*
    * When the PixInsight application installs this module, we just have to
    * instantiate the meta objects describing it.
    */
   new pcl::PiCopilotModule;

   /*
    * The mode argument tells us which kind of installation is being requested
    * by the PixInsight application. Incomplete installation requests only need
    * module descriptions.
    */
   if ( mode == pcl::InstallMode::FullInstall )
   {
      new pcl::PiCopilotProcess;
      new pcl::PiCopilotInterface;
      new pcl::PiCopilotChatDialog;
      new pcl::PiCopilotDossierDialog;
   }

   /*
    * Return zero to signal successful installation
    */
   return 0;
}

// ----------------------------------------------------------------------------
// EOF PiCopilotModule.cpp - Released 2026-09-26T15:04:47Z
