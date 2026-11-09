//     ____   ______ __
//    / __ \ / ____// /
//   / /_/ // /    / /
//  / ____// /___ / /___   PixInsight Class Library
// /_/     \____//_____/   PCL 2.10.9
// ----------------------------------------------------------------------------
// Standard PiAstroPilot Process Module Version 1.0.2
// ----------------------------------------------------------------------------
// PiAstroPilotInstance.cpp - Released 2026-09-26T15:04:47Z
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

#include "PiAstroPilotInstance.h"
#include "PiAstroPilotParameters.h"

#include <pcl/AutoViewLock.h>
#include <pcl/Console.h>
#include <pcl/StandardStatus.h>
#include <pcl/View.h>

namespace pcl
{

// ----------------------------------------------------------------------------

PiAstroPilotInstance::PiAstroPilotInstance( const MetaProcess* m )
   : ProcessImplementation( m )
   , p_one( ThePiAstroPilotParameterOneParameter->DefaultValue() )
   , p_two( int32( ThePiAstroPilotParameterTwoParameter->DefaultValue() ) )
   , p_three( ThePiAstroPilotParameterThreeParameter->DefaultValue() )
   , p_four( PiAstroPilotParameterFour::Default )
   , p_five( ThePiAstroPilotParameterFiveParameter->DefaultValue() )
{
}

// ----------------------------------------------------------------------------

PiAstroPilotInstance::PiAstroPilotInstance( const PiAstroPilotInstance& x )
   : ProcessImplementation( x )
{
   Assign( x );
}

// ----------------------------------------------------------------------------

void PiAstroPilotInstance::Assign( const ProcessImplementation& p )
{
   const PiAstroPilotInstance* x = dynamic_cast<const PiAstroPilotInstance*>( &p );
   if ( x != nullptr )
   {
      p_one   = x->p_one;
      p_two   = x->p_two;
      p_three = x->p_three;
      p_four  = x->p_four;
      p_five  = x->p_five;
   }
}

// ----------------------------------------------------------------------------

UndoFlags PiAstroPilotInstance::UndoMode( const View& ) const
{
   /*
    * The following flag assumes that your process modifies pixel sample values
    * *exclusively*. If you are going to change anything else, such as image
    * geometry, keywords, etc., or maybe nothing at all (in case you are
    * implementing an image observer process), see the UpdateFlag enumeration
    * in pcl/ImageWindow.h for complete information.
    */
   return UndoFlag::PixelData;
}

// ----------------------------------------------------------------------------

bool PiAstroPilotInstance::CanExecuteOn( const View& view, String& whyNot ) const
{
   if ( view.Image().IsComplexSample() )
   {
      whyNot = "PiAstroPilot cannot be executed on complex images.";
      return false;
   }
   return true;
}

// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------

class PiAstroPilotEngine
{
public:

   template <class P>
   static void Apply( GenericImage<P>& image, const PiAstroPilotInstance& instance )
   {
      /*
       * Your magic comes here...
       */
      Console().WriteLn( "<end><cbr>Ah, did I mention that I do just <em>nothing at all</em>? ;D" );
   }
};

// ----------------------------------------------------------------------------

bool PiAstroPilotInstance::ExecuteOn( View& view )
{
   AutoViewLock lock( view );

   ImageVariant image = view.Image();
   if ( image.IsComplexSample() )
      return false;

   StandardStatus status;
   image.SetStatusCallback( &status );

   Console().EnableAbort();

   if ( image.IsFloatSample() )
      switch ( image.BitsPerSample() )
      {
      case 32: PiAstroPilotEngine::Apply( static_cast<Image&>( *image ), *this ); break;
      case 64: PiAstroPilotEngine::Apply( static_cast<DImage&>( *image ), *this ); break;
      }
   else
      switch ( image.BitsPerSample() )
      {
      case  8: PiAstroPilotEngine::Apply( static_cast<UInt8Image&>( *image ), *this ); break;
      case 16: PiAstroPilotEngine::Apply( static_cast<UInt16Image&>( *image ), *this ); break;
      case 32: PiAstroPilotEngine::Apply( static_cast<UInt32Image&>( *image ), *this ); break;
      }

   return true;
}

// ----------------------------------------------------------------------------

void* PiAstroPilotInstance::LockParameter( const MetaParameter* p, size_type /*tableRow*/ )
{
   if ( p == ThePiAstroPilotParameterOneParameter )
      return &p_one;
   if ( p == ThePiAstroPilotParameterTwoParameter )
      return &p_two;
   if ( p == ThePiAstroPilotParameterThreeParameter )
      return &p_three;
   if ( p == ThePiAstroPilotParameterFourParameter )
      return &p_four;
   if ( p == ThePiAstroPilotParameterFiveParameter )
      return p_five.Begin();

   return nullptr;
}

// ----------------------------------------------------------------------------

bool PiAstroPilotInstance::AllocateParameter( size_type sizeOrLength, const MetaParameter* p, size_type tableRow )
{
   if ( p == ThePiAstroPilotParameterFiveParameter )
   {
      p_five.Clear();
      if ( sizeOrLength > 0 )
         p_five.SetLength( sizeOrLength );
   }
   else
      return false;

   return true;
}

// ----------------------------------------------------------------------------

size_type PiAstroPilotInstance::ParameterLength( const MetaParameter* p, size_type tableRow ) const
{
   if ( p == ThePiAstroPilotParameterFiveParameter )
      return p_five.Length();

   return 0;
}

// ----------------------------------------------------------------------------

} // pcl

// ----------------------------------------------------------------------------
// EOF PiAstroPilotInstance.cpp - Released 2026-09-26T15:04:47Z
