// Máscaras suaves de gran escala (luminancia binada ×bin y ampliada de nuevo).
function smoothLum(srcId, newId, bin) {
   var s = ImageWindow.windowById(srcId), im = s.mainView.image;
   var P = new PixelMath;
   P.expression = "($T[0]+$T[1]+$T[2])/3"; P.createNewImage = true; P.newImageId = newId;
   P.newImageColorSpace = PixelMath.Gray; P.newImageSampleFormat = PixelMath.f32;
   if (!P.executeOn(s.mainView)) throw new Error("L falló");
   var w = ImageWindow.windowById(newId);
   var R = new IntegerResample; R.zoomFactor = -bin; R.downsamplingMode = IntegerResample.Average;
   if (!R.executeOn(w.mainView)) throw new Error("bin falló");
   var Z = new Resample; Z.absoluteMode = Resample.ForceWidthAndHeight;
   Z.xSize = im.width; Z.ySize = im.height; Z.mode = Resample.AbsolutePixels; Z.interpolation = Resample.BicubicSpline;
   if (!Z.executeOn(w.mainView)) throw new Error("resample falló");
   return w;
}

function pmNew(expr, srcId, newId, symbols) {
   var P = new PixelMath;
   P.expression = expr; if (symbols) P.symbols = symbols;
   P.createNewImage = true; P.newImageId = newId;
   P.newImageColorSpace = PixelMath.Gray; P.newImageSampleFormat = PixelMath.f32;
   P.rescale = false; P.truncate = true;
   if (!P.executeOn(View.viewById(srcId))) throw new Error("PixelMath " + newId);
   return ImageWindow.windowById(newId);
}
