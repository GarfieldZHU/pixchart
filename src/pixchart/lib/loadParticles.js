// var chroma = require('chroma-js')
var {rgbToHsl} = require('./colors');
var random = require('ngraph.random')(42);

module.exports = loadParticles;

function loadParticles(image, options) {
  if (!options) throw new Error('Options required');

  var actualResolve;
  var {onProgress} = options;

  var initIntervals = 0;

  console.time('init stats');

  var cnv = document.createElement('canvas');
  var width = cnv.width = image.width, height = cnv.height = image.height;
  var n = width * height;

  var bucketsCount = n; // TODO: Customize?

  var maxYValue = 0;  
  
  var ctx = cnv.getContext('2d');
  ctx.drawImage(image, 0, 0, image.width, image.height); 

  var pixels = ctx.getImageData(0, 0, width, height).data;
  var idx = 0;
  var minFrameSpan = Number.POSITIVE_INFINITY, maxFrameSpan = Number.NEGATIVE_INFINITY;

  // each pixel is mapped to height inside its bucket;
  var particleAttributes = new Float32Array(4 * n);

  // this is a temporary tracker of taken spots inside a bucket
  var bucketColors = new Uint32Array(bucketsCount);

  console.timeEnd('init stats');
  
  console.time('initParticles');
  scheduleWork();
  
  return new Promise((resolve) => { actualResolve = resolve; });
  // TODO: Should be customizable.
  function getValue(r, g, b) {
    return rgbToHsl(r, g, b)[2];
    //return chroma(r, g, b).get('hsl.l');
  }
  
  function scheduleWork() {
    if (options.isCancelled) return;

    initIntervals += 1;
    if (initIntervals % 10 === 0) {
      onProgress(idx/4);
    }

    setTimeout(processPixels, 0);
  }
  
  function processPixels() {
    var start = performance.now(); 
    var currentYValue;
    var pixelsCount = 4 * n;
    while (idx < pixelsCount) { 
      var invIndex = pixelsCount - idx - 4;
      var r = pixels[invIndex + 0], g = pixels[invIndex + 1], b = pixels[invIndex + 2];

      var v = getValue(r, g, b);
      // v ranges from 0 to 1.
      var bucketNumber = Math.round(v * bucketsCount);

      if (bucketNumber === bucketsCount) {
        // prevent overflow
        bucketNumber -= 1;
      }

      currentYValue = bucketColors[bucketNumber] += 1;
      // assign this pixel to this height in the bucket
      // Note: if we want to be less jumpy during changes in particles count,
      // we can augment this code with previous particle configuration.
      var frameSpan = random.gaussian();

      particleAttributes[idx + 0] = v;
      particleAttributes[idx + 1] = currentYValue - 1;
      particleAttributes[idx + 2] = frameSpan;
      particleAttributes[idx + 3] = invIndex/4;

      if (frameSpan < minFrameSpan) minFrameSpan = frameSpan;
      if (frameSpan > maxFrameSpan) maxFrameSpan = frameSpan;

      // if (v <= 0.09) { 
      //   // TODO: Proper ignore logic here.
      //   particleAttributes[idx] = -1;
      // } else  
      if (currentYValue > maxYValue) maxYValue = currentYValue;

      idx += 4;
      if (performance.now() - start > 12) {
        scheduleWork();
        return;
      }  
    }
    
    console.timeEnd('initParticles');
    console.log('initialized in ' + initIntervals + ' intervals; Max Value:', maxYValue);
    
    actualResolve({
      minFrameSpan,
      maxFrameSpan,
      particleAttributes: particleAttributes,
      canvas: cnv,
      maxYValue: maxYValue
    })
  }
}