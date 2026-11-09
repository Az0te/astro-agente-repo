//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiAstroPilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiAstroPilotModule.h - Released 2026-09-26T15:04:47Z
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

#ifndef __PiAstroPilotModule_h
#define __PiAstroPilotModule_h

#include <pcl/MetaModule.h>

namespace pcl
{

// ----------------------------------------------------------------------------

class PiAstroPilotModule : public MetaModule
{
public:

   PiAstroPilotModule();

   const char* Version() const override;
   IsoString Name() const override;
   String Description() const override;
   String Company() const override;
   String Author() const override;
   String Copyright() const override;
   String TradeMarks() const override;
   String OriginalFileName() const override;
   void GetReleaseDate( int& year, int& month, int& day ) const override;
};

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiAstroPilotModule_h

// ----------------------------------------------------------------------------
// EOF PiAstroPilotModule.h - Released 2026-09-26T15:04:47Z
