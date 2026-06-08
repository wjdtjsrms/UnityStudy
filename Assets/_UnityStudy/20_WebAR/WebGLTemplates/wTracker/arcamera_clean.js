class ARCamera {
    #updateIntervalId;
    SUBSCRIBED_TRACKERS;

    constructor(unityCanvas, videoCanvas) {
        this.unityCanvas = unityCanvas;
        this.videoCanvas = videoCanvas;
        this.video_ctx = this.videoCanvas.getContext('2d');
        this.UNITY_VIDEOPLANE = false;
        this.RESIZE_DELAY = 50;
        this.FRAMERATE = 30;
        this.SUBSCRIBED_TRACKERS = [];
        this.maxFrameSize = 300;

        this.videoCapture = document.createElement('canvas');
        this.videoCapture.id = 'videoCapture';
        document.body.appendChild(this.videoCapture);
        this.capture_ctx = this.videoCapture.getContext('2d');
        this.videoCapture.style.position = 'absolute';
        this.videoCapture.style.top = '200%';
        this.videoCapture.style.zIndex = '-100';

        this.setFrameSize(this.maxFrameSize);
        this.usingUnityVideoPlane = false;
        this.onStartResizeCallbacks = [];
        this.onFinishedResizeCallbacks = [];
        this.lastOrientation = window.matchMedia('(orientation: portrait)').matches
            ? 'PORTRAIT'
            : 'LANDSCAPE';

        window.addEventListener('resize', this.resizeWithDelay, true);
    }

    setFlipped(flipped) {
        this.videoCanvas.style.transform = flipped ? 'scaleX(-1)' : '';
        window.unityInstance.SendMessage(
            'ARCamera',
            'SetFlippedMessage',
            flipped ? 'true' : 'false'
        );
    }

    pauseCamera() {
        this.cameraPaused = true;
        this.VIDEO.pause();
    }

    unpauseCamera() {
        this.cameraPaused = false;
        this.VIDEO.play();
    }

    setARCameraSettings(jsonString) {
        var settings = JSON.parse(jsonString);
        Object.keys(settings).forEach(key => {
            if (key in this && this[key] != settings[key]) {
                this[key] = settings[key];
            }
        });
    }

    async startWebcam(video) {
        this.VIDEO = video;
        try {
            await video.play();

            if (!this.videoCapture) {
                return Promise.reject(
                    'videoCapture canvas is null. Please call new ARCamera(unityCanvas, videoCapture) properly before starting the Webcam'
                );
            }
            if (!this.unityCanvas) {
                return Promise.reject(
                    'unityCanvas is null. Please call new ARCamera(unityCanvas, videoCapture) properly before starting the Webcam'
                );
            }

            this.resizeCanvas();
            this.lastMatchTrackTime = Date.now();
            this.lastDetectTime = Date.now();
            this.lastUpdateTime = Date.now();
            this.#updateIntervalId = setInterval(
                this.#update,
                (1 / this.FRAMERATE) * 1000
            );
            this.isCameraStarted = true;
            return Promise.resolve();
        } catch (err) {
            return Promise.reject(err);
        }
    }

    stopWebcam() {
        const tracks = this.VIDEO.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        this.VIDEO.srcObject = null;
        clearInterval(this.#updateIntervalId);
    }

    #update() {
        if (arCamera.cameraPaused) return;
        if (!arCamera.VIDEO) return;

        var video = arCamera.VIDEO;
        var captureCanvas = arCamera.videoCapture;
        var displayCanvas = arCamera.videoCanvas;

        // Draw video to capture canvas (for AI/tracker processing)
        var capScaleX = captureCanvas.width / video.videoWidth;
        var capScaleY = captureCanvas.height / video.videoHeight;
        var capScale = Math.max(capScaleX, capScaleY);
        var capOffsetX = (captureCanvas.width - video.videoWidth * capScale) / 2;
        var capOffsetY = (captureCanvas.height - video.videoHeight * capScale) / 2;

        arCamera.capture_ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
        arCamera.capture_ctx.setTransform(capScale, 0, 0, capScale, capOffsetX, capOffsetY);
        arCamera.capture_ctx.drawImage(arCamera.VIDEO, 0, 0);

        // Draw video to display canvas (visible background) if not using Unity video plane
        if (!arCamera.UNITY_VIDEOPLANE) {
            displayCanvas.width = window.innerWidth;
            displayCanvas.height = window.innerHeight;

            var dispScaleX = displayCanvas.width / video.videoWidth;
            var dispScaleY = displayCanvas.height / video.videoHeight;
            var dispScale = Math.max(dispScaleX, dispScaleY);
            var dispOffsetX = (displayCanvas.width - video.videoWidth * dispScale) / 2;
            var dispOffsetY = (displayCanvas.height - video.videoHeight * dispScale) / 2;

            arCamera.video_ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
            arCamera.video_ctx.setTransform(dispScale, 0, 0, dispScale, dispOffsetX, dispOffsetY);
            arCamera.video_ctx.drawImage(arCamera.VIDEO, 0, 0);
        }

        // Notify Unity of new video texture if callback is set
        if (arCamera.updateUnityVideoTextureCallback) {
            arCamera.updateUnityVideoTextureCallback();
        }

        // Notify all subscribed trackers to process the new frame
        arCamera.SUBSCRIBED_TRACKERS.forEach(tracker => {
            tracker.update();
        });
    }

    subscribeToWebcamUpdates(tracker) {
        if (this.SUBSCRIBED_TRACKERS.includes(tracker)) return;
        this.SUBSCRIBED_TRACKERS.push(tracker);
    }

    setFrameSize(size) {
        this.maxFrameSize = size;
        var captureCanvas = this.videoCapture;
        var video = this.VIDEO;
        if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;

        const scale = Math.min(
            this.maxFrameSize / video.videoWidth,
            this.maxFrameSize / video.videoHeight
        );
        captureCanvas.width = scale * video.videoWidth;
        captureCanvas.height = scale * video.videoHeight;
    }

    setFramerate(fps) {
        this.FRAMERATE = fps;
        clearInterval(this.#updateIntervalId);
        this.#updateIntervalId = setInterval(
            this.#update,
            (1 / this.FRAMERATE) * 1000
        );
    }

    resizeWithDelay(event) {
        if (event != null && event.target != window) return;
        if (!arCamera.unityCanvas.parentElement || !arCamera.unityCanvas.parentElement.style) return;
        if (arCamera.isResizing) return;

        arCamera.isResizing = true;

        // Notify trackers that resize has started
        arCamera.SUBSCRIBED_TRACKERS.forEach(tracker => {
            tracker.onStartResize();
        });

        var delay = arCamera.RESIZE_DELAY;
        var checkInterval = 10;
        var stableCount = 0;

        setTimeout(() => {
            arCamera.debounceStartTime = Date.now();
            arCamera.debounceInnerWidth = window.innerWidth;
            arCamera.debounceInnerHeight = window.innerHeight;

            arCamera.debounceInterval = setInterval(() => {
                // Check if window dimensions have stabilized
                if (
                    arCamera.debounceInnerWidth == window.innerWidth &&
                    arCamera.debounceInnerHeight == window.innerHeight
                ) {
                    stableCount++;
                } else {
                    arCamera.debounceInnerWidth = window.innerWidth;
                    arCamera.debounceInnerHeight = window.innerHeight;
                    stableCount = 0;
                }

                // After 5 stable checks, finalize the resize
                if (stableCount >= 5) {
                    arCamera.resizeCanvas();

                    var parent = arCamera.unityCanvas.parentElement;

                    // Force a layout recalculation by toggling display
                    setTimeout(() => {
                        parent.style.display = 'none';
                    }, 5);
                    setTimeout(() => {
                        parent.style.display = '';
                    }, 50);
                    setTimeout(() => {
                        arCamera.SUBSCRIBED_TRACKERS.forEach(tracker => {
                            tracker.onFinishedResize();
                        });
                        arCamera.isResizing = false;
                    }, 100);

                    clearInterval(arCamera.debounceInterval);
                }
            }, checkInterval);
        }, delay);
    }

    resizeCanvas() {
        if (!window.arCamera) window.arCamera = this;

        var captureCanvas = this.videoCapture;
        var video = this.VIDEO;
        if (!captureCanvas || !video || video.videoWidth <= 0 || video.videoHeight <= 0) return;

        this.setFrameSize(this.maxFrameSize);

        // Notify trackers of new capture dimensions
        this.SUBSCRIBED_TRACKERS.forEach(tracker => {
            tracker.setCamDims(captureCanvas.width, captureCanvas.height);
        });

        this.#updateFOV();

        // Send video resolution to Unity
        window.unityInstance.SendMessage(
            'ARCamera',
            'Resize',
            video.videoWidth + ',' + video.videoHeight
        );

        // Detect and send orientation changes to Unity
        var orientation = window.matchMedia('(orientation: portrait)').matches
            ? 'PORTRAIT'
            : 'LANDSCAPE';
        if (this.lastOrientation != orientation) {
            window.unityInstance.SendMessage('ARCamera', 'SetOrientationMessage', orientation);
            this.lastOrientation = orientation;
        }
    }

    #updateFOV() {
        var video = this.VIDEO;
        if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;

        var screenAspect = window.innerWidth / window.innerHeight;
        var videoAspect = video.videoWidth / video.videoHeight;

        this.unityCanvas.style.width = '100%';
        this.unityCanvas.style.height = '100%';

        // Calculate vertical FOV so the video fills the screen
        var halfTan = 0.5 / Math.max(videoAspect, screenAspect);
        var distance = 1;
        var fov = 2 * Math.atan(halfTan / distance) * 180 / Math.PI;

        this.FOV = fov;
        if (window.unityInstance) {
            window.unityInstance.SendMessage('ARCamera', 'SetCameraFov', fov);
        }
    }

    getCameraTexture(format) {
        return this.videoCapture.toDataURL(format);
    }

    getVideoDims() {
        return this.VIDEO.videoWidth + ',' + this.VIDEO.videoHeight;
    }
}
