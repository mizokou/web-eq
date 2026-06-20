/** Web Audio API・音源入力・再生 */
async function resumeAudioContext() {
  ensureAudio();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function ensureAudio() {
  if (audioContext) return;
  audioContext = new AudioContext({ latencyHint: "interactive" });
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  masterGain = audioContext.createGain();
  
  // ノーマライズ用GainNodeとProcessorの初期化
  normalizeGainNode = audioContext.createGain();
  normalizeProcessor = audioContext.createScriptProcessor(2048, 1, 1);
  normalizeProcessor.onaudioprocess = function(e) {
    const input = e.inputBuffer.getChannelData(0);
    if (!normalizeOn) {
      currentNormalizeGain = 1.0;
      normalizeGainNode.gain.setValueAtTime(1.0, audioContext.currentTime);
      return;
    }
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i];
    }
    const rms = Math.sqrt(sum / input.length);
    if (rms > 0.01) {
      const targetGain = targetRMS / rms;
      // 急激な音量変化を防ぐため、滑らかに追従(ローパスフィルタ処理)
      currentNormalizeGain += (targetGain - currentNormalizeGain) * 0.05;
      // 極端な増幅をクリップ（最大4倍、最小0.2倍までに制限）
      currentNormalizeGain = Math.max(0.2, Math.min(4.0, currentNormalizeGain));
    }
    normalizeGainNode.gain.setValueAtTime(currentNormalizeGain, audioContext.currentTime);
  };

  limiter = audioContext.createDynamicsCompressor();
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = .003;
  limiter.release.value = .22;
  
  // ルーティング構築: masterGain -> normalizeGainNode -> limiter -> analyser -> destination
  masterGain.connect(normalizeGainNode);
  normalizeGainNode.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(audioContext.destination);

  // 音量解析用にmasterGainからProcessorへも接続
  masterGain.connect(normalizeProcessor);
  normalizeProcessor.connect(audioContext.destination);

  applyLimiter();
  applyOutputGain();
  rebuildFilters();
}

function rebuildFilters() {
  if (!audioContext) return;
  filters = bands.map(band => {
    const filter = audioContext.createBiquadFilter();
    filter.type = band.on && !bypass ? band.type : "allpass";
    filter.frequency.value = band.freq;
    filter.gain.value = effectiveGain(band.gain);
    filter.Q.value = band.q;
    return filter;
  });
}

function wireSource(node) {
  if (bypass) {
    node.connect(masterGain);
    return;
  }
  let current = node;
  filters.forEach(filter => {
    current.connect(filter);
    current = filter;
  });
  current.connect(masterGain);
}

function wireMonitorSource(node) {
  wireSource(node);
}

function getSelectedInputDeviceId() {
  return audioInputSelect.value || null;
}

function getInputDeviceLabel(deviceId) {
  if (!deviceId) return "Default input";
  const option = [...audioInputSelect.options].find(item => item.value === deviceId);
  return option ? option.textContent : "Audio input";
}

async function unlockInputDeviceLabels() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  let tempStream;
  try {
    tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (error) {
    return false;
  } finally {
    if (tempStream) tempStream.getTracks().forEach(track => track.stop());
  }
}

