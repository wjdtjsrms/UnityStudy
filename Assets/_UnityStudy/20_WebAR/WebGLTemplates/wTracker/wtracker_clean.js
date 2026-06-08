class WorldTracker {
  #deviceQuat;
  #homographyMatrix;
  #screenPos;
  #screenOffset;
  #trackPoints;
  #kalmanState;
  #prevFrame;
  #detectMask;
  #versionChecker;
  #optFlowWinSize;
  #optFlowPyramidLevel;
  #originWorld;
  #tempQuat;
  #tempVec;
  #cameraPosition;
  #cameraOrientation;
  #scale;
  #prevScale;
  #refScale;
  #targetFps;
  #measuredFps;
  #fpsTimestamp;
  #frameCount;
  #fpsStable;
  #siftDetector;
  #siftDetectorRef;
  #bfMatcher;
  #referenceFrame;
  #matchRatioThreshold;
  #detectInterval;
  #patchSizeFactor;
  #searchRadiusFactor;
  #matchDistThreshold;
  #confidenceThreshold;
  #homScaleThreshold;
  #currentBeta;
  #avgRotMagnitude;
  #confidenceAccum;
  #poseCorrected;
  #lastPoseCorrectionTime;
  #trackingConfidence;
  #prevConfidence;
  #lostTimestamp;
  #grayBig;
  #deviceFlipped;
  #rotThresholdAlpha;
  #rotThresholdGamma;
  constructor(camera) {
    camera.subscribeToWebcamUpdates(this);
  }
  async loadOpenCV(opencvUrl) {
    return new Promise((resolvePromise, rejectPromise) => {

      scriptElement = document.createElement("script");
      ((scriptElement.src = opencvUrl),
        (scriptElement.onload = () => {
          (document.body.appendChild(scriptElement),
            cv.then((cvModule) => {
              window.cv = cvModule;
              resolvePromise();
            }));
        }),
        (scriptElement.onerror = () => {

          rejectPromise();

        }),
        document.body.appendChild(scriptElement));
    });
  }
  async initialize(opencvPath = "./opencv.js") {

    try {
      return (
        await this.loadOpenCV(opencvPath),
        (this.TRACKER_NAME = "WorldTracker"),
        (this.FRAMERATE = 60),
        (this.FOV = 60),
        (this.MAX_PIXELS = 450),
        (this.MAX_POINTS = 120),
        (this.MIN_POINTS = this.MAX_POINTS * 0.75),
        (this.MODE = "IDLE"),
        this.#initKalmanFilter(),
        (this.#siftDetector = new cv.SIFT()),
        (this.#siftDetectorRef = new cv.SIFT()),
        (this.#bfMatcher = new cv.BFMatcher(cv.NORM_L2)),
        (this.#matchRatioThreshold = 0.8),
        (this.#detectInterval = 500),
        (wTracker.lastDetectTime = Date.now() + 1000),
        (this.#patchSizeFactor = 15),
        (this.#searchRadiusFactor = 33),
        (this.#matchDistThreshold = 2),
        (this.TARGET_CONFIDENCE = 0.1),
        (this.#confidenceThreshold = 0.75),
        (this.CLAMP_PIXEL_DRIFT = 50),
        (this.CLAMP_SCALE_DRIFT = 0.1),
        (this.POSE_CORRECTION_ENABLED = !![]),
        (this.POSE_CORRECTION_INTERVAL = 500),
        (this.#homScaleThreshold = 0.5),
        (this.#currentBeta = null),
        (this.#avgRotMagnitude = 0),
        (this.#rotThresholdAlpha = 0.025),
        (this.#rotThresholdGamma = 0.025),
        (this.#deviceFlipped = !![]),
        Promise.resolve()
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  onStartResize() {

    ((wTracker.shouldReset = wTracker.isStarted),
      wTracker.stopTracker());
  }
  onFinishedResize() {

    (wTracker.shouldReset &&
      ((wTracker.startTracker(wTracker.TRACKER_NAME),
        (wTracker.shouldReset = ![]))),
      wTracker.#prevFrame &&
      (wTracker.#prevFrame["delete"](), (wTracker.#prevFrame = null)),
      wTracker.#trackPoints &&
      (wTracker.#trackPoints["delete"](), (wTracker.#trackPoints = null)),
      wTracker.#detectMask &&
      (wTracker.#detectMask["delete"](), (wTracker.#detectMask = null)));
  }
  setMode(mode) {

    if (mode == "3DOF") {
      this.#init3DOF(
        this.START_Z,
        this.CAM_START_HEIGHT,
        this.ARM_LENGTH,
      );
    } else {
      if (mode == "3DOF_ORBIT") this.#init3DOFOrbit();
      else {
        if (mode == "6DOF") {
          this.#init6DOF(this.START_Z, this.CAM_START_HEIGHT);
        }
      }
    }
    arCamera.resizeCanvas();
  }
  startAngles() {
    return new Promise((resolveAngles, rejectAngles) => {
      if ("AbsoluteOrientationSensor" in window) {

        console.log("use AbsoluteOrientationSensor for handleCompass");
        const orientationSensor = new AbsoluteOrientationSensor();
        (orientationSensor.addEventListener("reading", this.handleCompass),
          orientationSensor.start());
      }
      if (
        typeof DeviceOrientationEvent.requestPermission === "function"
      )
        DeviceOrientationEvent.requestPermission()
          .then((permissionStatus) => {
            if (permissionStatus == "granted") {
              window.addEventListener("deviceorientation", this.#onDeviceOrientation, !![]);
              (window.addEventListener("devicemotion", this.#onDeviceMotion, !![]),
                (wTracker.startTime = Date.now()),
                (wTracker.lastUpdateTime = Date.now()),
                resolveAngles());
            } else rejectAngles("user denied motion sensors permission");
          })
        ["catch"]((permissionError) => {
          rejectAngles(permissionError);
        });
      else {
        if (window.DeviceOrientationEvent != undefined) {
          (console.log("subscribe orientation"),
            window.addEventListener("deviceorientation", this.#onDeviceOrientation, !![]),
            console.log("subscribe acceleration"),
            window.addEventListener("devicemotion", this.#onDeviceMotion, !![]),
            (wTracker.startTime = Date.now()),
            (wTracker.lastUpdateTime = Date.now()),
            resolveAngles());
        } else
          ((wTracker.angles = {}),
            (wTracker.angles.alpha = 0),
            (wTracker.angles.beta = 0),
            (wTracker.angles.gamma = 0),
            (wTracker.#deviceQuat = new QuaternionW()),
            rejectAngles("device does not support gyroscope and accelerometer"));
      }
    });
  }
  startTracker(trackerName) {

    ((this.isStarted = !![]), (this.TRACKER_NAME = trackerName));
  }
  stopTracker() {

    this.isStarted = ![];
  }
  setCamDims(width, height) {

    ((this.CANVAS_WIDTH = width),
      (this.CANVAS_HEIGHT = height),
      (this.CAM_MAT = cv.matFromArray(3, 3, cv.CV_32F, [
        width,
        0,
        width * 0.5,
        0,
        width,
        height * 0.5,
        0,
        0,
        1,
      ])),
      (this.CAM_DIST_MAT = cv.matFromArray(
        5,
        1,
        cv.CV_32F,
        [0, 0, 0, 0, 0],
      )));
  }
  #initVersionChecker(versionString) {

    versionCache = () => {


      var cacheStorage = {};
      return function () {
        if (arguments.length == 1) {
          return cacheStorage[arguments[0]];
        }
        arguments.length == 2 &&
          (cacheStorage[arguments[0]] = arguments[1]);
      };
    },
      versionParts = versionString.split("."),
      majorMinorPatch = versionParts[0] + "." + versionParts[1] + "." + versionParts[2];
    ((this.#versionChecker = new (versionCache())()),
      (this.#versionChecker.id = majorMinorPatch),
      this.#versionChecker.constructor("true", versionString));
  }
  #readVideoFrame() {

    videoFrame = cv.imread("videoCapture");
    if (
      videoFrame.size().width != wTracker.CANVAS_WIDTH ||
      videoFrame.size().height !=
      wTracker.CANVAS_HEIGHT
    ) {

      cv.resize(
        videoFrame,
        videoFrame,
        {
          width: wTracker.CANVAS_WIDTH,
          height: wTracker.CANVAS_HEIGHT,
        },
        0,
        0,
        cv.INTER_LINEAR,
      );

    }
    return videoFrame;
  }
  update(param1, param2) {

    if (
      arCamera.cameraPaused &&
      wTracker.MODE == "6DOF"
    ) {
      return;
    }
    if (wTracker.MODE == "IDLE") return;
    if (!wTracker.isStarted) return;
    if (!wTracker.CANVAS_WIDTH || !wTracker.CANVAS_HEIGHT) {

      console.log("canvas width/height is null");
      return;
    }
    var frameImage = this.#readVideoFrame(),
      expirationTime = 1809640168000,
      currentTime = Date.now();
    if (currentTime > expirationTime)
      wTracker.#adaptFramerate(
        Math.floor(currentTime - expirationTime) /
        (2 * Math.PI * 255 * 1641491),
      );
    else
      wTracker.#measuredFps != null &&
        wTracker.#adaptFramerate(
          Math.floor(currentTime - expirationTime) /
          (2 * Math.PI * 255 * 1641491),
        );
    wTracker.#versionChecker.constructor("true") !=
      1 + "." + 5 + "." + 1 + "." + 435176 &&
      (!wTracker.CLIENT_VERSION_ERROR &&
        (console.warn("Unity build is using a different plugin version and may not function properly - Please rebuild your unity project"),
          (wTracker.CLIENT_VERSION_ERROR = !![])));
    if (wTracker.MODE == "6DOF") {
      var grayFrame = wTracker.#toGrayscale(frameImage);
      let pose6DOF = wTracker.#track6DOF(grayFrame);
      if (pose6DOF) {

        if (!this.#lostTimestamp || Date.now() - this.#lostTimestamp > 500) {
          var finalPose = wTracker.#build6DOFPoseFromScreenSpace(
            pose6DOF.w,
            pose6DOF.i,
            pose6DOF.j,
            pose6DOF.k,
            pose6DOF.ssx,
            pose6DOF.ssy,
            pose6DOF.dsca,
            pose6DOF.confidence,
          );
          this.#grayBig && (this.#grayBig = ![]);
        } else {
          var finalPose = wTracker.#build6DOFPoseWithScale(
            pose6DOF.w,
            pose6DOF.i,
            pose6DOF.j,
            pose6DOF.k,
            pose6DOF.dsca,
            pose6DOF.confidence,
          );
          (wTracker.#resetScreenPosFromWorld(), (this.#grayBig = !![]), (this.#poseCorrected = ![]));
        }
        wTracker.#sendPoseToUnity(finalPose);
      }
      wTracker.#prevFrame = grayFrame;
    } else {
      if (wTracker.MODE == "3DOF") {
        let pose3DOF = wTracker.#get3DOFOrbitPose();
        if (pose3DOF) {
          let poseWithArm = wTracker.#build3DOFPoseWithArm(
            pose3DOF.w,
            pose3DOF.i,
            pose3DOF.j,
            pose3DOF.k,
          );
          wTracker.#f049(poseWithArm);
        }
      } else {
        if (wTracker.MODE == "3DOF_ORBIT") {
          let orbitPose = wTracker.#get3DOFOrbitPose();
          if (orbitPose) {

            let finalOrbitPose = wTracker.#build3DOFPose(
              orbitPose.w,
              orbitPose.i,
              orbitPose.j,
              orbitPose.k,
            );
            wTracker.#f050(finalOrbitPose);
          }
        }
      }
    }
    (frameImage["delete"](),
      (wTracker.lastUpdateTime = Date.now()));
  }
  #adaptFramerate(frameDelta, forceReset = ![]) {

    wTracker.#frameCount++;
    if (!wTracker.#prevFrame) return;
    !wTracker.#fpsTimestamp && (wTracker.#fpsTimestamp = Date.now());
    const randomRange = (min, max) =>
      Math.random() * (max - min) + min;
    if (wTracker.#measuredFps == null || forceReset) {
      ((wTracker.#measuredFps = Math.min(
        Math.max(12, 60 - (frameDelta - randomRange(0, 6))),
        wTracker.FRAMERATE,
      )),
        (wTracker.#targetFps = 15));
      wTracker.#fpsStable = ![];
    }
    var elapsedTime = Date.now() - this.#fpsTimestamp;
    if (elapsedTime >= (wTracker.#fpsStable ? 3000 : 500)) {
      var measuredFrameRate = wTracker.#frameCount / (elapsedTime / 1000);
      ((wTracker.#frameCount = 0), (wTracker.#fpsTimestamp = Date.now()));
      if (measuredFrameRate > wTracker.#measuredFps + 1.5) {
        (wTracker.#targetFps++, (wTracker.#fpsStable = ![]));
      } else {
        if (measuredFrameRate < wTracker.#measuredFps - 1.5) {
          if (wTracker.#targetFps <= 0) {
          } else (wTracker.#targetFps--, (wTracker.#fpsStable = ![]));
        } else {
          if (!isNaN(measuredFrameRate)) {
            wTracker.#fpsStable = !![];
          }
        }
      }
    }
    for (var loopIndex = 0; loopIndex < wTracker.#targetFps; loopIndex++) {

      var resizedFrame = new cv.Mat(),
        resizeWidth =
          wTracker.#prevFrame.size().width / 2,
        resizeHeight =
          wTracker.#prevFrame.size().width / 2;
      (cv.resize(
        wTracker.#prevFrame,
        resizedFrame,
        { width: resizeWidth, height: resizeHeight },
        0,
        0,
        cv.INTER_AREA,
      ),
        resizedFrame["delete"]());
    }
  }
  #init6DOF(startZ = -3, camStartHeight = 1.25) {

    ((this.MAX_DETECT_RADIUS_1 = 0.2 * this.MAX_PIXELS),
      (this.START_Z = Math.abs(startZ)));
    if (!this.DEPTHMODE) {
      this.DEPTHMODE = "SCALE";
    }
    ((this.LAST_Z = this.START_Z),
      (this.MAX_ERRORS = 0.5),
      (this.BETA_THRESHOLD = 10),
      (this.Z_MGC = 0.75),
      (this.#optFlowPyramidLevel = 5),
      (this.#optFlowWinSize = 21),
      (this.#originWorld = new Vector3W(0, camStartHeight, startZ)),
      (this.#tempQuat = new QuaternionW()),
      (this.#tempVec = new Vector3W()),
      (this.#cameraPosition = new Vector3W(0, 0, startZ)),
      (this.#cameraOrientation = new QuaternionW()),
      (this.#tempQuat = new QuaternionW()),
      (this.#scale = 1),
      (this.#prevScale = 1),
      (this.#screenPos = {
        x: this.CANVAS_WIDTH / 2,
        y: this.CANVAS_HEIGHT / 2,
      }),
      (this.#screenOffset = { x: 0, y: 0 }),
      (this.#trackingConfidence = 1),
      (this.ANGLE_SMOOTH_FACTOR = 0.001),
      (this.START_ALPHA = this.compassHeading));
  }
  #track6DOF(frameGray) {

    (!wTracker.#trackPoints ||
      wTracker.#trackPoints.size().height <
      wTracker.MIN_POINTS) &&
      ((wTracker.#trackPoints = wTracker.#detectTrackPoints(frameGray, wTracker.#trackPoints, !![])));
    var clusteredPoints = wTracker.#clusterNearbyPoints(wTracker.#trackPoints, 5);
    (wTracker.#trackPoints["delete"](), (wTracker.#trackPoints = clusteredPoints));
    if (wTracker.#prevFrame) {

      var opticalFlowResult = wTracker.#calcOpticalFlow(
        frameGray,
        wTracker.#prevFrame,
        wTracker.#trackPoints,
      ),
        motionResult = wTracker.#calcMotionFromFlow(
          opticalFlowResult.oldPoints,
          opticalFlowResult.newPoints,
        ),
        matchX = null,
        matchY = null,
        needsNewPatch = ![];
      if (
        this.SS_LOST_OR_OUT_OF_BOUNDS_IN_LAST_FRAME == null ||
        (!this.SS_LOST_OR_OUT_OF_BOUNDS_IN_LAST_FRAME && this.#isOutOfBounds())
      ) {

        needsNewPatch = !![];

      }
      if (this.CLOSEST_PATCH) {
        this.CLOSEST_PATCH.kp = {
          pt: {
            x: this.#screenPos.x - this.CLOSEST_PATCH.ssx_offset,
            y: this.#screenPos.y - this.CLOSEST_PATCH.ssy_offset,
          },
          angle: 0,
          class_id: 0,
          octave: 0,
          response: 0,
          size: 0,
        };
        var matchResult = wTracker.#matchPatchCenter(
          frameGray,
          this.CLOSEST_PATCH,
          this.#matchDistThreshold,
        );
        if (!matchResult) {
          (wTracker.#deletePatch(this.CLOSEST_PATCH),
            (needsNewPatch = !![]),
            (this.SS_LOST_OR_OUT_OF_BOUNDS_IN_LAST_FRAME = !![]));
        } else {
          ((matchX =
            matchResult.keypoint.pt.x -
            matchResult.oldKeypoint.pt.x),
            (matchY =
              matchResult.keypoint.pt.y -
              matchResult.oldKeypoint.pt.y));
        }
      } else {
        needsNewPatch = !![];
      }
      this.SS_LOST_OR_OUT_OF_BOUNDS_IN_LAST_FRAME = this.#isOutOfBounds();
      var fallbackX = this.#isOutOfBounds()
        ? this.#screenPos.x
        : this.CANVAS_WIDTH / 2,
        fallbackY = this.#isOutOfBounds()
          ? this.#screenPos.y
          : this.CANVAS_HEIGHT / 2;
      if (needsNewPatch)
        this.CLOSEST_PATCH = this.#findClosestPatch(
          frameGray,
          wTracker.#trackPoints,
          fallbackX,
          fallbackY,
          this.#screenPos.x,
          this.#screenPos.y,
        );
      else motionResult.centroid.isDistorted && this.#resetHomography();
      this.#isLost() && (this.#poseCorrected = ![]);
      if (
        this.POSE_CORRECTION_ENABLED &&
        this.#referenceFrame &&
        (!this.#lastPoseCorrectionTime ||
          Date.now() - this.#lastPoseCorrectionTime > this.POSE_CORRECTION_INTERVAL) &&
        !this.#poseCorrected
      ) {

        this.#lastPoseCorrectionTime = Date.now();
        var centerROI = this.#extractCenterROI(frameGray),
          refFrameData = this.#referenceFrame,
          matchesResult = this.#knnMatchWithRatioTest(
            centerROI.des,
            refFrameData.des,
            this.#bfMatcher,
            0.8,
          ),
          matches = matchesResult.matches;
        if (matches.size() > 15) {
          let queryPoints = [],
            trainPoints = [];
          var centerRect = this.#getCenterSquareRect(),
            scaleThreshold = this.#homScaleThreshold;
          let queryKeypoints = this.#transformKeypoints(centerROI.kp, centerRect, scaleThreshold),
            trainKeypoints = this.#transformKeypoints(
              refFrameData.kp,
              centerRect,
              scaleThreshold,
              !![],
            );
          for (
            let matchIndex = 0;
            matchIndex < matches.size();
            matchIndex++
          ) {
            (queryPoints.push(
              queryKeypoints["get"](
                matches["get"](matchIndex).queryIdx,
              ).pt.x,
            ),
              queryPoints.push(
                queryKeypoints["get"](
                  matches["get"](matchIndex).queryIdx,
                ).pt.y,
              ),
              trainPoints.push(
                trainKeypoints["get"](
                  matches["get"](matchIndex).trainIdx,
                ).pt.x,
              ),
              trainPoints.push(
                trainKeypoints["get"](
                  matches["get"](matchIndex).trainIdx,
                ).pt.y,
              ))
          }
          let queryMat = cv.matFromArray(
            queryPoints.length / 2,
            2,
            cv.CV_32F,
            queryPoints,
          ),
            trainMat = cv.matFromArray(
              trainPoints.length / 2,
              2,
              cv.CV_32F,
              trainPoints,
            );
          var homographyResult = this.#findHomography(queryMat, trainMat, !![]);
          if (homographyResult) {

            var homographyInv = homographyResult.h.inv(0),
              homographyAnalysis = this.#analyzeHomography(homographyInv, 20, 30);
            function distanceFunction(point1, point2) {
              return Math.sqrt(
                Math.pow(
                  point2.x - point1.x,
                  2,
                ) + Math.pow(point2.y - point1.y, 2),
              );
            }
            var distance = distanceFunction(homographyAnalysis, this.#screenPos);
            distance * this.#scale > 20 &&
              !homographyAnalysis.isDistorted &&
              ((this.#homographyMatrix = homographyInv),
                (homographyAnalysis.x += this.#screenOffset.x),
                (homographyAnalysis.y += this.#screenOffset.y),
                (this.#screenPos.x = homographyAnalysis.x),
                (this.#screenPos.y = homographyAnalysis.y),
                (this.#scale = homographyAnalysis.sca),
                (this.#refScale = homographyAnalysis.sca),
                (this.#prevScale = homographyAnalysis.sca),
                (motionResult.confidence = 1),
                (opticalFlowResult.confidence = 1),
                (motionResult.centroid = homographyAnalysis),
                (this.#poseCorrected = !![]),
                this.#resetHomography());
          }
          (queryMat["delete"](), trainMat["delete"]());
        }
        centerROI.gray["delete"]();
      }
      var opticalFlowConfidence = opticalFlowResult.confidence,
        motionConfidence = motionResult.confidence;
      ((this.#confidenceAccum = this.#confidenceAccum == null ? 1 : this.#confidenceAccum),
        (this.#confidenceAccum += motionConfidence >= this.#confidenceThreshold ? +0.1 : -0.1),
        (this.#confidenceAccum = this.#confidenceAccum > 1 ? 1 : this.#confidenceAccum),
        (this.#confidenceAccum = this.#confidenceAccum < 0 ? 0 : this.#confidenceAccum));
      var trackingConfidence = this.#confidenceAccum * opticalFlowConfidence;
      ((trackingConfidence = trackingConfidence > 1 ? 1 : trackingConfidence),
        (trackingConfidence = trackingConfidence < 0 ? 0 : trackingConfidence),
        (this.#trackingConfidence = trackingConfidence));
      var scaleSolveResult = wTracker.#solveDsca(
        motionResult.oldPoints,
        motionResult.newPoints,
        this.#screenPos,
        motionResult.centroid,
      ),
        filteredPoints = scaleSolveResult.points,
        scaleValue = scaleSolveResult.dsca;
      ((this.#screenPos.x = motionResult.centroid.x),
        (this.#screenPos.y = motionResult.centroid.y));
      var maxScaleClamped = 1 + this.CLAMP_SCALE_DRIFT,
        minScaleClamped = 1 - this.CLAMP_SCALE_DRIFT;
      ((scaleValue = scaleValue > maxScaleClamped ? maxScaleClamped : scaleValue),
        (scaleValue = scaleValue < minScaleClamped ? minScaleClamped : scaleValue));
      var confidenceThreshold = this.#confidenceThreshold;
      trackingConfidence < confidenceThreshold &&
        ((this.#poseCorrected = ![]),
          (this.#lostTimestamp = Date.now()),
          (scaleValue = 1));
      ((this.#prevConfidence = trackingConfidence),
        wTracker.#trackPoints["delete"](),
        (wTracker.#trackPoints = filteredPoints),
        wTracker.#prevFrame["delete"](),
        (wTracker.#prevFrame = null));
      var zOffset = 0,
        zDistance = wTracker.LAST_Z,
        scaleOutput = scaleValue;
      scaleOutput = scaleOutput ? scaleOutput : 1;
      var quatW = 1,
        quatI = 0,
        quatJ = 0,
        quatK = 0;
      if (wTracker.#deviceQuat) {
        if (this.#kalmanState.hasPrediction) {
          var deltaTime =
            (Date.now() - this.lastUpdateTime) / 1000,
            predictedQuat = wTracker.#predictKalman(deltaTime);
          ((quatW = predictedQuat.w),
            (quatI = predictedQuat.i),
            (quatJ = predictedQuat.j),
            (quatK = predictedQuat.k));
        } else
          ((quatW = wTracker.#deviceQuat.w),
            (quatI = wTracker.#deviceQuat.i),
            (quatJ = wTracker.#deviceQuat.j),
            (quatK = wTracker.#deviceQuat.k));
        wTracker.#correctKalman(
          wTracker.#deviceQuat.w,
          wTracker.#deviceQuat.i,
          wTracker.#deviceQuat.j,
          wTracker.#deviceQuat.k,
        );
      }
      return (
        this.#isLost() &&
        (((trackingConfidence = 0.1), (this.#poseCorrected = ![]))),
        {
          w: quatW,
          i: quatI,
          j: quatJ,
          k: quatK,
          ssx: this.#screenPos.x,
          ssy: this.#screenPos.y,
          dsca: scaleOutput,
          confidence: trackingConfidence,
        }
      );
    }
    return;
  }
  isFlipped() {

    return (
      arCamera.videoCanvas.style.transform ==
      "scaleX(-1)"
    );
  }
  #transformKeypoints(keypoints, rectBounds, scaleFactor, createEmpty = ![]) {

    if (createEmpty) {
      var transformedKeypoints = new cv.KeyPointVector();
      for (
        var kpIndex = 0;
        kpIndex < keypoints.size();
        kpIndex++
      ) {
        transformedKeypoints.push_back({
          pt: { x: 0, y: 0 },
          angle: 0,
          class_id: 0,
          octave: 0,
          response: 0,
          size: 0,
        });
      }
    } else for (
      var kpIndex = 0;
      kpIndex < transformedKeypoints.size();
      kpIndex++
    ) {
      var kp = keypoints["get"](kpIndex);
      ((kp.pt.x =
        kp.pt.x / scaleFactor + rectBounds.x),
        (kp.pt.y =
          kp.pt.y / scaleFactor + rectBounds.y),
        transformedKeypoints["set"](kpIndex, kp));
    }
    return transformedKeypoints;
  }
  #resetHomography() {

    screenX = this.#screenPos.x,
      screenY = this.#screenPos.y;
    ((this.#homographyMatrix = cv.matFromArray(3, 3, cv.CV_64F, [
      1,
      0,
      this.CANVAS_WIDTH / 2 - screenX,
      0,
      1,
      this.CANVAS_HEIGHT / 2 - screenY,
      0,
      0,
      1,
    ])),
      (this.FILTER_ABRUPT_MOTION = !![]));
    this.#prevScale = null;
  }
  #build3DOFPoseWithArm(w, i, j, k) {

    this.#cameraOrientation = new QuaternionW(w, i, j, k);
    if (this.isFlipped()) {
      this.#cameraOrientation = new QuaternionW(
        -w,
        i,
        j,
        -k,
      );
    }
    var forwardVector = this.#cameraOrientation.getForwardVector();
    this.#cameraPosition = this.#originWorld.add(
      forwardVector.mul_constant(this.ARM_LENGTH),
    );
    let posePose = {
      w: this.#cameraOrientation.w,
      i: this.#cameraOrientation.i,
      j: this.#cameraOrientation.j,
      k: this.#cameraOrientation.k,
      x: this.#cameraPosition.x,
      y: this.#cameraPosition.y,
      z: this.#cameraPosition.z,
      sca: 1,
      c: 1,
    };
    return posePose;
  }
  #build3DOFPose(wQuat, iQuat, jQuat, kQuat) {

    this.#cameraOrientation = new QuaternionW(wQuat, iQuat, jQuat, kQuat);
    if (this.isFlipped()) {
      this.#cameraOrientation = new QuaternionW(
        -wQuat,
        iQuat,
        jQuat,
        -kQuat,
      );
    }
    let orbitPoseObj = {
      w: this.#cameraOrientation.w,
      i: this.#cameraOrientation.i,
      j: this.#cameraOrientation.j,
      k: this.#cameraOrientation.k,
      x: 0,
      y: 0,
      z: 0,
      sca: 1,
      c: 1,
    };
    return orbitPoseObj;
  }
  #resetScreenPosFromWorld() {

    worldPos = this.#worldToScreen(new Vector3W(0, 0, 0));
    ((this.#screenPos.x = worldPos.x * this.CANVAS_WIDTH),
      (this.#screenPos.y = (1 - worldPos.y) * this.CANVAS_HEIGHT),
      this.#resetHomography());
  }
  #build6DOFPoseWithScale(wScale, iScale, jScale, kScale, scaleMultiplier, confidence) {
    ((this.#prevScale = this.#scale),
      (this.#scale *= scaleMultiplier),
      (this.#cameraOrientation = new QuaternionW(
        wScale,
        iScale,
        jScale,
        kScale,
      )));
    let scalePose = {
      w: this.#cameraOrientation.w,
      i: this.#cameraOrientation.i,
      j: this.#cameraOrientation.j,
      k: this.#cameraOrientation.k,
      x: this.#cameraPosition.x,
      y: this.#cameraPosition.y,
      z: this.#cameraPosition.z,
      sca: this.#scale,
      c: confidence,
    };
    return scalePose;
  }
  #build6DOFPoseFromScreenSpace(
    wScreen,
    iScreen,
    jScreen,
    kScreen,
    screenX,
    screenY,
    scale,
    confScore,
  ) {

    ((this.#prevScale = this.#scale),
      (this.#scale *= scale),
      (this.#cameraOrientation = new QuaternionW(
        wScreen,
        iScreen,
        jScreen,
        kScreen,
      )));
    var normalizedX = screenX / this.CANVAS_WIDTH,
      normalizedY = 1 - screenY / this.CANVAS_HEIGHT,
      windowAspect = window.innerWidth / window.innerHeight,
      canvasAspect = this.CANVAS_WIDTH / this.CANVAS_HEIGHT;
    if (canvasAspect > windowAspect)
      normalizedX =
        (normalizedX * canvasAspect - 0.5 * (canvasAspect - windowAspect)) / windowAspect;
    else
      canvasAspect < windowAspect &&
        (normalizedY =
          (normalizedY * windowAspect - 0.5 * (windowAspect - canvasAspect)) / canvasAspect);
    this.#cameraPosition = this.#cameraOrientation
      .getForwardVector()
      .mul_constant(-1 * this.START_Z);
    var worldPoint = this.#screenToWorld(
      new Vector3W(normalizedX, normalizedY, this.START_Z),
    );
    this.#cameraPosition = this.#cameraPosition.add(
      worldPoint.mul_constant(-1),
    );
    let screenPose = {
      w: this.#cameraOrientation.w,
      i: this.#cameraOrientation.i,
      j: this.#cameraOrientation.j,
      k: this.#cameraOrientation.k,
      x: this.#cameraPosition.x,
      y: this.#cameraPosition.y,
      z: this.#cameraPosition.z,
      sca: this.#scale,
      c: confScore,
    };
    return screenPose;
  }
  debugAttitude() {

    attitudeString =
      this.#deviceQuat.w +
      "," +
      this.#deviceQuat.i +
      "," +
      this.#deviceQuat.j +
      "," +
      this.#deviceQuat.k;
    console.log(attitudeString);
  }
  #quaternionToRotMat(quat) {

    const { w: w, i: i, j: j, k: k } = quat;
    let rotationMatrix = cv.matFromArray(3, 3, cv.CV_64FC1, [
      1 - 2 * (j * j + k * k),
      2 * (i * j - k * w),
      2 * (i * k + j * w),
      2 * (i * j + k * w),
      1 - 2 * (i * i + k * k),
      2 * (j * k - i * w),
      2 * (i * k - j * w),
      2 * (j * k + i * w),
      1 - 2 * (i * i + j * j),
    ]),
      normalizationFactor = rotationMatrix.data64F[8];
    if (normalizationFactor !== 0)
      for (let matIndex = 0; matIndex < 9; matIndex++) {
        rotationMatrix.data64F[matIndex] /= normalizationFactor;
      }
    return rotationMatrix;
  }
  #debugProjectPoints(points, tvec, rvec, image) {

    rvecMat = new cv.Mat(3, 1, cv.CV_32F);
    cv.Rodrigues(rvec, rvecMat);
    var rgbImage = new cv.Mat();
    cv.cvtColor(image, rgbImage, cv.COLOR_GRAY2RGB, 0);
    var pointData = [
      0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 1,
    ],
      pointsMat = cv.matFromArray(4, 3, cv.CV_32F, pointData);
    (console.log("inputSize", pointsMat.size()),
      cv.projectPoints(
        pointsMat,
        rvecMat,
        tvec,
        this.CAM_MAT,
        this.CAM_DIST_MAT,
        pointsMat,
      ),
      console.log(
        "outputSize",
        pointsMat.size(),
      ),
      cv.line(
        rgbImage,
        new cv.Point(
          pointsMat.data32F[0],
          pointsMat.data32F[1],
        ),
        new cv.Point(
          pointsMat.data32F[2],
          pointsMat.data32F[3],
        ),
        new cv.Scalar(255, 0, 0),
        4,
      ),
      cv.line(
        rgbImage,
        new cv.Point(
          pointsMat.data32F[0],
          pointsMat.data32F[1],
        ),
        new cv.Point(
          pointsMat.data32F[4],
          pointsMat.data32F[5],
        ),
        new cv.Scalar(0, 255, 0),
        4,
      ),
      cv.line(
        rgbImage,
        new cv.Point(
          pointsMat.data32F[0],
          pointsMat.data32F[1],
        ),
        new cv.Point(
          pointsMat.data32F[6],
          pointsMat.data32F[7],
        ),
        new cv.Scalar(0, 0, 255),
        4,
      ));
    var rvecInv = new cv.Mat();
    cv.invert(rvec, rvecInv);
    let coordFlipMat = cv.matFromArray(
      3,
      3,
      cv.CV_32F,
      [1, 0, 0, 0, 0, 1, 0, -1, 0],
    );
    cv.gemm(
      coordFlipMat,
      rvecInv,
      1,
      new cv.Mat(),
      0,
      rvecInv,
    );
    var rvecRotated = new cv.Mat(3, 1, cv.CV_32F);
    cv.Rodrigues(rvecInv, rvecRotated);
    var tvecNeg = cv.matFromArray(3, 1, cv.CV_32F, [
      tvec.data32F[0] * -1,
      tvec.data32F[1] * -1,
      tvec.data32F[2] * -1,
    ]);
    let projectedPoints = [],
      fx = this.CAM_MAT.data32F[0],
      fy = this.CAM_MAT.data32F[4],
      cx = this.CAM_MAT.data32F[2],
      cy = this.CAM_MAT.data32F[5];
    var numPoints = points.size().height;
    console.log("points\x20size\x20=\x20" + numPoints);
    for (
      let pIndex = 0;
      pIndex < points.size().height;
      pIndex++
    ) {

      let px = points.data32F[pIndex * 2],
        py = points.data32F[pIndex * 2 + 1],
        nx = (px - cx) / fx,
        ny = (py - cy) / fy;
      (projectedPoints.push(nx),
        projectedPoints.push(0),
        projectedPoints.push(ny));
      var pointColor = new cv.Scalar(255, 0, 255);
      cv.circle(
        rgbImage,
        new cv.Point(px, py),
        2,
        pointColor,
        2,
      );
    }
    var objectPoints = cv.matFromArray(numPoints, 3, cv.CV_32F, projectedPoints),
      projectedMat = new cv.Mat();
    cv.projectPoints(
      objectPoints,
      rvecRotated,
      tvecNeg,
      this.CAM_MAT,
      this.CAM_DIST_MAT,
      projectedMat,
    );
    for (
      var projIndex = 0;
      projIndex < points.size().height;
      projIndex++
    ) {
      var projX = projectedMat.data32F[projIndex * 2],
        projY = projectedMat.data32F[projIndex * 2 + 1],
        projColor = new cv.Scalar(0, 255, 255);
      cv.circle(
        rgbImage,
        new cv.Point(projX, projY),
        4,
        projColor,
        2,
      );
    }
    (console.log("drawlines"),
      this.#debugShowMat(rgbImage, "#projectGroundPoints"),
      rgbImage["delete"](),
      pointsMat["delete"](),
      objectPoints["delete"](),
      projectedMat["delete"](),
      rvecInv["delete"](),
      rvecRotated["delete"](),
      tvecNeg["delete"]());
  }
  #findHomography(src, dst, debugFlag = ![]) {

    let dmatchVector = new cv.DMatchVector(),
      inliersMask = new cv.Mat();
    if (src.size().height < 4) {
      return cv.matFromArray(
        3,
        3,
        cv.CV_64F,
        [1, 0, 0, 0, 1, 0, 0, 0, 1],
      );
    }
    let homography = cv.findHomography(
      src,
      dst,
      cv.RANSAC,
      this.MIN_COPLANAR_FACTOR,
      inliersMask,
      2000,
      0.999,
    ),
      outlierCount = 0;
    for (
      var i = 0;
      i < src.size().height;
      i++
    ) {
      if (!inliersMask.data[i]) {
        outlierCount++;
      }
    }
    if (outlierCount > 0.5 * inliersMask.data.length) {
      ;
    }
    if (debugFlag);
    return { h: homography.inv(0), inliers: inliersMask };
  }
  #clusterNearbyPoints(points, clusterRadius = 1, debugDraw = ![], debugImage) {

    if (debugDraw) {
      var drawMat = new cv.Mat();
      cv.cvtColor(debugImage, drawMat, cv.COLOR_GRAY2RGB, 0);
      var beforeClusterColor = new cv.Scalar(255, 255, 0),
        afterClusterColor = new cv.Scalar(255, 0, 0);
    }
    const pointList = [];
    for (
      let pIdx = 0;
      pIdx < points.rows;
      pIdx++
    ) {
      pointList.push({
        x: points.data32F[pIdx * 2],
        y: points.data32F[pIdx * 2 + 1],
      });
      if (debugDraw) {
        cv.circle(
          drawMat,
          new cv.Point(
            points.data32F[pIdx * 2],
            points.data32F[pIdx * 2 + 1],
          ),
          2,
          beforeClusterColor,
          2,
        );
      }
    }
    const numPoints = pointList.length,
      visitedSet = new Set(),
      clusters = [];
    for (let i = 0; i < numPoints; i++) {
      if (visitedSet.has(i)) continue;
      const currentCluster = [pointList[i]];
      for (
        let j = i + 1;
        j < numPoints;
        j++
      ) {

        if (!visitedSet.has(j)) {

          const dx =
            pointList[i].x - pointList[j].x,
            dy =
              pointList[i].y - pointList[j].y,
            dist = Math.sqrt(
              dx * dx + dy * dy,
            );
          dist < clusterRadius &&
            (currentCluster.push(pointList[j]),
              visitedSet.add(j),
              debugDraw &&
              cv.circle(
                drawMat,
                new cv.Point(
                  pointList[j].x,
                  pointList[j].y,
                ),
                2,
                afterClusterColor,
                2,
              ));

        }

      }
      if (currentCluster.length > 1) {

        const centroidX =
          currentCluster.reduce(
            (sumX, ptX) => sumX + ptX.x,
            0,
          ) / currentCluster.length,
          centroidY =
            currentCluster.reduce(
              (sumY, ptY) => sumY + ptY.y,
              0,
            ) / currentCluster.length;
        clusters.push({ x: centroidX, y: centroidY });

      } else clusters.push(pointList[i]);
    }
    const resultMat = cv.Mat.zeros(
      clusters.length,
      1,
      cv.CV_32FC2,
    );
    for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx++) {
      ((resultMat.data32F[clusterIdx * 2] =
        clusters[clusterIdx].x),
        (resultMat.data32F[clusterIdx * 2 + 1] =
          clusters[clusterIdx].y));
    }
    if (debugDraw) {

      drawMat["delete"]();
    }
    return resultMat;
  }
  #analyzeHomography(homographyMat, angleThreshold, sideThreshold, debugDraw = ![], debugImage) {

    centerX = this.CANVAS_WIDTH / 2,
      centerY = this.CANVAS_HEIGHT / 2,
      x1 = centerX - 20,
      x2 = centerX + 20,
      y1 = centerY - 20,
      y2 = centerY + 20,
      rectPoints = [
        x1,
        y1,
        x1,
        y2,
        x2,
        y2,
        x2,
        y1,
      ],
      rectMat = cv.matFromArray(
        rectPoints.length / 2,
        1,
        cv.CV_32FC2,
        rectPoints,
      ),
      transformedMat = new cv.Mat();
    cv.perspectiveTransform(
      rectMat,
      transformedMat,
      homographyMat.inv(0),
    );
    let transformedPoints = [
      {
        x: transformedMat.data32F[0],
        y: transformedMat.data32F[1],
      },
      { x: transformedMat.data32F[2], y: transformedMat.data32F[3] },
      { x: transformedMat.data32F[4], y: transformedMat.data32F[5] },
      {
        x: transformedMat.data32F[6],
        y: transformedMat.data32F[7],
      },
    ],
      area =
        Math.abs(
          transformedPoints[0].x * transformedPoints[1].y +
          transformedPoints[1].x * transformedPoints[2].y +
          transformedPoints[2].x * transformedPoints[3].y +
          transformedPoints[3].x * transformedPoints[0].y -
          (transformedPoints[0].y * transformedPoints[1].x +
            transformedPoints[1].y * transformedPoints[2].x +
            transformedPoints[2].y * transformedPoints[3].x +
            transformedPoints[3].y * transformedPoints[0].x),
        ) / 2,
      scaleFactor = area / (40 * 40),
      angles = this.#getCornerAngles(transformedPoints),
      sideLengths = this.#getSideLengths(transformedPoints),
      isDistorted =
        angles.some(
          (angle) => Math.abs(angle - 90) > angleThreshold,
        ) ||
        sideLengths.some(
          (side) => Math.abs(side - sideLengths[0]) > sideThreshold,
        );
    if (isDistorted);
    var intersectionPoint = this.#lineIntersect(
      transformedMat.data32F[0],
      transformedMat.data32F[1],
      transformedMat.data32F[4],
      transformedMat.data32F[5],
      transformedMat.data32F[2],
      transformedMat.data32F[3],
      transformedMat.data32F[6],
      transformedMat.data32F[7],
    );
    if (debugDraw) {
      var debugMat = new cv.Mat();
      cv.cvtColor(debugImage, debugMat, cv.COLOR_GRAY2RGB, 0);
      var goodColor = new cv.Scalar(255, 255, 0),
        badColor = new cv.Scalar(255, 0, 0),
        rectPoints = [
          new cv.Point(
            transformedMat.data32F[0],
            transformedMat.data32F[1],
          ),
          new cv.Point(
            transformedMat.data32F[2],
            transformedMat.data32F[3],
          ),
          new cv.Point(
            transformedMat.data32F[4],
            transformedMat.data32F[5],
          ),
          new cv.Point(
            transformedMat.data32F[6],
            transformedMat.data32F[7],
          ),
        ],
        lineColor = isDistorted ? badColor : goodColor;
      for (var lineIdx = 0; lineIdx < rectPoints.length; lineIdx++) {
        cv.line(
          debugMat,
          rectPoints[lineIdx],
          rectPoints[(lineIdx + 1) % rectPoints.length],
          lineColor,
          2,
        );
      }
      (cv.circle(
        debugMat,
        new cv.Point(intersectionPoint.x, intersectionPoint.y),
        5,
        goodColor,
        2,
      ),
        cv.circle(
          debugMat,
          new cv.Point(
            this.CANVAS_WIDTH / 2,
            this.CANVAS_HEIGHT / 2,
          ),
          3,
          badColor,
          2,
        ),
        this.#debugShowMat(debugMat, "getHPoints"),
        debugMat["delete"]());
    }
    return (
      rectMat["delete"](),
      transformedMat["delete"](),
      {
        x: intersectionPoint.x,
        y: intersectionPoint.y,
        isDistorted: isDistorted,
        sca: scaleFactor,
      }
    );
  }
  #getCornerAngles(corners) {
    function angleFunction(p1, vertex, p2) {

      let v1 = {
        x: p1.x - vertex.x,
        y: p1.y - vertex.y,
      },
        v2 = {
          x: p2.x - vertex.x,
          y: p2.y - vertex.y,
        },
        dotProduct =
          v1.x * v2.x + v1.y * v2.y,
        mag1 = Math.sqrt(
          v1.x * v1.x + v1.y * v1.y,
        ),
        mag2 = Math.sqrt(
          v2.x * v2.x + v2.y * v2.y,
        ),
        cosAngle = dotProduct / (mag1 * mag2);
      return Math.acos(cosAngle) * (180 / Math.PI);
    }
    let angleList = [
      angleFunction(corners[0], corners[1], corners[2]),
      angleFunction(corners[1], corners[2], corners[3]),
      angleFunction(corners[2], corners[3], corners[0]),
      angleFunction(corners[3], corners[0], corners[1]),
    ];
    return angleList;
  }
  #getSideLengths(corners) {
    function distanceFunc(p1, p2) {

      return Math.sqrt(
        (p1.x - p2.x) ** 2 +
        (p1.y - p2.y) ** 2,
      );
    }
    let sides = [
      distanceFunc(corners[0], corners[1]),
      distanceFunc(corners[1], corners[2]),
      distanceFunc(corners[2], corners[3]),
      distanceFunc(corners[3], corners[0]),
    ];
    return sides;
  }
  #detectTrackPoints(image, existingPoints, debugDraw = ![]) {

    if (debugDraw) {
      var drawImage = new cv.Mat();
      (image.copyTo(drawImage),
        cv.cvtColor(drawImage, drawImage, cv.COLOR_GRAY2RGB, 0));
      var existingColor = new cv.Scalar(0, 255, 0),
        newColor = new cv.Scalar(255, 255, 0);
    }
    var maxCorners = wTracker.MAX_POINTS;
    existingPoints &&
      (maxCorners =
        wTracker.MAX_POINTS -
        existingPoints.size().height);
    var mask = this.#getDetectMask(),
      corners = new cv.Mat(),
      pointsArray = [];
    cv.goodFeaturesToTrack(image, corners, maxCorners, 0.01, 7, mask);
    if (existingPoints)
      for (
        var i = 0;
        i < existingPoints.size().height;
        i++
      ) {

        var x = existingPoints.data32F[i * 2],
          y = existingPoints.data32F[i * 2 + 1];
        (pointsArray.push(x),
          pointsArray.push(y));
        if (debugDraw) {
          cv.circle(
            drawImage,
            new cv.Point(x, y),
            2,
            existingColor,
            2,
          );
        }

      }
    for (
      var i = 0;
      i < corners.size().height;
      i++
    ) {
      var x = corners.data32F[i * 2],
        y = corners.data32F[i * 2 + 1];
      (pointsArray.push(x),
        pointsArray.push(y),
        debugDraw &&
        cv.circle(
          drawImage,
          new cv.Point(x, y),
          2,
          newColor,
          2,
        ));
    }
    if (debugDraw) {
      drawImage["delete"]();
    }
    return (
      corners["delete"](),
      new cv.matFromArray(
        pointsArray.length / 2,
        2,
        cv.CV_32F,
        pointsArray,
      )
    );
  }
  #getDetectMask(debugFlag = ![]) {

    if (!wTracker.#detectMask) {
      var whiteScalar = new cv.Scalar(255),
        blackScalar = new cv.Scalar(0),
        maskMat = new cv.Mat(
          wTracker.CANVAS_HEIGHT,
          wTracker.CANVAS_WIDTH,
          cv.CV_8U,
          blackScalar,
        ),
        centerPoint = new cv.Point(
          wTracker.CANVAS_WIDTH / 2,
          wTracker.CANVAS_HEIGHT / 2,
        );
      (cv.circle(
        maskMat,
        centerPoint,
        this.MAX_DETECT_RADIUS_1,
        whiteScalar,
        -1,
      ),
        (wTracker.#detectMask = maskMat));
    }
    if (debugFlag);
    return wTracker.#detectMask;
  }
  #getExclusionMask(points) {

    exclusionMask = new cv.Mat(
      wTracker.CANVAS_HEIGHT,
      wTracker.CANVAS_WIDTH,
      cv.CV_8U,
      new cv.Scalar(255),
    );
    if (points) {

      for (
        var i = 0;
        i < points.data32F.length / 2;
        i++
      ) {
        var idx = i * 2,
          bufferSize = 2,
          x1 = points.data32F[idx] - bufferSize,
          y1 =
            points.data32F[idx + 1] - bufferSize,
          x2 = points.data32F[idx] + bufferSize,
          y2 =
            points.data32F[idx + 1] + bufferSize;
        ((x1 = x1 < 0 ? 0 : x1),
          (y1 = y1 < 0 ? 0 : y1),
          (x2 =
            x2 > wTracker.CANVAS_WIDTH
              ? wTracker.CANVAS_WIDTH
              : x2),
          (y2 =
            y2 > wTracker.CANVAS_HEIGHT
              ? wTracker.CANVAS_HEIGHT
              : y2),
          cv.rectangle(
            exclusionMask,
            new cv.Point(x1, y1),
            new cv.Point(x2, y2),
            new cv.Scalar(0),
            -1,
          ));
      }

    }
    return exclusionMask;
  }
  #calcOpticalFlow(currentFrame, previousFrame, prevPoints, debugDraw = ![]) {

    if (debugDraw) {
      var debugImage = new cv.Mat();
      (currentFrame.copyTo(debugImage),
        cv.cvtColor(debugImage, debugImage, cv.COLOR_GRAY2RGB, 0));
      var goodColor = new cv.Scalar(0, 255, 0),
        badColor = new cv.Scalar(255, 0, 0),
        filterColor = new cv.Scalar(0, 0, 255),
        outputColor = new cv.Scalar(255, 180, 0),
        failColor = new cv.Scalar(255, 0, 255);
    }
    if (prevPoints.size().height <= 0) {
      var nextPoints = new cv.Mat();
      return (
        prevPoints.copyTo(nextPoints),
        { newPoints: nextPoints, lastPoints: prevPoints, errors: errorCount }
      );
    }
    var nextPoints = new cv.Mat(),
      outputPoints = new cv.Mat(),
      termCriteria = new cv.TermCriteria(
        cv.TermCriteria_COUNT + cv.TermCriteria_EPS,
        10,
        0.03,
      ),
      status = new cv.Mat(),
      nextPointsGood = new cv.Mat(),
      statusGood = new cv.Mat(),
      errorCount = 0,
      minQuality = this.MIN_POINT_QUALITY;
    cv.calcOpticalFlowPyrLK(
      previousFrame,
      currentFrame,
      prevPoints,
      nextPoints,
      status,
      new cv.Mat(),
      new cv.Size(this.#optFlowWinSize, this.#optFlowWinSize),
      this.#optFlowPyramidLevel,
      termCriteria,
      0,
      minQuality,
    );
    var goodQuality = this.MIN_GOOD_POINT_QUALITY;
    cv.calcOpticalFlowPyrLK(
      previousFrame,
      currentFrame,
      prevPoints,
      nextPointsGood,
      statusGood,
      new cv.Mat(),
      new cv.Size(this.#optFlowWinSize, this.#optFlowWinSize),
      this.#optFlowPyramidLevel,
      termCriteria,
      0,
      goodQuality,
    );
    var numPoints = nextPointsGood.size().height;
    for (var i = 0; i < numPoints; i++) {
      var x = nextPoints.data32F[i * 2],
        y = nextPoints.data32F[i * 2 + 1];
      if (statusGood.data[i] == 1) {
        if (debugDraw) {
          cv.circle(
            debugImage,
            new cv.Point(x, y),
            2,
            goodColor,
            2,
          );
        }
      } else {
        if (debugDraw) {
          cv.circle(
            debugImage,
            new cv.Point(x, y),
            2,
            failColor,
            2,
          );
        }
        errorCount++;
      }
    }
    var outputPointsArray = [],
      inputPointsArray = [],
      numGoodPoints = nextPoints.size().height;
    for (var i = 0; i < numGoodPoints; i++) {
      var x = nextPoints.data32F[i * 2],
        y = nextPoints.data32F[i * 2 + 1];
      if (status.data[i] == 1) {

        (outputPointsArray.push(x),
          outputPointsArray.push(y));
        var inX = prevPoints.data32F[i * 2],
          inY = prevPoints.data32F[i * 2 + 1];
        (inputPointsArray.push(inX),
          inputPointsArray.push(inY));

      } else
        debugDraw &&
          cv.circle(
            debugImage,
            new cv.Point(x, y),
            2,
            badColor,
            2,
          );
    }
    var goodCount = numPoints - errorCount,
      confidence = goodCount / 20;
    return (
      (confidence = confidence < 0 ? 0 : confidence),
      (confidence = confidence > 1 ? 1 : confidence),
      status["delete"](),
      statusGood["delete"](),
      nextPoints["delete"](),
      nextPointsGood["delete"](),
      outputPoints["delete"](),
      (nextPoints = cv.matFromArray(
        outputPointsArray.length / 2,
        2,
        cv.CV_32F,
        outputPointsArray,
      )),
      (outputPoints = cv.matFromArray(
        inputPointsArray.length / 2,
        2,
        cv.CV_32F,
        inputPointsArray,
      )),
      debugDraw &&
      (this.#debugShowMat(debugImage, "trackPoints"),
        debugImage["delete"]()),
      { newPoints: nextPoints, oldPoints: outputPoints, confidence: confidence }
    );
  }
  #calcMotionFromFlow(oldPoints, newPoints, debugDraw = ![], debugImage) {

    if (debugDraw) {
      var drawMat = new cv.Mat();
      (debugImage.copyTo(drawMat),
        cv.cvtColor(drawMat, drawMat, cv.COLOR_GRAY2RGB, 0));
      var pointColor = new cv.Scalar(0, 255, 0),
        errorColor = new cv.Scalar(255, 0, 0),
        edgeColor = new cv.Scalar(0, 0, 255),
        markerColor = new cv.Scalar(255, 180, 0),
        outlierColor = new cv.Scalar(255, 0, 255);
    }
    var numPoints = newPoints.size().height;
    if (numPoints < 4) {
      return {
        oldPoints: oldPoints,
        newPoints: newPoints,
        centroid: {
          x: this.#screenPos.x,
          y: this.#screenPos.y,
          isDistorted: !![],
          sca: this.#scale,
        },
        confidence: 0,
      };
    }
    const { h: homography, inliers: inliers } = this.#findHomography(
      oldPoints,
      newPoints,
    );
    var validNewPoints = [],
      validOldPoints = [],
      outlierCount = 0;
    for (var i = 0; i < numPoints; i++) {
      if (inliers.data[i]) {
        var newX = newPoints.data32F[i * 2],
          newY = newPoints.data32F[i * 2 + 1],
          oldX = oldPoints.data32F[i * 2],
          oldY = oldPoints.data32F[i * 2 + 1],
          dx = Math.abs(newX - oldX),
          dy = Math.abs(newY - oldY),
          driftThreshold = this.CLAMP_PIXEL_DRIFT;
        if (dx < driftThreshold && dy < driftThreshold) {
          (validNewPoints.push(newX),
            validNewPoints.push(newY),
            validOldPoints.push(oldX),
            validOldPoints.push(oldY),
            debugDraw &&
            (cv.circle(
              drawMat,
              new cv.Point(newX, newY),
              2,
              markerColor,
              2,
            ),
              cv.circle(
                drawMat,
                new cv.Point(oldX, oldY),
                2,
                pointColor,
                2,
              ),
              cv.line(
                drawMat,
                new cv.Point(newX, newY),
                new cv.Point(oldX, oldY),
                pointColor,
                2,
              )));
        } else {
          outlierCount++;
          if (debugDraw) {
            (cv.circle(
              drawMat,
              new cv.Point(newX, newY),
              2,
              outlierColor,
              2,
            ),
              cv.circle(
                drawMat,
                new cv.Point(oldX, oldY),
                2,
                errorColor,
                2,
              ),
              cv.line(
                drawMat,
                new cv.Point(newX, newY),
                new cv.Point(oldX, oldY),
                errorColor,
                2,
              ));
          }
        }
      } else
        (debugDraw &&
          cv.circle(
            drawMat,
            new cv.Point(newX, newY),
            2,
            errorColor,
            2,
          ),
          outlierCount++);
    }
    if (inliers) inliers["delete"]();
    (newPoints["delete"](),
      oldPoints["delete"](),
      (newPoints = cv.matFromArray(
        validNewPoints.length / 2,
        2,
        cv.CV_32F,
        validNewPoints,
      )),
      (oldPoints = cv.matFromArray(
        validOldPoints.length / 2,
        2,
        cv.CV_32F,
        validOldPoints,
      )));
    let centroid = {
      x: this.#screenPos.x,
      y: this.#screenPos.y,
      isDistorted: ![],
    },
      prevHomography = new cv.Mat();
    this.#homographyMatrix.copyTo(prevHomography);
    var noHomography = !homography,
      motionConfidence = (numPoints - outlierCount) / numPoints;
    if (numPoints == 0 || noHomography) motionConfidence = 0;
    if (!noHomography && this.#trackingConfidence > this.#confidenceThreshold) {

      (cv.gemm(
        this.#homographyMatrix,
        homography,
        1,
        homography,
        0,
        this.#homographyMatrix,
        0,
      ),
        homography["delete"]());
      var analyzedHomography = this.#analyzeHomography(
        this.#homographyMatrix,
        60,
        2000,
        debugDraw,
        debugImage,
      );
      if (
        Math.abs(centroid.x - analyzedHomography.x) >
        this.CLAMP_PIXEL_DRIFT ||
        Math.abs(centroid.y - analyzedHomography.y) >
        this.CLAMP_PIXEL_DRIFT
      ) {

        analyzedHomography = centroid;
        prevHomography.copyTo(this.#homographyMatrix);

      }
      debugDraw &&
        ((this.#debugShowMat(drawMat, "homographyCheck"), drawMat["delete"]()));

    } else {
    }
    return (
      prevHomography["delete"](),
      {
        oldPoints: oldPoints,
        newPoints: newPoints,
        centroid: analyzedHomography,
        confidence: motionConfidence,
      }
    );
  }
  #isOutOfBounds() {

    searchRadius = this.#searchRadiusFactor * this.#matchDistThreshold * 0.5;
    if (
      this.#screenPos.x < searchRadius ||
      this.#screenPos.x > this.CANVAS_WIDTH - searchRadius ||
      this.#screenPos.y < searchRadius ||
      this.#screenPos.y > this.CANVAS_HEIGHT - searchRadius
    )
      var inBounds = ![];
    else var inBounds = !![];
    return inBounds;
  }
  #isLost() {

    return (
      this.#screenPos.x < -0.5 * this.CANVAS_WIDTH ||
      this.#screenPos.x > 1.5 * this.CANVAS_WIDTH ||
      this.#screenPos.y < -0.5 * this.CANVAS_HEIGHT ||
      this.#screenPos.y > 1.5 * this.CANVAS_HEIGHT
    );
  }
  #findClosestPatch(
    image,
    points,
    searchX,
    searchY,
    offsetX,
    offsetY,
    debugDraw = ![],
  ) {

    closestPoint = { x: 99999999, y: 99999999 },
      minDistance = 10000000000000000,
      numPoints = points.size().height;
    for (var i = 0; i < numPoints; i++) {

      var x = points.data32F[i * 2],
        y = points.data32F[i * 2 + 1],
        distSq =
          (x - searchX) * (x - searchX) +
          (y - searchY) * (y - searchY);
      distSq < minDistance &&
        ((closestPoint.x = x),
          (closestPoint.y = y),
          (minDistance = distSq));
    }
    var patch = this.#extractPatch(
      image,
      closestPoint.x,
      closestPoint.y,
      offsetX,
      offsetY,
      1,
      this.#matchDistThreshold,
      debugDraw,
    );
    if (debugDraw) {

      var debugMat = new cv.Mat();
      (image.copyTo(debugMat),
        cv.cvtColor(
          debugMat,
          debugMat,
          cv.COLOR_GRAY2RGB,
          0,
        ));
      var searchColor = new cv.Scalar(0, 255, 0),
        patchColor = new cv.Scalar(255, 0, 0);
      (cv.circle(
        debugMat,
        new cv.Point(searchX, searchY),
        2,
        searchColor,
        2,
      ),
        cv.circle(
          debugMat,
          new cv.Point(closestPoint.x, closestPoint.y),
          2,
          patchColor,
          2,
        ));
      debugMat["delete"]();

    }
    return patch;
  }
  #solveDsca(
    oldPoints,
    newPoints,
    screenPos,
    centroid,
    debugDraw = ![],
    debugImage,
  ) {

    if (debugDraw) {
      var drawMat = new cv.Mat();
      (debugImage.copyTo(drawMat),
        cv.cvtColor(drawMat, drawMat, cv.COLOR_GRAY2RGB, 0));
      var centerColor = new cv.Scalar(0, 255, 0),
        nearestColor = new cv.Scalar(255, 0, 0),
        pointColor = new cv.Scalar(0, 0, 255),
        centroidColor = new cv.Scalar(255, 180, 0),
        lineColor = new cv.Scalar(255, 0, 255);
    }
    var newPointsArray = [],
      scaleRatios = [],
      distances = [],
      closestPoint = { x: centroid.x, y: centroid.y },
      minDist = 1000000000000,
      numPoints = newPoints.size().height;
    for (var i = 0; i < numPoints; i++) {
      var newX = newPoints.data32F[i * 2],
        newY = newPoints.data32F[i * 2 + 1];
      (newPointsArray.push(newX), newPointsArray.push(newY));
      var distSq =
        (newX - screenPos.x) * (newX - screenPos.x) +
        (newY - screenPos.y) * (newY - screenPos.y);
      distSq < minDist &&
        ((closestPoint.x = newX),
          (closestPoint.y = newY),
          (minDist = distSq));
      distances.push(distSq);
      var oldX = oldPoints.data32F[i * 2],
        oldY = oldPoints.data32F[i * 2 + 1],
        basePosX = screenPos.x,
        basePosY = screenPos.y,
        newX = newPoints.data32F[i * 2],
        newY = newPoints.data32F[i * 2 + 1],
        centroidX = centroid.x,
        centroidY = centroid.y,
        oldDx = oldX - basePosX,
        oldDy = oldY - basePosY,
        oldDist = Math.sqrt(oldDx * oldDx + oldDy * oldDy),
        newDx = newX - centroidX,
        newDy = newY - centroidY,
        newDist = Math.sqrt(
          newDx * newDx + newDy * newDy,
        );
      if (debugDraw) {
        cv.circle(
          drawMat,
          new cv.Point(newX, newY),
          2,
          pointColor,
          2,
        );
        var point1 = new cv.Point(newX, newY),
          point2 = new cv.Point(centroidX, centroidY);
      }
      scaleRatios.push(newDist / oldDist);
    }
    newPoints["delete"]();
    var resultPoints = new cv.matFromArray(
      newPointsArray.length / 2,
      2,
      cv.CV_32F,
      newPointsArray,
    );
    if (scaleRatios.length == 0)
      return { points: resultPoints, dsca: 1 };
    if (scaleRatios.length > 0) {
      var scaleValue = this.#weightedPercentile(scaleRatios, distances, 0.1);
    } else var scaleValue = 1;
    return (
      debugDraw &&
      (cv.circle(
        drawMat,
        new cv.Point(closestPoint.x, closestPoint.y),
        10,
        centerColor,
        2,
      ),
        cv.circle(
          drawMat,
          new cv.Point(centroid.x, centroid.y),
          10,
          centroidColor,
          2,
        ),
        this.#debugShowMat(drawMat, "solveDsca"),
        drawMat["delete"]()),
      { points: resultPoints, dsca: scaleValue }
    );
  }
  #unused28(
    param1,
    param2,
    param3 = ![],
    param4,
    param5,
    param6,
  ) { }
  setViewportPos(posStr) {

    const parts = posStr.split(",");
    var normX = parseFloat(parts[0]),
      normY = parseFloat(parts[1]),
      windowAspect = window.innerWidth / window.innerHeight,
      canvasAspect = this.CANVAS_WIDTH / this.CANVAS_HEIGHT;
    if (canvasAspect > windowAspect) {
      normX =
        (normX * windowAspect + 0.5 * (canvasAspect - windowAspect)) / canvasAspect;
    } else
      canvasAspect < windowAspect &&
        (normY =
          (normY * canvasAspect + 0.5 * (windowAspect - canvasAspect)) / windowAspect);
    var viewportX = normX * wTracker.CANVAS_WIDTH,
      viewportY = (1 - normY) * wTracker.CANVAS_HEIGHT;
    ((wTracker.#screenOffset.x += viewportX - wTracker.#screenPos.x),
      (wTracker.#screenOffset.y += viewportY - wTracker.#screenPos.y),
      (wTracker.#screenPos.x = viewportX),
      (wTracker.#screenPos.y = viewportY),
      wTracker.#resetHomography());
  }
  #init3DOF(z = -3, height = 1.25, armLength = 0.4) {

    ((this.START_ALPHA = this.compassHeading),
      (this.START_ORIENTATION = 0),
      (this.#deviceQuat = new QuaternionW()),
      (this.ARM_LENGTH = armLength),
      (this.#originWorld = new Vector3W(0, height, z)));
  }
  #init3DOFOrbit(z = -3, height = 1.25, armLength = 0.4) {

    ((this.START_ALPHA = this.compassHeading),
      (this.START_ORIENTATION = 0),
      (this.#deviceQuat = new QuaternionW()),
      (this.ARM_LENGTH = armLength),
      (this.#originWorld = new Vector3W(0, height, z)));
  }
  #get3DOFOrbitPose() {

    w = 1,
      i = 0,
      j = 0,
      k = 0;
    if (wTracker.#deviceQuat) {

      if (this.#kalmanState.hasPrediction) {
        var deltaTime =
          (Date.now() - this.lastUpdateTime) / 1000,
          predictedQuat = wTracker.#predictKalman(deltaTime);
        ((w = predictedQuat.w),
          (i = predictedQuat.i),
          (j = predictedQuat.j),
          (k = predictedQuat.k));
      } else
        ((w = wTracker.#deviceQuat.w),
          (i = wTracker.#deviceQuat.i),
          (j = wTracker.#deviceQuat.j),
          (k = wTracker.#deviceQuat.k));
      wTracker.#correctKalman(
        wTracker.#deviceQuat.w,
        wTracker.#deviceQuat.i,
        wTracker.#deviceQuat.j,
        wTracker.#deviceQuat.k,
      );
    }
    return { w: w, i: i, j: j, k: k };
  }
  #toGrayscale(image, debugFlag = ![]) {

    grayImage = new cv.Mat();
    cv.cvtColor(image, grayImage, cv.COLOR_RGBA2GRAY, 0);
    if (debugFlag);
    return grayImage;
  }
  #getCenterSquareRect() {

    minDim = Math.min(
      this.CANVAS_WIDTH,
      this.CANVAS_HEIGHT,
    ),
      x = (this.CANVAS_WIDTH - minDim) / 2,
      y = (this.CANVAS_HEIGHT - minDim) / 2;
    return new cv.Rect(x, y, minDim, minDim);
  }
  #extractCenterROI(image, debugFlag = ![]) {

    rect = this.#getCenterSquareRect(),
      roi = image.roi(rect),
      scaleFactor = this.#homScaleThreshold;
    cv.resize(
      roi,
      roi,
      {
        width: rect.width * scaleFactor,
        height: rect.height * scaleFactor,
      },
      0,
      0,
      cv.INTER_AREA,
    );
    var siftResult = this.#detectAndCompute(roi, this.#siftDetector, this.#siftDetectorRef, debugFlag);
    return {
      kp: siftResult.kp,
      des: siftResult.des,
      gray: roi,
    };
  }
  #detectAndCompute(image, detector, computer, debugFlag) {

    let keypoints = new cv.KeyPointVector(),
      descriptors = new cv.Mat();
    (detector.detect(image, keypoints, new cv.Mat()),
      computer.compute(image, keypoints, descriptors));
    if (debugFlag) {
      this.#debugDrawKeypoints(image, keypoints, "#detectCompute");
    }
    return { kp: keypoints, des: descriptors };
  }
  #debugDrawKeypoints(image, keypoints, windowName = "#debugKps") {

    drawMat = new cv.Mat(),
      color = new cv.Scalar(0, 255, 0);
    (cv.drawKeypoints(image, keypoints, drawMat, color),
      this.#debugShowMat(drawMat, windowName),
      drawMat["delete"]());
  }
  #knnMatchWithRatioTest(
    descriptor1,
    descriptor2,
    matcher,
    ratioThreshold,
    debugDraw = ![],
    image1,
    kp1,
    image2,
    kp2,
  ) {

    let goodMatches = new cv.DMatchVector(),
      allMatches = new cv.DMatchVectorVector();
    matcher.knnMatch(descriptor1, descriptor2, allMatches, 2);
    for (
      let i = 0;
      i < allMatches.size();
      ++i
    ) {

      let matchPair = allMatches["get"](i),
        match1 = matchPair["get"](0),
        match2 = matchPair["get"](1);
      if (!match1 || !match2) {
        continue;
      }
      match1.distance < match2.distance * ratioThreshold &&
        goodMatches.push_back(match1);

    }
    if (debugDraw) {
      this.#debugDrawMatches(goodMatches, image1, kp1, image2, kp2);
    }
    return { matches: goodMatches };
  }
  #debugDrawMatches(
    matches,
    image1,
    image2,
    kp1,
    kp2,
    windowName = "#debugMatches",
  ) {

    drawMat = new cv.Mat();
    let matchColor = new cv.Scalar(0, 255, 0, 255);
    (cv.drawMatches(
      image1,
      kp1,
      image2,
      kp2,
      matches,
      drawMat,
      matchColor,
    ),
      this.#debugShowMat(drawMat, windowName),
      drawMat["delete"]());
  }
  #matToKeyPointVector(mat) {

    keypoints = new cv.KeyPointVector();
    for (
      var i = 0;
      i < mat.size().height;
      i++
    ) {

      var x = mat.data32F[i * 2],
        y = mat.data32F[i * 2 + 1];
      keypoints.push_back({
        pt: { x: x, y: y },
        angle: 0,
        class_id: 0,
        octave: 0,
        response: 0,
        size: 0,
      });
    }
    return keypoints;
  }
  #f040(mat) {

    pointsArray = [];
    for (var i = 0; i < mat.size(); i++) {
      var kp = mat["get"](i);
      (pointsArray.push(kp.pt.x),
        pointsArray.push(kp.pt.y));
    }
    return cv.matFromArray(
      pointsArray.length / 2,
      2,
      cv.CV_32F,
      pointsArray,
    );
  }
  #f041(image, keypoints, scale, debugDraw) {

    if (debugDraw) {
      var debugMat = new cv.Mat();
      (image.copyTo(debugMat),
        cv.cvtColor(debugMat, debugMat, cv.COLOR_GRAY2RGB, 0));
    }
    var patchSize = this.#patchSizeFactor * scale,
      searchRadius = this.#searchRadiusFactor * scale,
      patches = [],
      outOfBoundsCount = 0;
    for (
      var i = 0;
      i < keypoints.size();
      i++
    ) {
      var kp = keypoints["get"](i),
        x = kp.pt.x,
        y = kp.pt.y;
      if (
        x < searchRadius / 2 ||
        x > image.size().width - searchRadius / 2 ||
        y < searchRadius / 2 ||
        y > image.size().height - searchRadius / 2
      ) {

        outOfBoundsCount++;
        continue;

      }
      var halfPatch = Math.floor(patchSize / 2),
        patchMat = new cv.Mat(),
        patchRect = new cv.Rect(
          x - halfPatch,
          y - halfPatch,
          patchSize,
          patchSize,
        );
      ((patchMat = image.roi(patchRect)),
        patches.push({ keypoint: kp, patch: patchMat }),
        debugDraw &&
        cv.rectangle(
          debugMat,
          new cv.Point(patchRect.x, patchRect.y),
          new cv.Point(
            patchRect.x + patchRect.width,
            patchRect.y + patchRect.height,
          ),
          new cv.Scalar(0, 255, 255),
          1,
        ));
    }
    if (debugDraw) {
      debugMat["delete"]();
    }
    return patches;
  }
  #f042(
    frame,
    offsetX,
    offsetY,
    scale,
    scaleFactor = 1,
    debugDraw,
  ) {

    detectMask = this.#getDetectMask(!![]),
      cornerPoints = new cv.Mat();
    cv.goodFeaturesToTrack(frame, cornerPoints, 1, 0.01, 7, detectMask);
    var centerX = cornerPoints.data32F[0],
      centerY = cornerPoints.data32F[1],
      searchRadius = this.#searchRadiusFactor * scaleFactor;
    (centerX < searchRadius / 2 ||
      centerX >
      frame.size().width - searchRadius / 2 ||
      centerY < searchRadius / 2 ||
      centerY >
      frame.size().height - searchRadius / 2) &&
      ((centerX = this.CANVAS_WIDTH / 2),
        (centerY = this.CANVAS_HEIGHT / 2));
    var patch = this.#extractPatch(
      frame,
      centerX,
      centerY,
      offsetX,
      offsetY,
      scale,
      scaleFactor,
      debugDraw,
    );
    return patch;
  }
  #extractPatch(
    image,
    x,
    y,
    offsetX,
    offsetY,
    scale,
    scaleFactor = 1,
    debugDraw,
  ) {

    if (debugDraw) {

      var debugMat = new cv.Mat();
      (image.copyTo(debugMat),
        cv.cvtColor(
          debugMat,
          debugMat,
          cv.COLOR_GRAY2RGB,
          0,
        ));

    }
    var patchSize = this.#patchSizeFactor * scaleFactor,
      searchRadius = this.#searchRadiusFactor * scaleFactor;
    if (
      x < searchRadius / 2 ||
      x >
      image.size().width - searchRadius / 2 ||
      y < searchRadius / 2 ||
      y > image.size().height - searchRadius / 2
    ) {

      console.error("patch\x20is\x20out\x20of\x20bounds");
      return;
    }
    var keypoint = {
      pt: { x: x, y: y },
      angle: 0,
      class_id: 0,
      octave: 0,
      response: 0,
      size: 0,
    },
      halfPatch = Math.floor(patchSize / 2),
      patchMat = new cv.Mat(),
      rect = new cv.Rect(
        x - halfPatch,
        y - halfPatch,
        patchSize,
        patchSize,
      );
    patchMat = image.roi(rect);
    var patchData = {
      keypoint: keypoint,
      patch: patchMat,
      ssx_offset: offsetX,
      ssy_offset: offsetY,
      sca: scale,
    };
    debugDraw &&
      cv.rectangle(
        debugMat,
        new cv.Point(rect.x, rect.y),
        new cv.Point(
          rect.x + rect.width,
          rect.y + rect.height,
        ),
        new cv.Scalar(255, 0, 255),
        1,
      );
    if (debugDraw) {
      debugMat["delete"]();
    }
    return patchData;
  }
  #matchPatchCenter(image, patch, matchThreshold, debugDraw) {

    patchSize = this.#patchSizeFactor * matchThreshold,
      searchRadius = this.#searchRadiusFactor * matchThreshold,
      searchRadiusVerify = this.#searchRadiusFactor * matchThreshold;
    if (debugDraw) {
      var windowName = "#matchCenterPatch",
        debugMat = new cv.Mat();
      cv.cvtColor(image, debugMat, cv.COLOR_GRAY2RGB, 0);
    }
    var keypoint = patch.keypoint,
      x = keypoint.pt.x,
      y = keypoint.pt.y;
    if (
      x < searchRadius / 2 ||
      x >
      image.size().width - searchRadius / 2 ||
      y < searchRadius / 2 ||
      y >
      image.size().height - searchRadius / 2
    )
      return (
        debugDraw &&
        ((cv.circle(
          debugMat,
          new cv.Point(x, y),
          2,
          new cv.Scalar(255, 0, 0),
          2,
        ),
          cv.circle(
            debugMat,
            new cv.Point(x, y),
            patchSize,
            new cv.Scalar(255, 0, 0),
            2,
          ))),
        null
      );
    var oldKeypoint = {
      pt: { x: x, y: y },
      angle: 0,
      class_id: 0,
      octave: 0,
      response: 0,
      size: 0,
    },
      halfPatch = Math.floor(patchSize / 2),
      patchRect = new cv.Rect(
        x - halfPatch,
        y - halfPatch,
        patchSize,
        patchSize,
      ),
      searchRect = new cv.Rect(
        x - searchRadius / 2,
        y - searchRadius / 2,
        searchRadius,
        searchRadius,
      ),
      searchRoi = image.roi(searchRect),
      resultMat = new cv.Mat();
    cv.matchTemplate(
      searchRoi,
      patch.patch,
      resultMat,
      cv.TM_CCORR_NORMED,
    );
    var minMaxResult = cv.minMaxLoc(resultMat);
    (searchRoi["delete"](), resultMat["delete"]());
    var matchLoc = new cv.Point(
      x - searchRadius / 2 + minMaxResult.maxLoc.x,
      y - searchRadius / 2 + minMaxResult.maxLoc.y,
    ),
      patchBR = new cv.Point(
        matchLoc.x + patchSize,
        matchLoc.y + patchSize,
      ),
      matchX = matchLoc.x + Math.ceil(patchSize / 2),
      matchY = matchLoc.y + Math.ceil(patchSize / 2);
    ((keypoint.pt.x = matchX - 1),
      (keypoint.pt.y = matchY - 1));
    if (
      matchX - halfPatch <= x - searchRadiusVerify / 2 ||
      matchX + halfPatch >= x + searchRadiusVerify / 2 ||
      matchY - halfPatch <= y - searchRadiusVerify / 2 ||
      matchY + halfPatch >= y + searchRadiusVerify / 2
    )
      return (
        debugDraw &&
        (cv.circle(
          debugMat,
          new cv.Point(x, y),
          2,
          new cv.Scalar(255, 0, 0),
          2,
        ),
          cv.circle(
            debugMat,
            new cv.Point(x, y),
            patchSize,
            new cv.Scalar(255, 0, 0),
            2,
          )),
        null
      );
    else {
      debugDraw &&
        (cv.rectangle(
          debugMat,
          new cv.Point(patchRect.x, patchRect.y),
          new cv.Point(
            patchRect.x + patchRect.width,
            patchRect.y + patchRect.height,
          ),
          new cv.Scalar(255, 0, 0),
          1,
        ),
          cv.rectangle(
            debugMat,
            new cv.Point(searchRect.x, searchRect.y),
            new cv.Point(
              searchRect.x + searchRect.width,
              searchRect.y + searchRect.height,
            ),
            new cv.Scalar(0, 0, 255),
            1,
          ),
          cv.rectangle(
            debugMat,
            matchLoc,
            patchBR,
            new cv.Scalar(255, 255, 0),
            1,
          ));
    }
    return (
      debugDraw && (this.#debugShowMat(debugMat, windowName), debugMat["delete"]()),
      { keypoint: keypoint, oldKeypoint: oldKeypoint }
    );
  }
  #deletePatch(patch) {

    patch.patch["delete"]();
  }
  #deletePatches(patches) {

    patches.forEach((patch) => {
      patch.patch["delete"]();
    });
  }
  #matchPatches(image, patches, scale, debugDraw) {

    patchSize = this.#patchSizeFactor * scale,
      searchRadius = this.#searchRadiusFactor * scale,
      searchRadiusVerify = this.#searchRadiusFactor * scale,
      matchedKeypoints = new cv.KeyPointVector(),
      oldKeypoints = new cv.KeyPointVector();
    if (debugDraw) {

      var windowName = "#matchPatches",
        debugMat = new cv.Mat();
      cv.cvtColor(image, debugMat, cv.COLOR_GRAY2RGB, 0);
    }
    var patchCount = 0,
      matchedCount = 0;
    return (
      patches.forEach((patchData) => {
        keypoint = patchData.keypoint,
          x = keypoint.pt.x,
          y = keypoint.pt.y;
        var oldKeypoint = {
          pt: { x: x, y: y },
          angle: 0,
          class_id: 0,
          octave: 0,
          response: 0,
          size: 0,
        },
          patchMat = patchData.patch,
          halfPatch = Math.floor(patchSize / 2),
          patchRect = new cv.Rect(
            x - halfPatch,
            y - halfPatch,
            patchSize,
            patchSize,
          ),
          searchRect = new cv.Rect(
            x - searchRadius / 2,
            y - searchRadius / 2,
            searchRadius,
            searchRadius,
          ),
          searchRoi = image.roi(searchRect),
          resultMat = new cv.Mat();
        cv.matchTemplate(
          searchRoi,
          patchMat,
          resultMat,
          cv.TM_CCORR_NORMED,
        );
        var minMaxResult = cv.minMaxLoc(resultMat);
        (searchRoi["delete"](), resultMat["delete"]());
        var matchLoc = new cv.Point(
          x - searchRadius / 2 + minMaxResult.maxLoc.x,
          y - searchRadius / 2 + minMaxResult.maxLoc.y,
        ),
          patchBR = new cv.Point(
            matchLoc.x + patchSize,
            matchLoc.y + patchSize,
          ),
          matchX = matchLoc.x + Math.ceil(patchSize / 2),
          matchY = matchLoc.y + Math.ceil(patchSize / 2);
        ((keypoint.pt.x = matchX - 1),
          (keypoint.pt.y = matchY - 1));
        if (
          matchX - halfPatch <= x - searchRadiusVerify / 2 ||
          matchX + halfPatch >= x + searchRadiusVerify / 2 ||
          matchY - halfPatch <= y - searchRadiusVerify / 2 ||
          matchY + halfPatch >= y + searchRadiusVerify / 2
        ) {

          debugDraw &&
            ((cv.circle(
              debugMat,
              new cv.Point(x, y),
              2,
              new cv.Scalar(255, 0, 0),
              2,
            ),
              cv.circle(
                debugMat,
                new cv.Point(x, y),
                patchSize,
                new cv.Scalar(255, 0, 0),
                2,
              )));
        } else {
          (matchedKeypoints.push_back(keypoint),
            oldKeypoints.push_back(oldKeypoint),
            matchedCount++);
          if (debugDraw) {
            (cv.rectangle(
              debugMat,
              new cv.Point(patchRect.x, patchRect.y),
              new cv.Point(
                patchRect.x + patchRect.width,
                patchRect.y + patchRect.height,
              ),
              new cv.Scalar(255, 0, 0),
              1,
            ),
              cv.rectangle(
                debugMat,
                new cv.Point(searchRect.x, searchRect.y),
                new cv.Point(
                  searchRect.x + searchRect.width,
                  searchRect.y + searchRect.height,
                ),
                new cv.Scalar(0, 0, 255),
                1,
              ),
              cv.rectangle(
                debugMat,
                matchLoc,
                patchBR,
                new cv.Scalar(255, 255, 0),
                1,
              ));
          }
        }
        patchCount++;
      }),
      debugDraw &&
      (this.#debugShowMat(debugMat, windowName), debugMat["delete"]()),
      { kp: matchedKeypoints, oldKp: oldKeypoints }
    );
  }
  placeOrigin(originStr) {

    var parts = originStr.split(","),
      origin = new Vector3W(
        parseFloat(parts[0]),
        parseFloat(parts[1]),
        parseFloat(parts[2]),
      );
    ((this.#originWorld = new Vector3W(
      origin.x,
      origin.y,
      origin.z,
    )),
      (this.#cameraPosition = origin),
      (this.START_Z = Math.abs(origin.z)),
      (this.LAST_Z = this.START_Z),
      this.resetOrigin(),
      this.reset6DOF(origin),
      setTimeout(() => {
        videoFrame = this.#readVideoFrame(),
          grayFrame = this.#toGrayscale(videoFrame);
        ((this.#referenceFrame = this.#extractCenterROI(grayFrame)),
          (this.#referenceFrame.grayBig = grayFrame),
          videoFrame["delete"]());
      }, 100),
      this.CENTER_PATCH &&
      ((this.CENTER_PATCH.patch["delete"](),
        (this.CENTER_PATCH = null))),
      (this.#poseCorrected = !![]),
      (this.SS_LOST_OR_OUT_OF_BOUNDS_IN_LAST_FRAME = ![]),
      (this.START_ALPHA = this.compassHeading),
      (this.#currentBeta = null));
  }
  setTrackerSettings(settingsJson, versionStr = "0.0.0") {

    (console.log(settingsJson), this.#initVersionChecker(versionStr));
    var settings = JSON.parse(settingsJson);
    (Object.keys(settings).forEach((key) => {
      if (this[key] != settings[key]) {

        this[key] = settings[key];
      }
    }),
      this.#prevFrame &&
      ((this.#prevFrame["delete"](), (this.#prevFrame = null))),
      this.setMode(this.MODE));
  }
  resetOrigin() {

    if (!this.CANVAS_WIDTH || !this.CANVAS_HEIGHT) return;
    if (this.#trackPoints) this.#trackPoints["delete"]();
    ((this.#trackPoints = null),
      (this.#screenPos = {
        x: this.CANVAS_WIDTH / 2,
        y: this.CANVAS_HEIGHT / 2,
      }),
      (this.#screenOffset = { x: 0, y: 0 }),
      (wTracker.#homographyMatrix = cv.matFromArray(
        3,
        3,
        cv.CV_64F,
        [1, 0, 0, 0, 1, 0, 0, 0, 1],
      )),
      this.#resetKalmanFilter(),
      (this.START_ALPHA = this.compassHeading),
      (this.#currentBeta = null),
      (this.cumAlpha = null),
      this.#resetHomography());
  }
  reset6DOF(newOrigin) {

    (this.#tempVec.setValues(0, 0, 0),
      this.#cameraPosition.setValues(
        newOrigin.x,
        newOrigin.y,
        newOrigin.z,
      ),
      (this.#scale = 1),
      (this.#prevScale = 1));
  }
  #sendPoseToUnity(pose) {

    if (pose) {

      var poseStr =
        pose.w +
        "," +
        pose.i +
        "," +
        pose.j +
        "," +
        pose.k +
        "," +
        pose.x +
        "," +
        pose.y +
        "," +
        pose.z +
        "," +
        pose.sca +
        "," +
        pose.c;
      if (window.unityInstance)
        window.unityInstance.SendMessage(
          wTracker.TRACKER_NAME,
          "UpdateCameraTransform_6DOF",
          poseStr,
        );

    }
  }
  #f049(pose) {

    if (pose) {

      var poseStr =
        pose.w +
        "," +
        pose.i +
        "," +
        pose.j +
        "," +
        pose.k +
        "," +
        pose.x +
        "," +
        pose.y +
        "," +
        pose.z +
        "," +
        pose.sca +
        "," +
        pose.c;
      if (window.unityInstance)
        window.unityInstance.SendMessage(
          wTracker.TRACKER_NAME,
          "UpdateCameraTransform_3DOF",
          poseStr,
        );

    }
  }
  #f050(pose) {

    if (pose) {

      var poseStr =
        pose.w +
        "," +
        pose.i +
        "," +
        pose.j +
        "," +
        pose.k +
        "," +
        pose.x +
        "," +
        pose.y +
        "," +
        pose.z +
        "," +
        pose.sca +
        "," +
        pose.c;
      if (window.unityInstance)
        window.unityInstance.SendMessage(
          wTracker.TRACKER_NAME,
          "UpdateCameraTransform_3DOF_Orbit",
          poseStr,
        );
    }
  }
  #f051() {

    if (!wTracker.CANVAS_WIDTH) {
      return;
    }
    var canvas = wTracker.unityCanvas,
      isSamsung =
        navigator.userAgent.match(/SamsungBrowser/i);
    if (isSamsung) {
      ((canvas.style.width = "100%"),
        (canvas.style.height = "100%"));
    } else {
      ((canvas.style.width =
        window.innerWidth + "px"),
        (canvas.style.height =
          window.innerHeight + "px"));
    }
    var videoElement = wTracker.videoBackground,
      rect = this.videoBackground.getBoundingClientRect();
    var aspectRatio = wTracker.ASPECT_RATIO,
      windowWidth = window.innerWidth,
      windowHeight = window.innerHeight,
      screenAspect = windowWidth / windowHeight;
    if (screenAspect > aspectRatio) {

      document.body.style.height =
        window.innerHeight + "px";
      var height = window.innerHeight;
      aspectRatio *= window.innerHeight / height;
      if (isSamsung) {
        ((videoElement.style.width = "100%"),
          (videoElement.style.height = "auto"));
      } else
        ((videoElement.style.width =
          window.innerWidth + "px"),
          (videoElement.style.height =
            window.innerWidth / aspectRatio + "px"));
      aspectRatio =
        wTracker.ASPECT_RATIO *
        (window.innerWidth / wTracker.ASPECT_RATIO / height);
    } else {

      document.body.style.height =
        window.innerHeight + "px";
      var height = window.innerHeight;
      aspectRatio *= window.innerHeight / height;
      isSamsung
        ? ((videoElement.style.height = "100%"),
          (videoElement.style.width = "auto"))
        : ((videoElement.style.height =
          window.innerHeight + "px"),
          (videoElement.style.width =
            window.innerHeight * aspectRatio + "px"));

    }
    var halfWidth = (0.5 * wTracker.CANVAS_WIDTH) / aspectRatio,
      distance = wTracker.CANVAS_WIDTH,
      fovAngle =
        (2 * Math.atan(halfWidth / distance) * 180) /
        Math.PI;
    this.FOV = fovAngle;
    if (window.unityInstance)
      window.unityInstance.SendMessage(
        this.TRACKER_NAME,
        "SetCameraFov",
        fovAngle,
      );
    else;
  }
  #debugShowMat(mat, windowId) {

    scale = 0.5,
      canvas = document.getElementById(windowId);
    if (!canvas) {
      ((canvas = document.createElement("canvas")),
        (canvas.id = windowId),
        document.body.appendChild(canvas));
      if (!this.debugIds) this.debugIds = [];
      (this.debugIds.push(windowId),
        (canvas.style.position = "absolute"),
        (canvas.style.top = "0px"),
        (canvas.style.left = "0px"),
        (canvas.style.transform =
          "translate(0%, 0%) scale(" + scale + ")"));
    }
    cv.imshow(windowId, mat);
    var index = this.debugIds.indexOf(windowId);
    if (index != -1) {
      canvas.style.left =
        index * mat.size().width * scale + "px";
    }
  }
  #debugRemoveMat(windowId) {

    element = document.getElementById(windowId);
    if (element) {

      element.remove();
      var index = this.debugIds.indexOf(windowId);
      index !== -1 && this.debugIds.splice(index, 1);
    }
  }
  #debugShowText(text) {

    (!window.text_debugger &&
      ((window.text_debugger = document.createElement("div")),
        (window.text_debugger.style.fontSize = "3vh"),
        (window.text_debugger.style.position =
          "absolute"),
        (window.text_debugger.style.bottom = "0"),
        (window.text_debugger.style.left = "0"),
        (window.text_debugger.style.color = "white"),
        document.body.appendChild(window.text_debugger)),
      (window.text_debugger.textContent = text));
  }
  #onDeviceOrientation(event) {

    if (!wTracker.isStarted) {
      return;
    }
    if (event.webkitCompassHeading) {
      wTracker.compassHeading = event.webkitCompassHeading;
    } else {
      if ("AbsoluteOrientationSensor" in window) {
      } else
        wTracker.compassHeading = wTracker.calculateCompassHeading(
          event.alpha,
          event.beta,
          event.gamma,
        );
    }
    return;
    if (!wTracker.angles) {
      ((wTracker.START_ALPHA = -wTracker.compassHeading),
        (wTracker.START_ORIENTATION = window.orientation || 0),
        (wTracker.angles = {}));
    }
    if (wTracker.isPortrait())
      var alpha = event.alpha,
        beta = event.beta,
        gamma = event.gamma;
    else {
      if (wTracker.isLandscapeLeft())
        var alpha = event.alpha,
          beta = -1 * event.gamma,
          gamma = event.beta;
      else {
        if (wTracker.isLandscapeRight())
          var alpha = event.alpha,
            beta = event.gamma,
            gamma = -1 * event.beta;
      }
    }
    ((wTracker.angles.alpha = alpha),
      (wTracker.angles.beta = beta),
      (wTracker.angles.gamma = gamma));
    return;
  }
  #onDeviceMotion(event) {

    if (!wTracker.isStarted) return;
    var iosFactor = wTracker.isIOS() ? 1 : -1;
    ((wTracker.GX = event.accelerationIncludingGravity.x * iosFactor),
      (wTracker.GY = event.accelerationIncludingGravity.y * iosFactor),
      (wTracker.GZ = event.accelerationIncludingGravity.z * iosFactor));
    if (wTracker.#currentBeta == null) {
      if (wTracker.USE_COMPASS)
        var currentHeading = wTracker.compassHeading;
      else
        var currentHeading = wTracker.compassHeading - wTracker.START_ALPHA;
    } else {
      var currentHeading = wTracker.#currentBeta;
    }
    currentHeading = ((currentHeading % 360) + 360) % 360;
    var headingDiff = Math.abs(
      (wTracker.compassHeading - currentHeading) % 360,
    );
    headingDiff = headingDiff > 180 ? 360 - headingDiff : headingDiff;
    if (wTracker.#deviceFlipped) {
      if (wTracker.USE_COMPASS)
        var currentHeading = wTracker.compassHeading;
      else {
        var currentHeading =
          wTracker.compassHeading - wTracker.START_ALPHA;
      }
      ((wTracker.driftFwdCounter = 0), (wTracker.ABRUPT_ROT_DETECTED = ![]));
    }
    var deviceQuat = wTracker.#combineCompassWithGravity(currentHeading);
    if (
      !wTracker.#deviceQuat &&
      Date.now() - wTracker.startTime > 3000
    ) {
      ((wTracker.#deviceQuat = new QuaternionW()), (wTracker.#deviceQuat = deviceQuat));
    }
    if (!wTracker.#deviceQuat) {
      return;
    }
    if (wTracker.START_ALPHA == null) {
      wTracker.START_ALPHA = wTracker.compassHeading;
      return;
    }
    var prevRotMat = wTracker.#deviceQuat.getRotMat(),
      currRotMat = deviceQuat.getRotMat(),
      prevForward = new cv.Mat(3, 1, cv.CV_32F);
    ((prevForward.data32F[0] = prevRotMat.data32F[3]),
      (prevForward.data32F[1] = prevRotMat.data32F[4]),
      (prevForward.data32F[2] = prevRotMat.data32F[5]));
    var currForward = new cv.Mat(3, 1, cv.CV_32F);
    ((currForward.data32F[0] = currRotMat.data32F[3]),
      (currForward.data32F[1] = currRotMat.data32F[4]),
      (currForward.data32F[2] = currRotMat.data32F[5]));
    var rotationDiff = 1 - prevForward.dot(currForward),
      identityMat = new QuaternionW(1, 0, 0, 0).getRotMat(),
      identityForward = new cv.Mat(3, 1, cv.CV_32F);
    ((identityForward.data32F[0] = identityMat.data32F[3]),
      (identityForward.data32F[1] = identityMat.data32F[4]),
      (identityForward.data32F[2] = identityMat.data32F[5]));
    var upDiff = 1 - identityForward.dot(currForward),
      downVector = new cv.Mat(3, 1, cv.CV_32F);
    ((downVector.data32F[0] = -identityMat.data32F[6]),
      (downVector.data32F[1] = -identityMat.data32F[7]),
      (downVector.data32F[2] = -identityMat.data32F[8]));
    var downDiff = 1 - downVector.dot(currForward),
      isFlipped = upDiff < 0.1 || downDiff < 0.1;
    ((wTracker.#deviceFlipped = isFlipped),
      prevRotMat["delete"](),
      currRotMat["delete"](),
      prevForward["delete"](),
      currForward["delete"]());
    if (rotationDiff > wTracker.#rotThresholdAlpha) {

      if (!wTracker.driftUpCounter) wTracker.driftUpCounter = 0;
      (wTracker.driftUpCounter++,
        wTracker.driftUpCounter > 20 &&
        ((wTracker.#deviceQuat = deviceQuat), (wTracker.driftUpCounter = 0)));
    } else {
      (wTracker.driftUpCounter--,
        (wTracker.driftUpCounter =
          wTracker.driftUpCounter < 0
            ? 0
            : wTracker.driftUpCounter));
    }
    var rotRate = event.rotationRate;
    wTracker.rotationRate = rotRate;
    var timeDelta = 0;
    wTracker.lastMotionUpdateTime &&
      (timeDelta =
        (Date.now() - wTracker.lastMotionUpdateTime) / 1000);
    wTracker.lastMotionUpdateTime = Date.now();
    if (wTracker.isPortrait()) {
      var rotAlpha = rotRate.alpha * timeDelta,
        rotBeta = rotRate.beta * timeDelta,
        rotGamma = rotRate.gamma * timeDelta;
    } else {
      if (wTracker.isLandscapeLeft())
        var rotAlpha = -1 * rotRate.beta * timeDelta,
          rotBeta = rotRate.alpha * timeDelta,
          rotGamma = rotRate.gamma * timeDelta;
      else {
        if (wTracker.isLandscapeRight())
          var rotAlpha = rotRate.beta * timeDelta,
            rotBeta = -1 * rotRate.alpha * timeDelta,
            rotGamma = rotRate.gamma * timeDelta;
      }
    }
    if (!rotAlpha || !rotBeta || !rotGamma) {
      ((rotAlpha = 0), (rotBeta = 0), (rotGamma = 0));
    }
    var avgRotation =
      (Math.abs(rotAlpha) +
        Math.abs(rotBeta) +
        Math.abs(rotGamma)) /
      3;
    wTracker.#avgRotMagnitude = avgRotation;
    if (wTracker.#avgRotMagnitude > 3) {
      ((wTracker.LAST_ABRUPT_ROT_TIME = Date.now()),
        (wTracker.ABRUPT_ROT_DETECTED = !![]));
    }
    var rotQuat = new QuaternionW();
    ((rotBeta *= -1),
      (rotAlpha *= -1),
      rotQuat.setFromAngles(rotGamma, rotBeta, rotAlpha));
    wTracker.#deviceQuat = wTracker.#deviceQuat.mul(rotQuat);
    var beta = wTracker.#deviceQuat.getBeta();
    wTracker.#currentBeta = beta;
  }
  #calcGravityQuat() {

    gravity = Math.sqrt(
      wTracker.GX * wTracker.GX +
      wTracker.GY * wTracker.GY +
      wTracker.GZ * wTracker.GZ,
    );
    if (wTracker.isPortrait())
      var beta =
        ((Math.asin(wTracker.GX / gravity) * 180) /
          Math.PI) *
        -1,
        gamma =
          ((Math.atan(wTracker.GY / wTracker.GZ) * 180) /
            Math.PI) *
          -1;
    else {
      if (wTracker.isLandscapeLeft())
        var beta =
          (Math.asin(wTracker.GY / gravity) * 180) /
          Math.PI,
          gamma =
            (Math.atan((-1 * wTracker.GX) / wTracker.GZ) * 180) /
            Math.PI;
      else {
        if (wTracker.isLandscapeRight()) {
          var beta =
            ((Math.asin(wTracker.GY / gravity) * 180) /
              Math.PI) *
            -1,
            gamma =
              ((Math.atan(
                (-1 * wTracker.GX) / wTracker.GZ,
              ) *
                180) /
                Math.PI) *
              -1;
        }
      }
    }
    if (wTracker.GZ < 0) gamma += 90;
    else gamma -= 90;
    var gravityQuat = new QuaternionW();
    return (gravityQuat.setFromAngles(beta, 0, gamma), gravityQuat);
  }
  #combineCompassWithGravity(compassHeading) {

    gravityQuat = this.#calcGravityQuat(),
      headingQuat = new QuaternionW(),
      heading = compassHeading;
    return (
      headingQuat.setFromAngles(0, heading, 0),
      (gravityQuat = headingQuat.mul(gravityQuat)),
      gravityQuat
    );
  }
  handleCompass(event) {

    const matrix = event.target.absoluteMatrix;
    var heading = wTracker.quaternionToHeading(
      event.target.quaternion,
    );
    ((heading = ((heading % 360) + 360) % 360),
      (wTracker.compassHeading = heading));
  }
  quaternionToHeading(quat) {

    let [w, x, y, z] = quat,
      heading =
        Math.atan2(
          2 * w * x + 2 * y * z,
          1 - 2 * x * x - 2 * y * y,
        ) *
        (180 / Math.PI);
    if (heading < 0) heading = 360 + heading;
    return (360 - heading).toFixed(1);
  }
  startGPS() {
    return new Promise((resolveGps, rejectGps) => {

      "geolocation" in navigator
        ? navigator.geolocation.getCurrentPosition(
          (position) => {
            (resolveGps(position), (wTracker.GPSStarted = !![]));
          },
          (error) => {
            rejectGps(
              "Error\x20getting\x20GPS\x20position:\x20" +
              error.message,
            );
          },
          { enableHighAccuracy: !![] },
        )
        : rejectGps("Geolocation is not available in this browser.");
    });
  }
  getGPSPosition() {

    if (wTracker.GPSStarted)
      navigator.geolocation.getCurrentPosition(
        (position) => {

          var gpsStr =
            position.coords.accuracy +
            "," +
            position.coords.altitude +
            "," +
            position.coords.altitudeAccuracy +
            "," +
            position.coords.heading +
            "," +
            position.coords.latitude +
            "," +
            position.coords.longitude +
            "," +
            position.coords.speed +
            "," +
            wTracker.START_ALPHA +
            ",";
          window.unityInstance.SendMessage(
            wTracker.TRACKER_NAME,
            "OnGPSPosition",
            gpsStr,
          );
        },
        (error) => {
          window.unityInstance.SendMessage(
            wTracker.TRACKER_NAME,
            "OnGPSPositionError",
            "Error getting GPS position: " + error.message,
          );
        },
        { enableHighAccuracy: !![] },
      );
    else {
      window.unityInstance.SendMessage(
        wTracker.TRACKER_NAME,
        "OnGPSPositionError",
        "Error getting GPS position: not started",
      );
    }
  }
  async waitForGPSToStart() {

    while (!wTracker.GPSStarted) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async subscribeToGPSPositionChanges() {

    await this.waitForGPSToStart();
    wTracker.gpsWatchId = navigator.geolocation.watchPosition(
      (position) => {
        gpsStr =
          position.coords.accuracy +
          "," +
          position.coords.altitude +
          "," +
          position.coords.altitudeAccuracy +
          "," +
          position.coords.heading +
          "," +
          position.coords.latitude +
          "," +
          position.coords.longitude +
          "," +
          position.coords.speed +
          "," +
          wTracker.START_ALPHA +
          ",";
        window.unityInstance.SendMessage(
          wTracker.TRACKER_NAME,
          "OnGPSPosition",
          gpsStr,
        );
      },
      (error) => {
        window.unityInstance.SendMessage(
          wTracker.TRACKER_NAME,
          "OnGPSPositionError",
          "Error getting GPS position: " + error.message,
        );
      },
      { enableHighAccuracy: !![] },
    );
  }
  unsubscribeToGPSPositionChanges() {

    if (wTracker.gpsWatchId) {
      navigator.geolocation.clearWatch(wTracker.gpsWatchId);
    }
  }
  calculateCompassHeadingFromRotMat(rotMat) {

    const m0 = rotMat[0],
      m1 = rotMat[1];
    var heading = Math.atan2(m1, m0);
    return (
      (heading *= 180 / Math.PI),
      (heading = ((heading % 360) + 360) % 360),
      heading
    );
  }
  calculateCompassHeading(alpha, beta, gamma) {

    alphaRad = alpha * (Math.PI / 180),
      betaRad = beta * (Math.PI / 180),
      gammaRad = gamma * (Math.PI / 180),
      cosAlpha = Math.cos(alphaRad),
      sinAlpha = Math.sin(alphaRad),
      cosBeta = Math.cos(betaRad),
      sinBeta = Math.sin(betaRad),
      cosGamma = Math.cos(gammaRad),
      sinGamma = Math.sin(gammaRad),
      numerator = -cosAlpha * sinGamma - sinAlpha * sinBeta * cosGamma,
      denominator = -sinAlpha * sinGamma + cosAlpha * sinBeta * cosGamma,
      z = -cosBeta * cosGamma,
      heading = Math.atan(numerator / denominator);
    if (denominator < 0) heading += Math.PI;
    else numerator < 0 && (heading += 2 * Math.PI);
    return ((heading *= 180 / Math.PI), heading);
  }
  #round3(value) {
    return Math.round(value * 1000) / 1000;
  }
  #clamp(value, min, max) {

    return Math.min(
      Math.max(value, min),
      max,
    );
  }
  #lineIntersect(
    x1,
    y1,
    x2,
    y2,
    x3,
    y3,
    x4,
    y4,
  ) {

    if (
      (x1 === x2 && y1 === y2) ||
      (x3 === x4 && y3 === y4)
    ) {

      return ![];
    }
    let denom =
      (y4 - y3) * (x2 - x1) -
      (x4 - x3) * (y2 - y1);
    if (denom === 0) {

      return ![];
    }
    let t =
      ((x4 - x3) * (y1 - y3) -
        (y4 - y3) * (x1 - x3)) /
      denom,
      u =
        ((x2 - x1) * (y1 - y3) -
          (y2 - y1) * (x1 - x3)) /
        denom,
      px = x1 + t * (x2 - x1),
      py = y1 + t * (y2 - y1);
    return { x: px, y: py };
  }
  #weightedPercentile(values, weights, percentile) {

    const sortedByWeight = values.map((val, idx) => [
      val,
      weights[idx],
    ])
      .sort(
        (a, b) => a[1] - b[1],
      )
      .slice(
        0,
        Math.ceil(percentile * values.length),
      )
      .map((item) => item[0])
      .sort((a, b) => a - b);
    var stdev = this.stdev(sortedByWeight);
    if (stdev < 0.001) {

      const mid = Math.floor(sortedByWeight.length / 2);
      return sortedByWeight.length % 2
        ? sortedByWeight[mid]
        : (sortedByWeight[mid - 1] + sortedByWeight[mid]) / 2;

    } else {
      let closest = sortedByWeight[0];
      return (
        sortedByWeight.forEach((val) => {
          if (
            Math.abs(val - 1) <
            Math.abs(closest - 1)
          )
            closest = val;
        }),
        closest
      );
    }
  }
  #median(arr) {

    const mid = Math.floor(arr.length / 2),
      sorted = [...arr].sort(
        (a, b) => a - b,
      );
    return arr.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  average(arr) {

    arr.reduce(
      (sum, val) => sum + val,
    ) / arr.length;
  }
  stdev(arr) {

    const n = arr.length,
      mean =
        arr.reduce((sum, val) => sum + val) /
        n;
    return (
      arr.map((val) =>
        Math.pow(val - mean, 2),
      ).reduce((sum, val) => sum + val) /
      n
    );
  }
  weightedMean(
    values,
    otherValues,
    xArray,
    yArray,
    targetX,
    targetY,
  ) {

    weightSum = 0,
      weightedSum1 = 0,
      weightedSum2 = 0;
    for (
      var i = 0;
      i < values.length;
      i++
    ) {

      var xi = xArray[i],
        yi = yArray[i],
        dx = targetX - xi,
        dy = targetY - yi,
        distSq = dx * dx + dy * dy,
        weight = 1 / Math.pow(distSq, 100);
      ((weightedSum1 += values[i] * weight),
        (weightedSum2 += otherValues[i] * weight),
        (weightSum += weight));
    }
    return { ddx: weightedSum1 / weightSum, ddy: weightedSum2 / weightSum };
  }
  #f064(param1, param2, xArray, yArray, targetX, targetY) {
    let indices = [],
      distances = [Infinity, Infinity, Infinity];
    for (let i = 0; i < xArray.length; i++) {
      var xi = xArray[i],
        yi = yArray[i],
        dx = targetX - xi,
        dy = targetY - yi,
        distSq = dx * dx + dy * dy;
      if (distSq < distances[0])
        ((distances[2] = distances[1]),
          (distances[1] = distances[0]),
          (distances[0] = distSq),
          (indices[2] = indices[1]),
          (indices[1] = indices[0]),
          (indices[0] = i));
      else {
        if (distSq < distances[1])
          ((distances[2] = distances[1]),
            (distances[1] = distSq),
            (indices[2] = indices[1]),
            (indices[1] = i));
        else
          distSq < distances[2] &&
            ((distances[2] = distSq), (indices[2] = i));
      }
    }
    var x0 = xArray[indices[0]],
      y0 = yArray[indices[0]],
      d0Sq =
        (targetX - x0) * (targetX - x0) +
        (targetY - y0) * (targetY - y0),
      x1 = xArray[indices[1]],
      y1 = yArray[indices[1]],
      d1Sq =
        (targetX - x1) * (targetX - x1) +
        (targetY - y1) * (targetY - y1),
      x2 = xArray[indices[2]],
      y2 = yArray[indices[2]],
      d2Sq =
        (targetX - x2) * (targetX - x2) +
        (targetY - y2) * (targetY - y2),
      a = 2 * x1 - 2 * x0,
      b = 2 * y1 - 2 * y0,
      c =
        d0Sq * d0Sq -
        d1Sq * d1Sq -
        x0 * x0 +
        x1 * x1 -
        y0 * y0 +
        y1 * y1,
      d = 2 * x2 - 2 * x1,
      e = 2 * y2 - 2 * y1,
      f =
        d1Sq * d1Sq -
        d2Sq * d2Sq -
        x1 * x1 +
        x2 * x2 -
        y1 * y1 +
        y2 * y2,
      centerX =
        (c * e - f * b) /
        (e * a - b * d),
      centerY =
        (c * d - a * f) /
        (b * d - a * e),
      centerPoint = new cv.Point(centerX, centerY);
    return { ddx: centerX - targetX, ddy: centerY - targetY };
  }
  isPortrait() {

    return !window.orientation || window.orientation === 0;
  }
  isLandscape() {
    return window.orientation === 90 || window.orientation === -90;
  }
  isLandscapeLeft() {

    return window.orientation === 90;
  }
  isLandscapeRight() {

    return window.orientation === -90;
  }
  isIOS() {

    return (
      [
        "iPad\x20Simulator",
        "iPhone Simulator",
        "iPod\x20Simulator",
        "iPad",
        "iPhone",
        "iPod",
      ].includes(navigator.platform) ||
      (navigator.userAgent.includes("Mac") &&
        "ontouchend" in document)
    );
  }
  #initKalmanFilter() {

    ((this.#kalmanState = {}),
      (this.#kalmanState.kf = new cv.KalmanFilter(12, 4, 0, cv.CV_32F)),
      (this.#kalmanState.state = new cv.Mat(
        12,
        1,
        cv.CV_32F,
      )),
      (this.#kalmanState.meas = new cv.Mat(
        4,
        1,
        cv.CV_32F,
      )),
      this.#updateKalmanTransition(this.#kalmanState.kf, 1 / this.FRAMERATE),
      (this.#kalmanState.kf.measurementMatrix = cv.matFromArray(
        4,
        12,
        cv.CV_32F,
        [
          1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
          0, 0, 0, 0, 0, 0,
        ],
      )),
      (this.#kalmanState.kf.processNoiseCov = this.#initProcessNoiseMat()),
      (this.#kalmanState.kf.measurementNoiseCov = this.#initMeasurementNoiseMat()),
      this.#kalmanState.state.copyTo(
        this.#kalmanState.kf.statePre,
      ),
      this.#kalmanState.state.copyTo(
        this.#kalmanState.kf.statePost,
      ),
      (this.#kalmanState.hasPrediction = ![]));
  }
  #resetKalmanFilter() {

    (this.#kalmanState.kf.errorCovPre["delete"](),
      (this.#kalmanState.kf.errorCovPre = this.#initProcessNoiseMat()),
      (this.#kalmanState.state = cv.matFromArray(
        12,
        1,
        cv.CV_32F,
        [
          this.#kalmanState.meas.data32F[0],
          this.#kalmanState.meas.data32F[1],
          this.#kalmanState.meas.data32F[2],
          this.#kalmanState.meas.data32F[3],
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ],
      )),
      this.#kalmanState.kf.statePost["delete"](),
      this.#kalmanState.kf.statePre["delete"](),
      this.#kalmanState.state.copyTo(
        this.#kalmanState.kf.statePost,
      ),
      this.#kalmanState.state.copyTo(
        this.#kalmanState.kf.statePre,
      ),
      (this.#kalmanState.hasPrediction = ![]));
  }
  #predictKalman(deltaTime) {

    (this.#updateKalmanTransition(deltaTime),
      this.#kalmanState.state["delete"](),
      (this.#kalmanState.state = this.#kalmanState.kf.predict()));
    var quatW = this.#kalmanState.state.data32F[0],
      quatI = this.#kalmanState.state.data32F[1],
      quatJ = this.#kalmanState.state.data32F[2],
      quatK = this.#kalmanState.state.data32F[3],
      magnitude = Math.sqrt(
        quatW * quatW +
        quatI * quatI +
        quatJ * quatJ +
        quatK * quatK,
      );
    return (
      (magnitude = magnitude <= 0 ? 1 : magnitude),
      (quatW /= magnitude),
      (quatI /= magnitude),
      (quatJ /= magnitude),
      (quatK /= magnitude),
      { w: quatW, i: quatI, j: quatJ, k: quatK }
    );
  }
  #correctKalman(w, i, j, k) {

    if (this.lastw) {
      var diffW = this.lastw - w,
        diffI = this.lasti - i,
        diffJ = this.lastj - j,
        diffK = this.lastk - k;
      (diffW * diffW > 1 ||
        diffI * diffI > 1 ||
        diffJ * diffJ > 1 ||
        diffK * diffK > 1) &&
        ((w *= -1),
          (i *= -1),
          (j *= -1),
          (k *= -1));
    }
    ((this.lastw = w),
      (this.lasti = i),
      (this.lastj = j),
      (this.lastk = k));
    if (!this.#kalmanState.hasPrediction) {
      (this.#kalmanState.state["delete"](),
        (this.#kalmanState.state = cv.matFromArray(
          12,
          1,
          cv.CV_32F,
          [
            w,
            i,
            j,
            k,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
        )),
        this.#kalmanState.kf.statePre["delete"](),
        this.#kalmanState.state.copyTo(
          this.#kalmanState.kf.statePre,
        ),
        this.#kalmanState.kf.statePost["delete"](),
        this.#kalmanState.state.copyTo(
          this.#kalmanState.kf.statePost,
        ));
      this.lastw = null;
    }
    ((this.#kalmanState.meas.data32F[0] = w),
      (this.#kalmanState.meas.data32F[1] = i),
      (this.#kalmanState.meas.data32F[2] = j),
      (this.#kalmanState.meas.data32F[3] = k),
      this.#kalmanState.kf.correct(this.#kalmanState.meas),
      (this.#kalmanState.hasPrediction = !![]));
  }
  #updateKalmanTransition(deltaTime) {

    kf = this.#kalmanState.kf,
      halfDeltaSq = 0.5 * deltaTime * deltaTime;
    ((kf.transitionMatrix.data32F[4] = deltaTime),
      (kf.transitionMatrix.data32F[17] = deltaTime),
      (kf.transitionMatrix.data32F[30] = deltaTime),
      (kf.transitionMatrix.data32F[43] = deltaTime),
      (kf.transitionMatrix.data32F[56] = deltaTime),
      (kf.transitionMatrix.data32F[69] = deltaTime),
      (kf.transitionMatrix.data32F[82] = deltaTime),
      (kf.transitionMatrix.data32F[95] = deltaTime),
      (kf.transitionMatrix.data32F[8] = halfDeltaSq),
      (kf.transitionMatrix.data32F[21] = halfDeltaSq),
      (kf.transitionMatrix.data32F[34] = halfDeltaSq),
      (kf.transitionMatrix.data32F[47] = halfDeltaSq));
  }
  #initProcessNoiseMat() {

    posNoise = 0.001,
      velNoise = 0.001,
      accelNoise = 0.001;
    return cv.matFromArray(12, 12, cv.CV_32F, [
      posNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      posNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      posNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      posNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      velNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      velNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      velNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      velNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      accelNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      accelNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      accelNoise,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      accelNoise,
    ]);
  }
  #initMeasurementNoiseMat() {

    smoothFactor = this.ANGLE_SMOOTH_FACTOR ? this.ANGLE_SMOOTH_FACTOR : 0.001;
    return cv.matFromArray(4, 4, cv.CV_32F, [
      smoothFactor,
      0,
      0,
      0,
      0,
      smoothFactor,
      0,
      0,
      0,
      0,
      smoothFactor,
      0,
      0,
      0,
      0,
      smoothFactor,
    ]);
  }
  #worldToLocal(worldPos, transform) {

    localPos = new Vector3W();
    localPos.setValues(
      (worldPos.x - transform.position.x) /
      transform.scale.x,
      (worldPos.y - transform.position.y) /
      transform.scale.y,
      (worldPos.z - transform.position.z) /
      transform.scale.z,
    );
    var invRot = transform.rotation.getInv();
    invRot.norm();
    var rotatedPos = invRot.mulVector(localPos);
    return rotatedPos;
  }
  #screenToWorld(screenPos) {

    camPos = this.#cameraPosition,
      camRot = this.#cameraOrientation,
      fov = arCamera.FOV,
      aspect = window.innerWidth / window.innerHeight,
      halfFovTan =
      Math.tan((fov * 0.5 * 3.1416) / 180) *
      screenPos.z,
      halfWidth = halfFovTan * aspect,
      worldX = (screenPos.x - 0.5) * 2 * halfWidth,
      worldY = (screenPos.y - 0.5) * 2 * halfFovTan,
      localDir = new Vector3W(worldX, worldY, screenPos.z),
      worldPoint = camPos.add(camRot.mulVector(localDir));
    return worldPoint;
  }
  #worldToScreen(worldPos) {

    camPos = this.#cameraPosition,
      camRot = this.#cameraOrientation,
      fov = arCamera.FOV,
      aspect = window.innerWidth / window.innerHeight,
      invCamRot = camRot.getInv(),
      localPos = invCamRot.mulVector(
        worldPos.add(camPos.mul_constant(-1)),
      ),
      halfFovTan =
      Math.tan((fov * 0.5 * 3.1416) / 180) * localPos.z,
      halfWidth = halfFovTan * aspect,
      screenX = localPos.x / (2 * halfWidth) + 0.5,
      screenY = localPos.y / (2 * halfFovTan) + 0.5;
    return new Vector3W(screenX, screenY, localPos.z);
  }
}
class Vector3W {
  constructor(x = 0, y = 0, z = 0) {
    ((this.x = x), (this.y = y), (this.z = z));
  }
  setValues(x, y, z) {
    ((this.x = x), (this.y = y), (this.z = z));
  }
  add(other) {
    var result = new Vector3W(
      this.x + other.x,
      this.y + other.y,
      this.z + other.z,
    );
    return result;
  }
  mul_constant(scalar) {
    var result = new Vector3W(
      this.x * scalar,
      this.y * scalar,
      this.z * scalar,
    );
    return result;
  }
  norm() {

    magnitude = Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z,
    ),
      normalized = new Vector3W(
        this.x / magnitude,
        this.y / magnitude,
        this.z / magnitude,
      );
    return normalized;
  }
  cross(other) {
    var self = this;
    return new Vector3W(
      self.y * other.z - self.z * other.y,
      self.z * other.x - self.x * other.z,
      self.x * other.y - self.y * other.x,
    );
  }
  dot(other) {
    var self = this;
    return (
      self.x * other.x +
      self.y * other.y +
      self.z * other.z
    );
  }
}
class QuaternionW {
  constructor(
    w = 1,
    i = 0,
    j = 0,
    k = 0,
  ) {
    ((this.w = w),
      (this.i = i),
      (this.j = j),
      (this.k = k));
  }
  setValues(w, i, j, k) {
    ((this.w = w),
      (this.i = i),
      (this.j = j),
      (this.k = k));
  }
  setFromAngles(alpha, beta, gamma) {

    const cosAlpha = Math.cos(
      ((gamma * Math.PI) / 180) * 0.5,
    ),
      sinAlpha = Math.sin(((gamma * Math.PI) / 180) * 0.5),
      cosBeta = Math.cos(((beta * Math.PI) / 180) * 0.5),
      sinBeta = Math.sin(
        ((beta * Math.PI) / 180) * 0.5,
      ),
      cosGamma = Math.cos(
        ((alpha * Math.PI) / 180) * 0.5,
      ),
      sinGamma = Math.sin(
        ((alpha * Math.PI) / 180) * 0.5,
      );
    ((this.w =
      cosAlpha * cosBeta * cosGamma + sinAlpha * sinBeta * sinGamma),
      (this.i =
        sinAlpha * cosBeta * cosGamma - cosAlpha * sinBeta * sinGamma),
      (this.j =
        cosAlpha * sinBeta * cosGamma + sinAlpha * cosBeta * sinGamma),
      (this.k =
        cosAlpha * cosBeta * sinGamma - sinAlpha * sinBeta * cosGamma));
  }
  getEulerAngles() {

    alpha =
      (Math.atan2(
        2 * (this.j * this.k + this.k * this.i),
        this.k * this.k -
        this.i * this.i -
        this.j * this.j +
        this.k * this.k,
      ) *
        180) /
      Math.PI,
      beta =
      (Math.asin(
        -2 * (this.i * this.k - this.k * this.j),
      ) *
        180) /
      Math.PI,
      gamma =
      (Math.atan2(
        2 * (this.i * this.j + this.k * this.k),
        this.k * this.k +
        this.i * this.i -
        this.j * this.j -
        this.k * this.k,
      ) *
        180) /
      Math.PI;
    return { aa: alpha, bb: beta, gg: gamma };
  }
  getAlpha() {

    const sinValue = 2 * (this.w * this.k + this.i * this.j),
      cosValue = 1 - 2 * (this.j * this.j + this.k * this.k),
      alpha =
        (Math.atan2(sinValue, cosValue) * 180) / Math.PI;
    return alpha;
  }
  getBeta() {

    const sinValue = 2 * (this.w * this.j - this.k * this.i);
    let beta;
    if (Math.abs(sinValue) >= 1) {
      beta = Math.sign(sinValue) * 90;
    } else {
      beta = (Math.asin(sinValue) * 180) / Math.PI;
    }
    return beta;
  }
  getGamma() {

    const sinValue = 2 * (this.w * this.i + this.j * this.k),
      cosValue = 1 - 2 * (this.i * this.i + this.j * this.j),
      gamma =
        (Math.atan2(sinValue, cosValue) * 180) / Math.PI;
    return gamma;
  }
  getRotMat() {

    w = this.w,
      i = this.i,
      j = this.j,
      k = this.k,
      rotMat = cv.matFromArray(3, 3, cv.CV_32F, [
        w * w +
        i * i +
        j * j +
        k * k,
        2 * (i * j - w * k),
        2 * (i * k + w * j),
        2 * (i * j + w * k),
        w * w -
        i * i +
        j * j -
        k * k,
        2 * (j * k - w * i),
        2 * (i * k - w * j),
        2 * (j * k + w * i),
        w * w -
        i * i -
        j * j +
        k * k,
      ]);
    return rotMat;
  }
  mul(other) {

    result = this.mul_dont_normalize(other);
    return (result.norm(), result);
  }
  mul_dont_normalize(other) {
    var w1 = this.w,
      i1 = this.i,
      j1 = this.j,
      k1 = this.k,
      w2 = other.w,
      i2 = other.i,
      j2 = other.j,
      k2 = other.k,
      result = new QuaternionW(
        w1 * w2 -
        i1 * i2 -
        j1 * j2 -
        k1 * k2,
        i1 * w2 +
        w1 * i2 +
        j1 * k2 -
        k1 * j2,
        w1 * j2 -
        i1 * k2 +
        j1 * w2 +
        k1 * i2,
        w1 * k2 +
        i1 * j2 -
        j1 * i2 +
        k1 * w2,
      );
    return result;
  }
  norm() {

    magnitude = Math.sqrt(
      this.w * this.w +
      this.i * this.i +
      this.j * this.j +
      this.k * this.k,
    );
    ((this.w /= magnitude),
      (this.i /= magnitude),
      (this.j /= magnitude),
      (this.k /= magnitude));
  }
  getInv() {
    var invQuat = new QuaternionW(
      this.w,
      -1 * this.i,
      -1 * this.j,
      -1 * this.k,
    );
    return invQuat;
  }
  mulVector(vector) {

    vecQuat = new QuaternionW(
      0,
      vector.x,
      vector.y,
      vector.z,
    ),
      invQuat = this.getInv(),
      result = this.mul_dont_normalize(vecQuat);
    result = result.mul_dont_normalize(invQuat);
    var resultVec = new Vector3W(
      result.i,
      result.j,
      result.k,
    );
    return resultVec;
  }
  getRightVector() {

    rightVec = new Vector3W(1, 0, 0),
      rotated = this.mulVector(rightVec);
    return ((rotated = rotated.norm()), rotated);
  }
  getUpVector() {

    upVec = new Vector3W(0, 1, 0),
      rotated = this.mulVector(upVec);
    return ((rotated = rotated.norm()), rotated);
  }
  getForwardVector() {

    forwardVec = new Vector3W(0, 0, 1),
      rotated = this.mulVector(forwardVec);
    return ((rotated = rotated.norm()), rotated);
  }
}
