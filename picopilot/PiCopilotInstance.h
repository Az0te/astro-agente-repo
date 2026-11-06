//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiCopilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiCopilotInstance.h - Released 2026-09-26T15:04:47Z
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

#ifndef __PiCopilotInstance_h
#define __PiCopilotInstance_h

#include <pcl/MetaParameter.h> // pcl_bool, pcl_enum
#include <pcl/ProcessImplementation.h>

namespace pcl
{

// ----------------------------------------------------------------------------

class PiCopilotInstance : public ProcessImplementation
{
public:

   PiCopilotInstance( const MetaProcess* );
   PiCopilotInstance( const PiCopilotInstance& );

   void Assign( const ProcessImplementation& ) override;
   UndoFlags UndoMode( const View& ) const override;
   bool CanExecuteOn( const View&, pcl::String& whyNot ) const override;
   bool ExecuteOn( View& ) override;
   void* LockParameter( const MetaParameter*, size_type tableRow ) override;
   bool AllocateParameter( size_type sizeOrLength, const MetaParameter* p, size_type tableRow ) override;
   size_type ParameterLength( const MetaParameter* p, size_type tableRow ) const override;

private:

   float    p_one;   // Real parameters can be either float or double
   int32    p_two;   // ONLY use intxx or uintxx - NEVER int, long, etc.
   pcl_bool p_three; // ONLY pcl_bool for Boolean parameter - NEVER use bool
   pcl_enum p_four;  // ONLY pcl_enum for enumerated parameters - NEVER use enum, int, etc.
   String   p_five;  // String parameters must be UTF-16 strings

   friend class PiCopilotEngine;
   friend class PiCopilotProcess;
   friend class PiCopilotInterface;
};

// ----------------------------------------------------------------------------


} // pcl

#endif   // __PiCopilotInstance_h

// ----------------------------------------------------------------------------
// EOF PiCopilotInstance.h - Released 2026-09-26T15:04:47Z
