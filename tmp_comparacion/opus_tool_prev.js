// Previews para mirar resultados (no forman parte del procesado).
var V2 = "D:/Astronomia/Master/master/M31/M31_v2";

function cropTo(srcId, rect, newId) {
   var s = ImageWindow.windowById(srcId);
   var im = s.mainView.image; im.resetSelections();
   var w = new ImageWindow(rect.width, rect.height, im.numberOfChannels, 32, true, im.isColor, newId);
   w.mainView.beginProcess(UndoFlag_NoSwapFile); w.mainView.image.assign(im, rect); w.mainView.endProcess();
   return w;
}

// Copia, estirado de visualización fijo (mismos parámetros para todas las variantes), reducción y JPG.
function savePreview(srcId, path, opts) {
   opts = opts || {};
   var s = ImageWindow.windowById(srcId);
   var im = s.mainView.image; im.resetSelections();
   var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, "prevtmp");
   w.mainView.beginProcess(UndoFlag_NoSwapFile); w.mainView.image.assign(im); w.mainView.endProcess();
   if (opts.linear) {
      var H = new HistogramTransformation;
      var sh = opts.shadows || 0.0, mid = opts.mid || 0.002, hi = opts.high || 1;
      H.H = [[0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [0, 0.5, 1, 0, 1], [sh, mid, hi, 0, 1], [0, 0.5, 1, 0, 1]];
      H.executeOn(w.mainView);
   }
   if (opts.reduce && opts.reduce > 1) {
      var R = new IntegerResample; R.zoomFactor = -opts.reduce; R.downsamplingMode = IntegerResample.Average;
      R.executeOn(w.mainView);
   }
   w.saveAs(path, false, false, false, false);
   w.forceClose();
   return path;
}
