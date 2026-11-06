//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiCopilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiCopilotParameters.h - Released 2026-09-26T15:04:47Z
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

#ifndef __PiCopilotParameters_h
#define __PiCopilotParameters_h

#include <pcl/MetaParameter.h>

namespace pcl
{

// ----------------------------------------------------------------------------

PCL_BEGIN_LOCAL

// ----------------------------------------------------------------------------

class PiCopilotParameterOne : public MetaFloat
{
public:

   PiCopilotParameterOne( MetaProcess* );

   IsoString Id() const override;
   int Precision() const override;
   double DefaultValue() const override;
   double MinimumValue() const override;
   double MaximumValue() const override;
};

extern PiCopilotParameterOne* ThePiCopilotParameterOneParameter;

// ----------------------------------------------------------------------------

class PiCopilotParameterTwo : public MetaInt32
{
public:

   PiCopilotParameterTwo( MetaProcess* );

   IsoString Id() const override;
   double DefaultValue() const override;
   double MinimumValue() const override;
   double MaximumValue() const override;
};

extern PiCopilotParameterTwo* ThePiCopilotParameterTwoParameter;

// ----------------------------------------------------------------------------

class PiCopilotParameterThree : public MetaBoolean
{
public:

   PiCopilotParameterThree( MetaProcess* );

   IsoString Id() const override;
   bool DefaultValue() const override;
};

extern PiCopilotParameterThree* ThePiCopilotParameterThreeParameter;

// ----------------------------------------------------------------------------

class PiCopilotParameterFour : public MetaEnumeration
{
public:

   enum { FirstItem,
          SecondItem,
          ThirdItem,
          NumberOfItems,
          Default = FirstItem };

   PiCopilotParameterFour( MetaProcess* );

   IsoString Id() const override;
   size_type NumberOfElements() const override;
   IsoString ElementId( size_type ) const override;
   int ElementValue( size_type ) const override;
   size_type DefaultValueIndex() const override;
};

extern PiCopilotParameterFour* ThePiCopilotParameterFourParameter;

// ----------------------------------------------------------------------------

class PiCopilotParameterFive : public MetaString
{
public:

   PiCopilotParameterFive( MetaProcess* );

   IsoString Id() const override;
   size_type MinLength() const override;
};

extern PiCopilotParameterFive* ThePiCopilotParameterFiveParameter;

// ----------------------------------------------------------------------------

PCL_END_LOCAL

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiCopilotParameters_h

// ----------------------------------------------------------------------------
// EOF PiCopilotParameters.h - Released 2026-09-26T15:04:47Z
