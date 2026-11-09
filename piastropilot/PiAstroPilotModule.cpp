//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiAstroPilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiAstroPilotModule.cpp - Released 2026-09-26T15:04:47Z
// ----------------------------------------------------------------------------
// This file is part of the standard PiAstroPilot PixInsight module.
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

#include "PiAstroPilotModule.h"
#include "PiAstroPilotProcess.h"
#include "PiAstroPilotInterface.h"
#include "PiAstroPilotDialogs.h"

namespace pcl
{

// ----------------------------------------------------------------------------

PiAstroPilotModule::PiAstroPilotModule()
{
}

// ----------------------------------------------------------------------------

const char* PiAstroPilotModule::Version() const
{
   return PCL_MODULE_VERSION( MODULE_VERSION_MAJOR,
                              MODULE_VERSION_MINOR,
                              MODULE_VERSION_REVISION,
                              MODULE_VERSION_BUILD,
                              MODULE_VERSION_LANGUAGE );
}

// ----------------------------------------------------------------------------

IsoString PiAstroPilotModule::Name() const
{
   /*
    * Replace with the actual name of this module. Must be unique.
    */
   return "PiAstroPilot";
}

// ----------------------------------------------------------------------------

String PiAstroPilotModule::Description() const
{
   /*
    * Replace with a short (one-line) description of this module.
    */
   return "PiAstroPilot: AI assistant panel for PixInsight (Claude, Codex, local models)";
}

// ----------------------------------------------------------------------------

String PiAstroPilotModule::Company() const
{
   /*
    * Replace with the name of the company that has developed this module, or
    * return an empty String() if not applicable.
    */
   return String();
}

// ----------------------------------------------------------------------------

String PiAstroPilotModule::Author() const
{
   /*
    * Comma-separated list of module authors.
    * Replace with the name(s) of the actual author(s) of this module.
    */
   return "Rafael";
}

// ----------------------------------------------------------------------------

String PiAstroPilotModule::Copyright() const
{
   /*
    * Replace with the actual copyright information.
    */
   return "Copyright (c) 2026 Rafael";
}

// ----------------------------------------------------------------------------

String PiAstroPilotModule::TradeMarks() const
{
   /*
    * Comma-separated list of trade marks.
    * PixInsight should always be included in the list.
    */
   return "PixInsight";
}

// ----------------------------------------------------------------------------

String PiAstroPilotModule::OriginalFileName() const
{
#ifdef __PCL_FREEBSD
   return "PiAstroPilot-pxm.so";
#endif
#ifdef __PCL_LINUX
   return "PiAstroPilot-pxm.so";
#endif
#ifdef __PCL_MACOSX
   return "PiAstroPilot-pxm.dylib";
#endif
#ifdef __PCL_WINDOWS
   return "PiAstroPilot-pxm.dll";
#endif
}

// ----------------------------------------------------------------------------

void PiAstroPilotModule::GetReleaseDate( int& year, int& month, int& day ) const
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
   new pcl::PiAstroPilotModule;

   /*
    * The mode argument tells us which kind of installation is being requested
    * by the PixInsight application. Incomplete installation requests only need
    * module descriptions.
    */
   if ( mode == pcl::InstallMode::FullInstall )
   {
      new pcl::PiAstroPilotProcess;
      new pcl::PiAstroPilotInterface;
      new pcl::PiAstroPilotChatDialog;
      new pcl::PiAstroPilotDossierDialog;
   }

   /*
    * Return zero to signal successful installation
    */
   return 0;
}

// ----------------------------------------------------------------------------
// EOF PiAstroPilotModule.cpp - Released 2026-09-26T15:04:47Z
