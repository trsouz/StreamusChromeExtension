﻿// This file runs within the YouTube page's sandbox rather than Streamus' sandbox.
// It has the ability to access variables on the page, but not Chrome APIs.
(function() {
  'use strict';

  // Disable YouTube's player resizing logic: https://github.com/YePpHa/YouTubeCenter/issues/1844
  // Run this before document ready so that YouTube's scripts read the modified value during initialization.
  window.matchMedia = null;

  // This is a heavy-handed approach for forcing YouTube to use the HTML5 player if possible.
  // By forcing canPlayType to return 'probably' YouTube will assume the browser supports HTML5 video.
  // This is necessary because other extensions and/or customer browsers mess with canPlayType and
  // prevent YouTube from loading HTML5.
  HTMLMediaElement.prototype.canPlayType = function() {
    return 'probably';
  };

  var PlayerAPI = function() {
    this.isReady = false;
    this.cuedVolumeCommands = 0;
    this.isNavigating = false;

    // TODO: This assumes that lodash has successfully loaded, but that seems like a race condition.
    // window.postMessage has an internal throttling mechanism which can cause a lot of issues for accurate data reporting.
    // For instance, if the volume is changing rapidly, incorrect volume values will leak out of postMessage.
    // Using an explicit throttling mechanism results in much more anticipated behavior.
    // 150 appears to be roughly the minimum possible throttle rate. 100 causes window.postMessage to throttle.
    var throttledWindowPostMessage = _.throttle(function(message) {
      window.postMessage(message, window.location.origin);
    }, 150);

    // TODO: I still need to be able to tell player what to do before it does anything without relying on the URL.
    var urlToVideoOptions = function(url) {
      var queryParameters = url.search.substr(1);

      var videoOptions = {};
      queryParameters.split('&').forEach(function(part) {
        var item = part.split('=');
        var key = item[0];
        var value = decodeURIComponent(item[1]);

        // Skip the 'streamus' query parameter because it's simply used for injecting content scripts.
        if (key !== 'streamus' && key !== 'v' && key !== 't') {
          switch (key) {
            case 'suggestedQuality':
              // suggestedQuality is already the appropriate type.
              break;
            case 'volume':
              value = parseInt(value, 10);
              break;
            case 'muted':
            case 'playOnActivate':
              value = value === 'true' ? true : false;
              break;
            default:
              throw new Error('Unhandled queryParameter: ' + key);
          }

          videoOptions[key] = value;
        }
      });

      return videoOptions;
    };

    var videoOptions = urlToVideoOptions(window.location);
    var playerApi = window.yt.player.getPlayerByElement('player-api');

    // If the player is initialized, set its volume to the given value.
    // Otherwise, record the value so that it can be used once the player is initializing.
    this.setVolume = function(volume) {
      if (this.isReady) {
        var currentVolume = playerApi.getVolume();

        if (currentVolume !== volume) {
          this.cuedVolumeCommands++;
          playerApi.setVolume(volume);
        }
      } else {
        videoOptions.volume = volume;
      }
    }.bind(this);

    // If the player is initialized, mute it.
    // Otherwise, record the muted state so that it can be used once the player is initializing.
    this.mute = function() {
      if (this.isReady) {
        var isMuted = playerApi.isMuted();

        if (!isMuted) {
          this.cuedVolumeCommands++;
          playerApi.mute();
        }
      } else {
        videoOptions.muted = muted;
      }
    }.bind(this);

    // If the player is initialized, unmute it.
    // Otherwise, record the unmuted state so that it can be used once the player is initializing.
    this.unMute = function() {
      if (this.isReady) {
        var isMuted = playerApi.isMuted();

        if (isMuted) {
          this.cuedVolumeCommands++;
          playerApi.unMute();
        }
      } else {
        videoOptions.muted = muted;
      }
    }.bind(this);

    // If the player is initialized, set the video's playback quality.
    // Otherwise, record the suggested quality so that it can be used once the player is initializing.
    this.setPlaybackQuality = function(suggestedQuality) {
      if (this.isReady) {
        playerApi.setPlaybackQuality(suggestedQuality);
      } else {
        videoOptions.suggestedQuality = suggestedQuality;
      }
    }.bind(this);

    // If the player is initialized, play its currently loaded video.
    // Otherwise, record the desire to play so that it can be used once the player is initializing.
    this.playVideo = function() {
      if (this.isReady && !this.isNavigating) {
        playerApi.playVideo();
      } else {
        videoOptions.playOnActivate = true;
      }
    }.bind(this);

    // If the player is initialized, pause its currently loaded video.
    // Otherwise, record the desire to pause so that it can be used once the player is initializing.
    this.pauseVideo = function() {
      if (this.isReady && !this.isNavigating) {
        playerApi.pauseVideo();
      } else {
        videoOptions.playOnActivate = false;
      }
    }.bind(this);

    // If the player is initialized, seek to a point in time on the video.
    // Otherwise, record the desired time so that it can be used once the player is initializing.
    this.seekTo = function(timeInSeconds) {
      if (this.isReady) {
        playerApi.seekTo(timeInSeconds);
      } else {
        // TODO: I need to either update the URL as well, or find a way to set startTime quickly.
        videoOptions.startTime = timeInSeconds;
      }
    }.bind(this);

    // https://youtube.github.io/spfjs/
    // Tell YouTube to navigate to another video via its URL
    this.navigate = function(urlString) {
      this.isNavigating = true;
      // Pause the video so that time doesn't tick + audio doesn't continue once navigation is happening.
      playerApi.pauseVideo();

      var url = new URL(urlString);
      videoOptions = urlToVideoOptions(url);
      window.spf.navigate(urlString);
    }.bind(this);

    // Receive messages from the sandboxed videoStreamView content script.
    this.onWindowMessage = function(message) {
      // Respond to navigation requests
      var navigate = message.data.navigate;
      if (navigate) {
        this.navigate(navigate.urlString);
      }

      // Respond to video command requests
      var videoCommand = message.data.videoCommand;
      if (videoCommand) {
        // videoCommands have a 1:1 correspondence with functions defined within this script.
        var videoCommandHandler = this[videoCommand];

        if (videoCommandHandler) {
          videoCommandHandler(message.data.value);
        } else {
          console.error('Unexpected videoCommand:', videoCommand);
        }
      }
    }.bind(this);

    // YouTube will fire an 'spfdone' event once it has successfully navigated to a video.
    // This event does not fire for the initial load of the first video. Only subsequent loads.
    this.onWindowSpfDone = function() {
      this.isNavigating = false;

      // Can't tell YouTube's player to pause prematurely. Need to wait for navigation to finish.
      if (!videoOptions.playOnActivate) {
        playerApi.pauseVideo();
      }
    }.bind(this);

    this.onError = function(error) {
      throttledWindowPostMessage({
        error: error
      });
    }.bind(this);

    this.onVolumeChange = function(state) {
      // It's important to keep track of cued commands because onVolumeChange is used for both muted and volume changes.
      // So, if volume and muted have both changed then the first 'onVolumeChange' event will contain an incorrect value.
      if (this.cuedVolumeCommands > 0) {
        this.cuedVolumeCommands--;
      }

      // Need to check document.hasFocus() to ensure that values aren't passed from Streamus to script back to Streamus.
      // Only pass values to Streamus when originating from user actions on the YouTube window.
      if (this.cuedVolumeCommands === 0 && document.hasFocus()) {
        throttledWindowPostMessage(state);
      }
    }.bind(this);

    this.onStateChange = function(state) {
      throttledWindowPostMessage({
        state: state
      });
    }.bind(this);

    // Once YouTube's API is ready to handle commands - initialize the video player's state.
    this.onReady = function() {
      this.initialize();
    }.bind(this);

    this.initialize = function() {
      this.isReady = true;

      // Configure various properties of the video so that it reflects desired state.
      if (!videoOptions.playOnActivate) {
        this.pauseVideo();
      }

      this.setVolume(videoOptions.volume);

      if (videoOptions.muted) {
        this.mute();
      } else {
        this.unMute();
      }

      this.setPlaybackQuality(videoOptions.suggestedQuality);

      // Ensure that when a song ends it doesn't auto-nav to the next one.
      // 1 is the enum used by YouTube for saying 'Autonav is disabled'
      playerApi.setAutonavState(1);

      throttledWindowPostMessage({
        volume: videoOptions.volume,
        muted: videoOptions.muted,
        // TODO: I worry this value might be incorrect if pauseVideo is still being processed.
        state: playerApi.getPlayerState(),
        // Detect whether user is using new YouTube layout which can be enabled via https://www.youtube.com/testtube
        // fexp is a list of enabled experimental features. One can check it to determine which features are enabled.
        isNewLayout: playerApi.getUpdatedConfigurationData().args.fexp.indexOf('9407675') !== -1
      });
    }.bind(this);

    playerApi.addEventListener('onStateChange', this.onStateChange);
    playerApi.addEventListener('onVolumeChange', this.onVolumeChange);
    playerApi.addEventListener('onError', this.onError);

    window.addEventListener('message', this.onWindowMessage);
    window.addEventListener('spfdone', this.onWindowSpfDone);

    if (playerApi.isReady()) {
      this.initialize();
    } else {
      playerApi.addEventListener('onReady', this.onReady);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      window.playerAPI = new PlayerAPI();
    });
  } else {
    window.playerAPI = new PlayerAPI();
  }
})();