// Voice Reminder Plugin - Periodically speaks the current task title via Web Speech API

if (!window.speechSynthesis) {
  console.warn('[voice-reminder] Web Speech API not available. Plugin disabled.');
} else {
  // --- plugin body (runs only when speechSynthesis is available) ---

  var _vrInterval = null;
  var _vrCurrentTask = null;
  var _vrDefaultTtsRate = 0.7;

  var _vrDefaults = {
    isEnabled: false,
    text: 'Your current task is: ${currentTaskTitle}',
    interval: 300000,
    volume: 75,
    voice: '',
  };

  function _vrT(key, params) {
    return PluginAPI.translate(key, params);
  }

  async function _vrLoadConfig() {
    var raw = await PluginAPI.loadSyncedData();
    if (!raw) return Object.assign({}, _vrDefaults);
    try {
      return Object.assign({}, _vrDefaults, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, _vrDefaults);
    }
  }

  async function _vrSaveConfig(cfg) {
    await PluginAPI.persistDataSynced(JSON.stringify(cfg));
  }

  function _vrSpeak(text, volume, voiceName) {
    var synth = window.speechSynthesis;
    if (!synth) {
      console.error('[voice-reminder] No window.speechSynthesis available.');
      return;
    }

    synth.cancel();
    var voices = synth.getVoices();
    var utter = new SpeechSynthesisUtterance();
    utter.text = text;
    utter.voice =
      voices.find(function (v) {
        return voiceName && v.voiceURI === voiceName;
      }) ||
      voices.find(function (v) {
        return voiceName && v.name === voiceName;
      }) ||
      voices.find(function (v) {
        return v.default;
      }) ||
      null;
    utter.volume = volume / 100;
    utter.rate = _vrDefaultTtsRate;
    synth.speak(utter);
  }

  function _vrStopTimer() {
    if (_vrInterval) {
      clearInterval(_vrInterval);
      _vrInterval = null;
    }
  }

  async function _vrStartTimer() {
    _vrStopTimer();
    var cfg = await _vrLoadConfig();
    if (!cfg.isEnabled) return;

    var intervalMs = Math.max(cfg.interval || 300000, 5000);
    _vrInterval = setInterval(function () {
      if (!_vrCurrentTask) return;
      var txt = cfg.text.replace('${currentTaskTitle}', _vrCurrentTask.title);
      if (txt.length <= 1) {
        txt = _vrCurrentTask.title;
      }
      _vrSpeak(txt, cfg.volume, cfg.voice);
    }, intervalMs);
  }

  // Track current task via hook
  PluginAPI.registerHook('currentTaskChange', function (task) {
    _vrCurrentTask = task;
  });

  // Initial load and start
  _vrLoadConfig().then(function (cfg) {
    if (cfg.isEnabled) {
      _vrStartTimer();
    }
  });

  // Config dialog helpers
  function _vrEscapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _vrBuildVoiceOptions(voiceList, selectedVoice) {
    var opts =
      '<option value="">' + _vrEscapeHtml(_vrT('SETTINGS.VOICE_DEFAULT')) + '</option>';
    for (var i = 0; i < voiceList.length; i++) {
      var v = voiceList[i];
      var selected = v.voiceURI === selectedVoice ? ' selected' : '';
      opts +=
        '<option value="' +
        _vrEscapeHtml(v.voiceURI) +
        '"' +
        selected +
        '>' +
        _vrEscapeHtml(v.name) +
        '</option>';
    }
    return opts;
  }

  async function openVoiceReminderSettings() {
    var cfg = await _vrLoadConfig();

    var voices = [];
    if (window.speechSynthesis) {
      voices = window.speechSynthesis.getVoices();
    }
    var voiceOptions = _vrBuildVoiceOptions(voices, cfg.voice);

    var html =
      '<div style="padding:4px 0">' +
      '<p style="margin:0 0 16px;font-size:13px;opacity:0.7">' +
      _vrEscapeHtml(_vrT('SETTINGS.DESCRIPTION')) +
      '</p>' +
      '<div style="margin-bottom:16px">' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
      '<input type="checkbox" id="vr-enabled"' +
      (cfg.isEnabled ? ' checked' : '') +
      '>' +
      ' ' +
      _vrEscapeHtml(_vrT('SETTINGS.ENABLE')) +
      '</label>' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
      '<label for="vr-text" style="display:block;margin-bottom:4px;font-size:12px;opacity:0.7">' +
      _vrEscapeHtml(_vrT('SETTINGS.TEXT_LABEL')) +
      '</label>' +
      '<input type="text" id="vr-text" value="' +
      _vrEscapeHtml(cfg.text) +
      '" style="width:100%;box-sizing:border-box">' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
      '<label for="vr-interval" style="display:block;margin-bottom:4px;font-size:12px;opacity:0.7">' +
      _vrEscapeHtml(_vrT('SETTINGS.INTERVAL_LABEL')) +
      '</label>' +
      '<input type="number" id="vr-interval" value="' +
      _vrEscapeHtml(String(Math.round(cfg.interval / 1000))) +
      '" min="5" style="width:100px">' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
      '<label for="vr-volume" style="display:block;margin-bottom:4px;font-size:12px;opacity:0.7">' +
      _vrEscapeHtml(_vrT('SETTINGS.VOLUME_LABEL')) +
      '</label>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<input type="range" id="vr-volume" min="0" max="100" value="' +
      _vrEscapeHtml(String(cfg.volume)) +
      '" style="flex:1">' +
      '<span id="vr-volume-val" style="min-width:30px;text-align:right">' +
      _vrEscapeHtml(String(cfg.volume)) +
      '</span>' +
      '<button type="button" id="vr-test-btn" style="cursor:pointer">' +
      _vrEscapeHtml(_vrT('SETTINGS.TEST')) +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
      '<label for="vr-voice" style="display:block;margin-bottom:4px;font-size:12px;opacity:0.7">' +
      _vrEscapeHtml(_vrT('SETTINGS.VOICE_LABEL')) +
      '</label>' +
      '<select id="vr-voice" style="width:100%">' +
      voiceOptions +
      '</select>' +
      '</div>' +
      '</div>';

    PluginAPI.openDialog({
      title: _vrT('SETTINGS.TITLE'),
      htmlContent: html,
      buttons: [
        {
          label: _vrT('SETTINGS.CANCEL'),
          onClick: function () {},
        },
        {
          label: _vrT('SETTINGS.SAVE'),
          color: 'primary',
          icon: 'save',
          raised: true,
          onClick: function () {
            return saveSettings();
          },
        },
      ],
    });

    // Post-render setup
    setTimeout(function () {
      var volumeSlider = document.getElementById('vr-volume');
      var volumeVal = document.getElementById('vr-volume-val');
      if (volumeSlider && volumeVal) {
        volumeSlider.addEventListener('input', function () {
          volumeVal.textContent = volumeSlider.value;
        });
      }

      var testBtn = document.getElementById('vr-test-btn');
      if (testBtn) {
        testBtn.addEventListener('click', function () {
          var textInput = document.getElementById('vr-text');
          var voiceSelect = document.getElementById('vr-voice');
          var txt = textInput
            ? textInput.value.replace(
                '${currentTaskTitle}',
                _vrT('SETTINGS.TEST_PLACEHOLDER'),
              )
            : 'Test';
          if (txt.length <= 1) txt = _vrT('SETTINGS.TEST_NO_TEXT');
          var vol = volumeSlider ? parseInt(volumeSlider.value, 10) : 75;
          var voice = voiceSelect ? voiceSelect.value : '';
          _vrSpeak(txt, vol, voice);
        });
      }

      // Handle async voice loading on some platforms
      if (window.speechSynthesis && voices.length === 0) {
        window.speechSynthesis.addEventListener(
          'voiceschanged',
          function () {
            var newVoices = window.speechSynthesis.getVoices();
            var voiceSelect = document.getElementById('vr-voice');
            if (voiceSelect) {
              voiceSelect.innerHTML = _vrBuildVoiceOptions(newVoices, cfg.voice);
            }
          },
          { once: true },
        );
      }
    }, 100);

    async function saveSettings() {
      var enabledCb = document.getElementById('vr-enabled');
      var textInput = document.getElementById('vr-text');
      var intervalInput = document.getElementById('vr-interval');
      var volumeSlider = document.getElementById('vr-volume');
      var voiceSelect = document.getElementById('vr-voice');

      var newCfg = {
        isEnabled: enabledCb ? enabledCb.checked : false,
        text: textInput ? textInput.value : cfg.text,
        interval: intervalInput ? parseInt(intervalInput.value, 10) * 1000 : cfg.interval,
        volume: volumeSlider ? parseInt(volumeSlider.value, 10) : cfg.volume,
        voice: voiceSelect ? voiceSelect.value : cfg.voice,
      };

      await _vrSaveConfig(newCfg);
      await _vrStartTimer();

      PluginAPI.showSnack({
        msg: _vrT('SETTINGS.SAVED_MSG'),
        type: 'SUCCESS',
        ico: 'check',
      });
    }
  }

  // Register config handler for settings button on plugin card
  PluginAPI.registerConfigHandler(openVoiceReminderSettings);
} // end speechSynthesis guard