async function refreshAudioInputDevices(requestPermission = false) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    status.textContent = "Error: Audio device listing is not supported in this browser.";
    return;
  }

  const previousSelection = audioInputSelect.value;
  if (requestPermission) {
    const granted = await unlockInputDeviceLabels();
    if (!granted) {
      status.textContent = "Microphone permission is required to list audio interfaces.";
      return;
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter(device => device.kind === "audioinput");

  audioInputSelect.innerHTML = `<option value="">Audio input…</option>`;
  inputs.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Input ${index + 1}`;
    audioInputSelect.appendChild(option);
  });

  if (previousSelection && inputs.some(device => device.deviceId === previousSelection)) {
    audioInputSelect.value = previousSelection;
  }

  if (!inputs.length) {
    status.textContent = "No audio input devices found. Connect an audio interface and refresh.";
  } else if (inputs.some(device => !device.label) && !requestPermission) {
    status.textContent = `${inputs.length} input device(s) found. Click ↻ to show device names.`;
  } else {
    status.textContent = `${inputs.length} audio input device(s) ready. Select one and press Live In.`;
  }
}

function buildInputConstraints(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 }
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}

async function startAudioInput() {
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Error: Live audio input is not supported in this browser.";
    return;
  }

  await resumeAudioContext();
  stop();
  if (monitoring) stopMonitor();

  const deviceId = getSelectedInputDeviceId();
  try {
    inputStream = await navigator.mediaDevices.getUserMedia(buildInputConstraints(deviceId));
  } catch (error) {
    if (deviceId) {
      try {
        inputStream = await navigator.mediaDevices.getUserMedia(buildInputConstraints(null));
        audioInputSelect.value = "";
      } catch (fallbackError) {
        status.textContent = "Error: Could not open the selected audio interface.";
        console.error("Audio input failed:", fallbackError);
        return;
      }
    } else {
      status.textContent = "Error: Could not open audio input. Check device connection and permissions.";
      console.error("Audio input failed:", error);
      return;
    }
  }

  const [track] = inputStream.getAudioTracks();
  if (!track) {
    inputStream.getTracks().forEach(t => t.stop());
    inputStream = null;
    status.textContent = "Error: Selected device has no audio input track.";
    return;
  }

  rebuildFilters();
  inputSource = audioContext.createMediaStreamSource(inputStream);
  wireMonitorSource(inputSource);
  inputActive = true;
  liveDraw = true;
  liveInputButton.classList.add("active");
  liveInputButton.textContent = "Disconnect";

  const activeDeviceId = track.getSettings().deviceId;
  if (activeDeviceId && audioInputSelect.value !== activeDeviceId) {
    await refreshAudioInputDevices(false);
    audioInputSelect.value = activeDeviceId;
  }

  status.textContent = `Live input active: ${getInputDeviceLabel(activeDeviceId || deviceId)}. Instrument signal is running through the EQ.`;
  track.addEventListener("ended", stopAudioInput, { once: true });
  draw();
}

function stopAudioInput() {
  if (inputSource) {
    try { inputSource.disconnect(); } catch (e) {}
  }
  if (inputStream) inputStream.getTracks().forEach(track => track.stop());
  inputSource = null;
  inputStream = null;
  inputActive = false;
  liveInputButton.classList.remove("active");
  liveInputButton.textContent = "Live In";
  if (!monitoring && !playing) {
    liveDraw = false;
    status.textContent = "Live input disconnected.";
  }
  if (audioContext) {
    try { analyser.connect(audioContext.destination); } catch (e) {}
  }
  draw();
}

function updateAudioParams() {
  if (!audioContext || filters.length !== bands.length) return;
  bands.forEach((band, i) => {
    const filter = filters[i];
    filter.type = band.on && !bypass ? band.type : "allpass";
    filter.frequency.setTargetAtTime(band.freq, audioContext.currentTime, .015);
    filter.gain.setTargetAtTime(effectiveGain(band.gain), audioContext.currentTime, .015);
    filter.Q.setTargetAtTime(band.q, audioContext.currentTime, .015);
  });
  applyOutputGain();
}

function applyOutputGain() {
  if (!masterGain || !audioContext) return;
  masterGain.gain.setTargetAtTime(dbToGain(Number(outputGain.value)), audioContext.currentTime, .01);
}

function applyLimiter() {
  if (!limiter || !audioContext) return;
  const now = audioContext.currentTime;
  limiter.threshold.setTargetAtTime(limiterOn ? Number(limiterThreshold.value) : 0, now, .01);
  limiter.knee.setTargetAtTime(limiterOn ? 3 : 0, now, .01);
  limiter.ratio.setTargetAtTime(limiterOn ? 20 : 1, now, .01);
  limiter.attack.setTargetAtTime(limiterOn ? .003 : .02, now, .01);
  limiter.release.setTargetAtTime(limiterOn ? .22 : .08, now, .01);
}

async function startMonitor() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    status.textContent = "Error: System monitor not supported by this browser.";
    return;
  }
  await resumeAudioContext();
  stop();
  if (inputActive) stopAudioInput();
  try {
    monitorStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      systemAudio: "include",
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: true
      }
    });
  } catch (error) {
    status.textContent = "Monitoring request cancelled.";
    return;
  }

  if (!monitorStream.getAudioTracks().length) {
    monitorStream.getTracks().forEach(track => track.stop());
    monitorStream = null;
    status.textContent = "Error: Check 'Share System Audio'.";
    return;
  }

  rebuildFilters();
  monitorSource = audioContext.createMediaStreamSource(monitorStream);
  wireMonitorSource(monitorSource);
  monitoring = true;
  liveDraw = true;
  monitorButton.classList.add("active");
  monitorButton.textContent = "Disconnect";
  status.textContent = "Monitoring system audio stream...";

  monitorStream.getTracks().forEach(track => {
    track.addEventListener("ended", stopMonitor, { once: true });
  });
}

function stopMonitor() {
  if (monitorSource) {
    try { monitorSource.disconnect(); } catch (e) {}
  }
  if (monitorStream) monitorStream.getTracks().forEach(track => track.stop());
  monitorSource = null;
  monitorStream = null;
  monitoring = false;
  monitorButton.classList.remove("active");
  monitorButton.textContent = "Monitor";
  if (!inputActive && !playing) {
    liveDraw = false;
    status.textContent = "Stream disconnected.";
  }
  if (audioContext) {
    try { analyser.connect(audioContext.destination); } catch (e) {}
  }
  draw();
}

async function loadAudioFile(file) {
  if (!file) return;

  try {
    await resumeAudioContext();
    if (monitoring) stopMonitor();
    if (inputActive) stopAudioInput();
    stop();

    status.textContent = `Decoding: ${file.name}...`;
    const bytes = await file.arrayBuffer();
    buffer = await audioContext.decodeAudioData(bytes.slice(0));

    pausedAt = 0;
    loadFileButton.classList.add("loaded");
    loadFileButton.textContent = truncateFileName(file.name);
    loadFileButton.title = file.name;
    status.textContent = `Loaded: ${file.name} — tap Play to start.`;
  } catch (error) {
    buffer = null;
    loadFileButton.classList.remove("loaded");
    loadFileButton.textContent = "Load File";
    loadFileButton.title = "Load audio file from device";
    status.textContent = `Error: Could not decode "${file.name}". Try MP3, M4A, or WAV.`;
    console.error("Audio decode failed:", error);
  }
}

function truncateFileName(name, maxLen = 14) {
  if (name.length <= maxLen) return name;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const baseMax = maxLen - ext.length - 1;
  return `${name.slice(0, Math.max(4, baseMax))}…${ext}`;
}

async function play() {
  if (!buffer) {
    status.textContent = "Please load an audio file (Load File).";
    return;
  }
  await resumeAudioContext();
  if (monitoring) stopMonitor();
  if (inputActive) stopAudioInput();
  try { analyser.connect(audioContext.destination); } catch (e) {}
  if (playing) {
    pausedAt = audioContext.currentTime - startedAt;
    sourceNode.stop();
    playing = false;
    playButton.textContent = "Play";
    return;
  }
  sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = buffer;
  rebuildFilters();
  wireSource(sourceNode);
  sourceNode.start(0, pausedAt % buffer.duration);
  startedAt = audioContext.currentTime - pausedAt;
  playing = true;
  liveDraw = true;
  playButton.textContent = "Pause";
  sourceNode.onended = () => {
    if (playing) stop();
  };
}

function stop() {
  if (sourceNode && playing) sourceNode.stop();
  pausedAt = 0;
  playing = false;
  playButton.textContent = "Play";
}