//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiAstroPilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiAstroPilotParameters.h - Released 2026-09-26T15:04:47Z
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

#ifndef __PiAstroPilotParameters_h
#define __PiAstroPilotParameters_h

#include <pcl/MetaParameter.h>

namespace pcl
{

// ----------------------------------------------------------------------------

PCL_BEGIN_LOCAL

// ----------------------------------------------------------------------------

class PiAstroPilotParameterOne : public MetaFloat
{
public:

   PiAstroPilotParameterOne( MetaProcess* );

   IsoString Id() const override;
   int Precision() const override;
   double DefaultValue() const override;
   double MinimumValue() const override;
   double MaximumValue() const override;
};

extern PiAstroPilotParameterOne* ThePiAstroPilotParameterOneParameter;

// ----------------------------------------------------------------------------

class PiAstroPilotParameterTwo : public MetaInt32
{
public:

   PiAstroPilotParameterTwo( MetaProcess* );

   IsoString Id() const override;
   double DefaultValue() const override;
   double MinimumValue() const override;
   double MaximumValue() const override;
};

extern PiAstroPilotParameterTwo* ThePiAstroPilotParameterTwoParameter;

// ----------------------------------------------------------------------------

class PiAstroPilotParameterThree : public MetaBoolean
{
public:

   PiAstroPilotParameterThree( MetaProcess* );

   IsoString Id() const override;
   bool DefaultValue() const override;
};

extern PiAstroPilotParameterThree* ThePiAstroPilotParameterThreeParameter;

// ----------------------------------------------------------------------------

class PiAstroPilotParameterFour : public MetaEnumeration
{
public:

   enum { FirstItem,
          SecondItem,
          ThirdItem,
          NumberOfItems,
          Default = FirstItem };

   PiAstroPilotParameterFour( MetaProcess* );

   IsoString Id() const override;
   size_type NumberOfElements() const override;
   IsoString ElementId( size_type ) const override;
   int ElementValue( size_type ) const override;
   size_type DefaultValueIndex() const override;
};

extern PiAstroPilotParameterFour* ThePiAstroPilotParameterFourParameter;

// ----------------------------------------------------------------------------

class PiAstroPilotParameterFive : public MetaString
{
public:

   PiAstroPilotParameterFive( MetaProcess* );

   IsoString Id() const override;
   size_type MinLength() const override;
};

extern PiAstroPilotParameterFive* ThePiAstroPilotParameterFiveParameter;

// ----------------------------------------------------------------------------

PCL_END_LOCAL

// ----------------------------------------------------------------------------

} // pcl

#endif   // __PiAstroPilotParameters_h

// ----------------------------------------------------------------------------
// EOF PiAstroPilotParameters.h - Released 2026-09-26T15:04:47Z
