/**
 * This is "the brain" of the animation. It manages all parts of the 
 * animation configuration and workflows.
 */
var queryState = require('query-state');
var pixChart = require('./pixchart/index');
var config = require('./config.js');
var makeStats = require('./lib/makeStats');
var createFileDropHandler = require('./lib/fileDrop');
var formatNumber = require('./lib/formatNumber');
var bus = require('./bus');

var DEFAULT_ANIMATION_DURATION = 2.0; // in seconds, because visible to users
var DEFAULT_BUCKET_COUNT = 510;
var PAUSE_BETWEEN_CYCLES = 1000; // in milliseconds, because for developers

var qs = queryState({
  d: DEFAULT_ANIMATION_DURATION
}, {useSearch: true});

module.exports = initScene;

function initScene(canvas) {
  var currentPixChart;
  var cleanErrorClass = false;
  var progressElement = document.getElementById('progress');
  var queue = [];
  var lastIndex = 0;
  var pendingTimeout;

  var url = qs.get('link')

  if (url) {
    queue = [url];
    pendingTimeout = setTimeout(processNextInQueue, 0);
  }

  listenToEvents();

  var dropHandler = createFileDropHandler(document.body, handleDroppedFiles);

  // This is the state of the application - primary interaction point between Vue <-> WebGL
  var state = {
    // State consists of two parts.

    // # Part 1 - Data
    image: url,
    // We don't want to overwhelm people with options
    // when they are browsing from mobile, so we close side bar on small screens
    sidebarOpen: !config.isSmallScreen(),
    duration: DEFAULT_ANIMATION_DURATION, 
    bucketCount: getSafeBucketCount(qs.get('bc')),
    maxPixels: Math.min(window.innerWidth * window.innerHeight , 640 * 640) * window.devicePixelRatio,
    currentColorGroupBy: getSafeColorGroupBy(qs.get('groupBy')), 
    initialImageState: getSafeInitialState(qs.get('initial')),
    paused: false,
    isFirstRun: queue.length === 0,

    /**
     * Requests to update scene dimensions.
     */
    updateSize,

    /**
     * Destroy scene and release all resources.
     */
    dispose,
    
    /**
     * Sets queue of images to play
     */
    setImages,

    /**
     * Sets duration of single animation step (expand or collapse)
     */
    setAnimationDuration,

    /**
     * Sets how many buckets should we use in the histogram.
     */
    setBucketCount,

    /**
     * Sets maximum allowed amount of pixels.
     */
    setMaxPixels,

    /**
     * Sets grouping method (rgb.r, hsv.h, etc.)
     */
    setColorGroupBy,

    /**
     * Sets how scene should be rendered when ready. 
     */
    setInitialState,

    ignoreColor, // WIP
    getStatistics,// WIP
  };

  setAnimationDuration(qs.get('d'));

  // Yeah, this is not very good. But hey - this is a toy project. Adding abstraction
  // layers isn't always good.
  window.sceneState = state;

  return; // We are done with public part.

  function ignoreColor(c) {
    if (currentPixChart) {
      currentPixChart.ignoreColor(c);
    }
  }

  function getStatistics() {
    if (currentPixChart) {
      var buckets = currentPixChart.getBuckets();
      return makeStats(buckets);
    }
  }

  function setInitialState(newInitialState) {
    state.initialImageState = newInitialState;
    qs.set('initial', newInitialState);

    restartCurrentAnimation();
  }

  function getSafeInitialState(plainInput) {
    if (plainInput === 'expanded') return plainInput
    return 'collapsed';
  }

  function getSafeColorGroupBy(plainInput) {
    return plainInput || 'hsl.l';
  }

  function getSafeBucketCount(plainInput) {
    var parsedValue = Number.parseInt(plainInput, 10);
    if (Number.isNaN(parsedValue) || parsedValue < 1) return DEFAULT_BUCKET_COUNT;

    return parsedValue;
  }

  function setColorGroupBy(groupBy) {
    var safeGroupBy = getSafeColorGroupBy(groupBy); 
    state.currentColorGroupBy = safeGroupBy;
    qs.set('groupBy', state.currentColorGroupBy);

    restartCurrentAnimation();
  }

  function restartCurrentAnimation() {
    if (!queue.length) return;

    // TODO: Validate?
    lastIndex -= 1;
    if (lastIndex < 0) lastIndex = queue.length - 1;
    processNextInQueue(/* forceDispose = */true);
  }

  function handlePaste(e){
    var items = e.clipboardData.items;
    var files = [];
    for(var i = 0; i < items.length; ++i) {
      var file = items[i];
      if (file.kind === 'file') files.push(file.getAsFile());
    }

    if (files.length > 0) e.preventDefault();

    handleDroppedFiles(files);
  }

  function handleDroppedFiles(files) {
    var images = files.filter(isImage)
    if (images.length > 0) {
      setImages(images);
    }
  }

  function isImage(file) {
    return file && file.type && file.type.indexOf('image/') === 0;
  }

  function listenToEvents() {
    window.addEventListener('paste', handlePaste, false);
    window.addEventListener('resize', updateSize);
    canvas.addEventListener('click', onCanvasClick);
    document.body.addEventListener('keydown', onKeyDown);
    bus.on('theme-changed', updateTheme);
  }

  function dispose() {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = 0;
    }
    window.removeEventListener('resize', updateSize);
    window.removeEventListener('paste', handlePaste, false);
    canvas.removeEventListener('click', onCanvasClick);
    document.body.removeEventListener('keydown', onKeyDown);
    bus.off('theme-changed', updateTheme)

    dropHandler.dispose();

    currentPixChart.dispose();
    currentPixChart = null;
  }

  function onKeyDown(e) {
    if (e.target !== document.body) return; // don't care
    console.log(e.which);

    if (e.which === 32) { // SPACEBAR
      togglePaused({
        clientX: window.innerWidth/2,
        clientY: window.innerHeight/2,
      });
    } else if (e.which === 39 || e.which === 76) { // right arrow or `l` key (hello vim)
      processNextInQueue(true);
    } else if (e.which === 37 || e.which === 72){
      processPrevInQueue(true);
    }
  }

  function onCanvasClick(e) {
    if (currentPixChart) {
      e.preventDefault();
      e.stopPropagation();
      
      togglePaused(e);
    }
  }


  function togglePaused(e) {
    state.paused = currentPixChart.togglePaused();
    if (state.paused) {
      clearTimeout(pendingTimeout);
    }
    bus.fire('pause-changed', state.paused, {
      x: e.clientX,
      y: e.clientY
    });
  }
  function updateSize() {
    if (currentPixChart) {
      var sideBarWidthOffset = (!state.sidebarOpen || config.isSmallScreen ()) ? 0: config.sidebarWidth;
      var sideBarHeightOffset = config.isSmallScreen() ? config.sidebarHeight : 0;
      currentPixChart.setSceneSize(window.innerWidth - sideBarWidthOffset, window.innerHeight - sideBarHeightOffset);
    }
  }

  function updateTheme(newTheme) {
    qs.set('theme', newTheme);
  }

  function showLoadingProgress(progress) {
    if (progress.step === 'pixels') {
      progressElement.innerText = 'Processed ' + formatNumber(progress.current) + ' pixels out of ' + formatNumber(progress.total);
    } else if (progress.step === 'done') {
      progressElement.style.opacity = '0';
      if (progress.imageObject.isUrl) {
        // other objects cannot be shared
        qs.set('link', progress.imageObject.name)
        state.image = progress.imageObject.name;
      } else {
        qs.set('link', '')
      }
      bus.fire('image-loaded');
    } else if (progress.step === 'error') {
      progressElement.classList.add('error');
      cleanErrorClass = true;
      progressElement.innerHTML = 'Could not load image :(. <br /> Try uploading it to <a href="https://imgur.com" target="_blank">imgur.com</a>?'
      if (queue.length > 1) {
        pendingTimeout = setTimeout(processNextInQueue, 500);
      }
    } 

    if (cleanErrorClass && progress.step !== 'error') {
      // Just so that we are not doing this too often
      cleanErrorClass = false;
      progressElement.classList.remove('error');
    }
  }

  function setImage(imageLink, forceDispose) {
    if (currentPixChart && imageLink === currentPixChart.imageLink && !forceDispose) {
      currentPixChart.restartCycle()
      return;
    }

    if (currentPixChart) {
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = 0;
      } 

      currentPixChart.dispose();
      pendingTimeout = setTimeout(() => {
        createPixChart(imageLink)
        pendingTimeout = 0;
      }, 250); // Give small time for fade animation to finish.
    } else {
      createPixChart(imageLink);
    }
  }

  function createPixChart(imageLink) {
    progressElement.innerText = 'Loading image...';
    progressElement.style.opacity = '1';

    currentPixChart = pixChart(imageLink, {
      canvas,
      colorGroupBy: state.currentColorGroupBy,
      scaleImage: true,
      bucketCount: state.bucketCount,
      collapsed: state.initialImageState === 'collapsed',
      maxPixels: state.maxPixels,
      framesCount: toFrames(state.duration),
    });

    currentPixChart.on('cycle-complete', () => {
      pendingTimeout = setTimeout(processNextInQueue, PAUSE_BETWEEN_CYCLES);
    });
    currentPixChart.on('loading-progress', showLoadingProgress);
    currentPixChart.on('frame', notifyFrame);
  }

  function notifyFrame(t) {
    bus.fire('animation-frame', t);
  }

  function setImages(files) {
    state.isFirstRun = false;
    if (files.length === 0) return;
    // TODO: Queued images are not visible anywhere.
    //  Might need to improve UX around this area
    queue = files;
    lastIndex = 0;

    processNextInQueue();
  }

  function setAnimationDuration(newCount) {
    var seconds = Number.parseFloat(newCount)
    if (Number.isNaN(seconds)) return;

    qs.set('d', seconds);
    state.duration = seconds;
    if (currentPixChart) {
      currentPixChart.setFramesCount(toFrames(seconds));
    }
  }

  function setBucketCount(newCount) {
    var bucketCount = Number.parseInt(newCount, 10);
    if (Number.isNaN(bucketCount) || bucketCount < 1) return;

    qs.set('bc', bucketCount);
    state.bucketCount = bucketCount;
    if (currentPixChart) {
      restartCurrentAnimation();
    }
  }

  function setMaxPixels(newCount) {
    var maxPixels = Number.parseInt(newCount, 10)
    if (Number.isNaN(maxPixels)) return;

    state.maxPixels = maxPixels;

    if (currentPixChart) {
      progressElement.style.innerText = 'Updating particles...';
      progressElement.style.opacity = '1';
      currentPixChart.setMaxPixels(maxPixels);
    }
  }

  function processPrevInQueue(forceDispose) {
    if (queue.length === 0) return;

    lastIndex -= 2;
    if (lastIndex < 0) lastIndex = queue.length - 1;
    processNextInQueue(forceDispose);
  }

  function processNextInQueue(forceDispose) {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = 0;
    }

    var img = queue[lastIndex]
    lastIndex += 1;
    if (lastIndex >= queue.length) lastIndex = 0;

    setImage(img, forceDispose)
  }
}

function toFrames(seconds) {
  return seconds * 60; // Assuming 60 fps.
}
