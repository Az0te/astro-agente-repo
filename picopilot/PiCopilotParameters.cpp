//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiCopilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiCopilotParameters.cpp - Released 2026-09-26T15:04:47Z
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

#include "PiCopilotParameters.h"

namespace pcl
{

// ----------------------------------------------------------------------------

PiCopilotParameterOne*   ThePiCopilotParameterOneParameter = nullptr;
PiCopilotParameterTwo*   ThePiCopilotParameterTwoParameter = nullptr;
PiCopilotParameterThree* ThePiCopilotParameterThreeParameter = nullptr;
PiCopilotParameterFour*  ThePiCopilotParameterFourParameter = nullptr;
PiCopilotParameterFive*  ThePiCopilotParameterFiveParameter = nullptr;

// ----------------------------------------------------------------------------

PiCopilotParameterOne::PiCopilotParameterOne( MetaProcess* P ) : MetaFloat( P )
{
   ThePiCopilotParameterOneParameter = this;
}

IsoString PiCopilotParameterOne::Id() const
{
   return "sampleOne";
}

int PiCopilotParameterOne::Precision() const
{
   return 3;
}

double PiCopilotParameterOne::DefaultValue() const
{
   return 0;
}

double PiCopilotParameterOne::MinimumValue() const
{
   return 0;
}

double PiCopilotParameterOne::MaximumValue() const
{
   return 1;
}

// ----------------------------------------------------------------------------

PiCopilotParameterTwo::PiCopilotParameterTwo( MetaProcess* P ) : MetaInt32( P )
{
   ThePiCopilotParameterTwoParameter = this;
}

IsoString PiCopilotParameterTwo::Id() const
{
   return "sampleTwo";
}

double PiCopilotParameterTwo::DefaultValue() const
{
   return 1;
}

double PiCopilotParameterTwo::MinimumValue() const
{
   return 1;
}

double PiCopilotParameterTwo::MaximumValue() const
{
   return 100;
}

// ----------------------------------------------------------------------------

PiCopilotParameterThree::PiCopilotParameterThree( MetaProcess* P ) : MetaBoolean( P )
{
   ThePiCopilotParameterThreeParameter = this;
}

IsoString PiCopilotParameterThree::Id() const
{
   return "sampleThree";
}

bool PiCopilotParameterThree::DefaultValue() const
{
   return false;
}

// ----------------------------------------------------------------------------

PiCopilotParameterFour::PiCopilotParameterFour( MetaProcess* P ) : MetaEnumeration( P )
{
   ThePiCopilotParameterFourParameter = this;
}

IsoString PiCopilotParameterFour::Id() const
{
   return "sampleFour";
}

size_type PiCopilotParameterFour::NumberOfElements() const
{
   return NumberOfItems;
}

IsoString PiCopilotParameterFour::ElementId( size_type i ) const
{
   switch ( i )
   {
   default:
   case FirstItem:  return "FirstItem";
   case SecondItem: return "SecondItem";
   case ThirdItem:  return "ThirdItem";
   }
}

int PiCopilotParameterFour::ElementValue( size_type i ) const
{
   return int( i );
}

size_type PiCopilotParameterFour::DefaultValueIndex() const
{
   return Default;
}

// ----------------------------------------------------------------------------

PiCopilotParameterFive::PiCopilotParameterFive( MetaProcess* P ) : MetaString( P )
{
   ThePiCopilotParameterFiveParameter = this;
}

IsoString PiCopilotParameterFive::Id() const
{
   return "sampleFive";
}

size_type PiCopilotParameterFive::MinLength() const
{
   return 0;
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiCopilotParameters.cpp - Released 2026-09-26T15:04:47Z
