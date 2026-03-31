// YouTube IFrame API wrapper
const YouTubePlayer = (() => {
  let player = null;
  let isReady = false;
  let onReadyCallback = null;
  let onEndCallback = null;
  let endTimeChecker = null;
  let currentEndTime = null;

  function loadAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      window.onYouTubeIframeAPIReady = resolve;
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }

  async function init(containerId, opts = {}) {
    await loadAPI();
    return new Promise((resolve) => {
      player = new YT.Player(containerId, {
        height: opts.height || '100%',
        width: opts.width || '100%',
        playerVars: {
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            isReady = true;
            resolve();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) {
              startEndTimeChecker();
            }
            if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
              stopEndTimeChecker();
            }
          },
        },
      });
    });
  }

  function startEndTimeChecker() {
    stopEndTimeChecker();
    if (currentEndTime == null) return;
    endTimeChecker = setInterval(() => {
      if (player && player.getCurrentTime && player.getCurrentTime() >= currentEndTime) {
        player.pauseVideo();
        stopEndTimeChecker();
        if (onEndCallback) onEndCallback();
      }
    }, 200);
  }

  function stopEndTimeChecker() {
    if (endTimeChecker) {
      clearInterval(endTimeChecker);
      endTimeChecker = null;
    }
  }

  function playClip(videoId, startTime, endTime, onEnd) {
    if (!player) return;
    currentEndTime = endTime;
    onEndCallback = onEnd || null;
    player.loadVideoById({
      videoId,
      startSeconds: startTime,
      endSeconds: endTime,
    });
  }

  function pause() {
    if (player) player.pauseVideo();
    stopEndTimeChecker();
  }

  function replay(startTime, endTime) {
    if (!player) return;
    currentEndTime = endTime;
    player.seekTo(startTime, true);
    player.playVideo();
  }

  function destroy() {
    stopEndTimeChecker();
    if (player) player.destroy();
    player = null;
    isReady = false;
  }

  return { init, playClip, pause, replay, destroy };
})();
