﻿define(function() {
  'use strict';

  var TimeSlider = Backbone.Model.extend({
    defaults: {
      currentTime: 0,
      isBeingDragged: false,
      isEnabled: false,
      player: null
    },

    initialize: function() {
      var player = this.get('player');
      this._setEnabledState(player.get('loadedVideo'));
      this.listenTo(player, 'change:loadedVideo', this._onPlayerChangeLoadedVideo);
    },

    incrementCurrentTime: function(incrementValue) {
      var currentTime = this.get('currentTime');
      var incrementedCurrentTime = currentTime + incrementValue;
      this.set('currentTime', incrementedCurrentTime);

      return incrementedCurrentTime;
    },

    _onPlayerChangeLoadedVideo: function(model, loadedVideo) {
      this._setEnabledState(loadedVideo);
    },

    _setEnabledState: function(loadedVideo) {
      this.set('isEnabled', !_.isNull(loadedVideo));
    }
  });

  return TimeSlider;
});