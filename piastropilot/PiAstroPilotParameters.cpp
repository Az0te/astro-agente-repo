//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiAstroPilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiAstroPilotParameters.cpp - Released 2026-09-26T15:04:47Z
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

#include "PiAstroPilotParameters.h"

namespace pcl
{

// ----------------------------------------------------------------------------

PiAstroPilotParameterOne*   ThePiAstroPilotParameterOneParameter = nullptr;
PiAstroPilotParameterTwo*   ThePiAstroPilotParameterTwoParameter = nullptr;
PiAstroPilotParameterThree* ThePiAstroPilotParameterThreeParameter = nullptr;
PiAstroPilotParameterFour*  ThePiAstroPilotParameterFourParameter = nullptr;
PiAstroPilotParameterFive*  ThePiAstroPilotParameterFiveParameter = nullptr;

// ----------------------------------------------------------------------------

PiAstroPilotParameterOne::PiAstroPilotParameterOne( MetaProcess* P ) : MetaFloat( P )
{
   ThePiAstroPilotParameterOneParameter = this;
}

IsoString PiAstroPilotParameterOne::Id() const
{
   return "sampleOne";
}

int PiAstroPilotParameterOne::Precision() const
{
   return 3;
}

double PiAstroPilotParameterOne::DefaultValue() const
{
   return 0;
}

double PiAstroPilotParameterOne::MinimumValue() const
{
   return 0;
}

double PiAstroPilotParameterOne::MaximumValue() const
{
   return 1;
}

// ----------------------------------------------------------------------------

PiAstroPilotParameterTwo::PiAstroPilotParameterTwo( MetaProcess* P ) : MetaInt32( P )
{
   ThePiAstroPilotParameterTwoParameter = this;
}

IsoString PiAstroPilotParameterTwo::Id() const
{
   return "sampleTwo";
}

double PiAstroPilotParameterTwo::DefaultValue() const
{
   return 1;
}

double PiAstroPilotParameterTwo::MinimumValue() const
{
   return 1;
}

double PiAstroPilotParameterTwo::MaximumValue() const
{
   return 100;
}

// ----------------------------------------------------------------------------

PiAstroPilotParameterThree::PiAstroPilotParameterThree( MetaProcess* P ) : MetaBoolean( P )
{
   ThePiAstroPilotParameterThreeParameter = this;
}

IsoString PiAstroPilotParameterThree::Id() const
{
   return "sampleThree";
}

bool PiAstroPilotParameterThree::DefaultValue() const
{
   return false;
}

// ----------------------------------------------------------------------------

PiAstroPilotParameterFour::PiAstroPilotParameterFour( MetaProcess* P ) : MetaEnumeration( P )
{
   ThePiAstroPilotParameterFourParameter = this;
}

IsoString PiAstroPilotParameterFour::Id() const
{
   return "sampleFour";
}

size_type PiAstroPilotParameterFour::NumberOfElements() const
{
   return NumberOfItems;
}

IsoString PiAstroPilotParameterFour::ElementId( size_type i ) const
{
   switch ( i )
   {
   default:
   case FirstItem:  return "FirstItem";
   case SecondItem: return "SecondItem";
   case ThirdItem:  return "ThirdItem";
   }
}

int PiAstroPilotParameterFour::ElementValue( size_type i ) const
{
   return int( i );
}

size_type PiAstroPilotParameterFour::DefaultValueIndex() const
{
   return Default;
}

// ----------------------------------------------------------------------------

PiAstroPilotParameterFive::PiAstroPilotParameterFive( MetaProcess* P ) : MetaString( P )
{
   ThePiAstroPilotParameterFiveParameter = this;
}

IsoString PiAstroPilotParameterFive::Id() const
{
   return "sampleFive";
}

size_type PiAstroPilotParameterFive::MinLength() const
{
   return 0;
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiAstroPilotParameters.cpp - Released 2026-09-26T15:04:47Z
