// M31 v2: estirado de la starless con GHS (modo color) y métricas de control.
var V2 = "D:/Astronomia/Master/master/M31/M31_v2";
var NUC = [3005, 2000];

function dupView(srcId, id) {
   var s = ImageWindow.windowById(srcId);
   var im = s.mainView.image; im.resetSelections();
   var old = ImageWindow.windowById(id); if (!old.isNull) old.forceClose();
   var w = new ImageWindow(im.width, im.height, im.numberOfChannels, 32, true, im.isColor, id);
   w.mainView.beginProcess(UndoFlag_NoSwapFile); w.mainView.image.assign(im); w.mainView.endProcess();
   w.copyAstrometricSolution(s);
   return w;
}

function boxMedian(im, x0, y0, x1, y1, c) {
   var r = new Rect(x0, y0, x1, y1), b = new Float32Array(r.width * r.height);
   im.getSamples(b, r, c);
   var a = Array.prototype.slice.call(b).sort(function (p, q) { return p - q; });
   return a[a.length >> 1];
}

// L = media de canales (vale para el control de recorte del núcleo)
function lumStats(v) {
   var im = v.image;
   var sky = boxMedian(im, 5600, 200, 6000, 600, 1);
   var med = (function () { im.selectedChannel = 1; var m = im.median(); im.resetSelections(); return m; })();
   function pctAbove(rad, t) {
      var r = new Rect(NUC[0] - rad, NUC[1] - rad, NUC[0] + rad, NUC[1] + rad), n = r.width * r.height, cnt = 0, mx = 0;
      var bs = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
      for (var c = 0; c < 3; c++) im.getSamples(bs[c], r, c);
      for (var i = 0; i < n; i++) { var m = Math.max(bs[0][i], bs[1][i], bs[2][i]); if (m > t) cnt++; if (m > mx) mx = m; }
      return { pct: 100 * cnt / n, max: mx };
   }
   var a = pctAbove(64, 0.93), b = pctAbove(16, 0.93);
   return {
      sky: +sky.toFixed(4), median: +med.toFixed(4),
      nuc128: +a.pct.toFixed(2), nuc32: +b.pct.toFixed(2), nucMax: +b.max.toFixed(3),
      bulge300: +boxMedian(im, NUC[0] + 250, NUC[1] - 25, NUC[0] + 300, NUC[1] + 25, 1).toFixed(3),
      ngc206: +boxMedian(im, 4505, 2580, 4555, 2630, 1).toFixed(3),
      disk_out: +boxMedian(im, 5000, 3000, 5100, 3100, 1).toFixed(3)
   };
}

function ghs(v, D, b, SP, LP, HP, ch) {
   var P = new GeneralizedHyperbolicStretch;
   P.stretchType = GeneralizedHyperbolicStretch.ST_GeneralisedHyperbolic;
   P.stretchChannel = (ch === undefined) ? GeneralizedHyperbolicStretch.SC_Colour : ch;
   P.stretchFactor = D; P.localIntensity = b; P.symmetryPoint = SP;
   P.shadowProtection = LP; P.highlightProtection = HP;
   if (!P.executeOn(v)) throw new Error("GHS falló D=" + D + " b=" + b);
}

function medG(v) { var im = v.image; im.selectedChannel = 1; var m = im.median(); im.resetSelections(); return m; }
function skyG(v) { return boxMedian(v.image, 5600, 200, 6000, 600, 1); }
