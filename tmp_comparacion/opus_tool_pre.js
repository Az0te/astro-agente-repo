// M31 v2: preprocesado desde el watcher (cadena de procesos equivalente a WBPP).
var V2 = "D:/Astronomia/Master/master/M31/M31_v2";
var RAW = "D:/Astronomia/SQA106/M31";

function listFits(dir) { return searchDirectory(dir + "/*.fits", false).sort(); }

// Integración de calibración (darks / flat-darks): Average, sin normalización, pesos 1, Winsorized.
function integrateCal(files, outPath, isFlat) {
   var P = new ImageIntegration;
   P.images = files.map(function (f) { return [true, f, "", ""]; });
   P.combination = ImageIntegration.Average;
   P.weightMode = ImageIntegration.DontCare;
   P.normalization = isFlat ? ImageIntegration.Multiplicative : ImageIntegration.NoNormalization;
   P.rejection = ImageIntegration.WinsorizedSigmaClip;
   P.rejectionNormalization = isFlat ? ImageIntegration.EqualizeFluxes : ImageIntegration.NoRejectionNormalization;
   P.sigmaLow = 3; P.sigmaHigh = 3;
   P.evaluateSNR = false;
   P.generateRejectionMaps = false;
   P.subtractPedestals = false;
   P.rangeClipLow = false;
   P.showImages = true;
   if (!P.executeGlobal()) throw new Error("ImageIntegration falló: " + outPath);
   var w = ImageWindow.windowById(P.integrationImageId);
   w.saveAs(outPath, false, false, false, false);
   w.forceClose();
   return outPath;
}

function calibrate(files, outDir, darkPath, flatPath) {
   var P = new ImageCalibration;
   P.targetFrames = files.map(function (f) { return [true, f]; });
   P.enableCFA = true;
   P.masterBiasEnabled = false;
   P.masterDarkEnabled = !!darkPath; P.masterDarkPath = darkPath || "";
   P.masterFlatEnabled = !!flatPath; P.masterFlatPath = flatPath || "";
   P.calibrateDark = false; P.calibrateFlat = false;
   P.optimizeDarks = false;
   P.separateCFAFlatScalingFactors = true;
   P.outputDirectory = outDir;
   P.outputPedestalMode = ImageCalibration.OutputPedestal_Auto;
   P.autoPedestalLimit = 0.0001;
   if (typeof CC_HIGH != "undefined" && CC_HIGH) { P.cosmeticCorrectionHigh = true; P.cosmeticHighSigma = CC_HIGH; }
   P.overwriteExistingFiles = true;
   P.onError = ImageCalibration.Continue;
   if (!P.executeGlobal()) throw new Error("ImageCalibration falló en " + outDir);
   return P.outputData.map(function (r) { return r[0]; });
}

function debayer(files, outDir) {
   var P = new Debayer;
   P.cfaPattern = Debayer.Auto;
   P.debayerMethod = Debayer.VNG;
   P.targetItems = files.map(function (f) { return [true, f]; });
   P.outputDirectory = outDir;
   P.overwriteExistingFiles = true;
   P.showImages = false;
   if (!P.executeGlobal()) throw new Error("Debayer falló");
   return P.outputFileData.map(function (r) { return r[0]; });
}

function register(files, ref, outDir) {
   var P = new StarAlignment;
   P.referenceImage = ref; P.referenceIsFile = true;
   P.targets = files.map(function (f) { return [true, true, f]; });
   P.distortionCorrection = true;
   P.rbfType = StarAlignment.DDMThinPlateSpline;
   P.generateDrizzleData = false;
   P.outputDirectory = outDir;
   P.overwriteExistingFiles = true;
   P.onError = StarAlignment.Continue;
   if (!P.executeGlobal()) throw new Error("StarAlignment falló");
   return P.outputData.map(function (r) { return r[0]; });
}

function localNorm(files, ref, outDir) {
   var P = new LocalNormalization;
   P.scale = 1024;
   P.referencePathOrViewId = ref; P.referenceIsView = false;
   P.targetItems = files.map(function (f) { return [true, f]; });
   P.generateNormalizedImages = LocalNormalization.GenerateNormalizedImages_Never;
   P.generateNormalizationData = true;
   P.outputDirectory = outDir;
   P.overwriteExistingFiles = true;
   if (!P.executeGlobal()) throw new Error("LocalNormalization falló");
   return P.outputData.map(function (r) { return r[0]; });
}

function integrateLights(files, lnFiles, outPath) {
   var P = new ImageIntegration;
   P.images = files.map(function (f, i) { return [true, f, "", lnFiles ? lnFiles[i] : ""]; });
   P.combination = ImageIntegration.Average;
   P.weightMode = ImageIntegration.PSFSignalWeight;
   P.normalization = lnFiles ? ImageIntegration.LocalNormalization : ImageIntegration.AdditiveWithScaling;
   P.rejection = ImageIntegration.Rejection_ESD;
   P.rejectionNormalization = lnFiles ? ImageIntegration.LocalRejectionNormalization : ImageIntegration.Scale;
   P.largeScaleClipHigh = true;
   P.generateRejectionMaps = true;
   P.subtractPedestals = false;
   P.showImages = true;
   if (!P.executeGlobal()) throw new Error("ImageIntegration falló");
   var w = ImageWindow.windowById(P.integrationImageId);
   w.saveAs(outPath, false, false, false, false);
   var info = "noise " + [P.finalNoiseEstimateRK, P.finalNoiseEstimateG, P.finalNoiseEstimateB].map(function (x) { return x.toExponential(3); }).join("/") +
              " n=" + P.numberOfImages;
   ["lowRejectionMapImageId", "highRejectionMapImageId"].forEach(function (k) {
      var r = ImageWindow.windowById(P[k]);
      if (!r.isNull) { r.saveAs(outPath.replace(".xisf", "_" + k.substr(0, 4) + "rej.xisf"), false, false, false, false); r.forceClose(); }
   });
   return info;
}

// Medidas por sub (debayerizados): CSV con FWHM (″), excentricidad, PSF signal weight, mediana, ruido, estrellas.
function measure(files, csvPath) {
   var P = new SubframeSelector;
   P.routine = SubframeSelector.MeasureSubframes;
   P.nonInteractive = true;
   P.subframes = files.map(function (f) { return [true, f, "", ""]; });
   P.subframeScale = 1.523;
   P.cameraGain = 1.0;
   P.scaleUnit = SubframeSelector.ArcSeconds;
   P.dataUnit = SubframeSelector.Normalized;
   if (!P.executeGlobal()) throw new Error("SubframeSelector falló");
   var m = P.measurements, lines = ["file,FWHM,ecc,psfsw,snrw,median,noise,stars"];
   for (var i = 0; i < m.length; ++i) {
      var r = m[i];
      lines.push([File.extractName(r[3]), r[5].toFixed(3), r[6].toFixed(3), r[7].toExponential(4), r[9].toExponential(4),
                  r[10].toExponential(4), r[12].toExponential(4), r[14]].join(","));
   }
   File.writeTextFile(csvPath, lines.join("\n") + "\n");
   return m.length;
}
