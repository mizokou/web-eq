/** イベント処理・メーター・ヘルプ・初期化 */
function liveVisualLoop() {
  if (liveDraw && analyser && (monitoring || inputActive || playing)) draw();
  requestAnimationFrame(liveVisualLoop);
}

function meterLoop() {
  if (analyser) {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    
    const isClipping = (rms > 0.354); 

    const pct = Math.min(100, rms * 185);
    
    if (isClipping) {
      meterL.classList.add("clip");
      meterR.classList.add("clip");
    } else {
      meterL.classList.remove("clip");
      meterR.classList.remove("clip");
    }

    if (window.matchMedia("(max-width: 860px)").matches) {
      meterL.style.width = `${pct}%`;
      meterR.style.width = `${Math.max(0, pct - 4)}%`;
      meterL.style.height = "auto";
      meterR.style.height = "auto";
    } else {
      meterL.style.height = `${pct}%`;
      meterR.style.height = `${Math.max(0, pct - 4)}%`;
      meterL.style.width = "auto";
      meterR.style.width = "auto";
    }
  }
  requestAnimationFrame(meterLoop);
}

bandPanel.addEventListener("input", event => {
  const target = event.target;
  const index = Number(target.dataset.band);
  const field = target.dataset.field;
  if (!Number.isFinite(index) || !field) return;
  if (field === "type") bands[index][field] = target.value;
  else bands[index][field] = Number(target.value);
  updateTexts();
  updateAudioParams();
  draw();
});

bandPanel.addEventListener("click", event => {
  const button = event.target.closest(".band-toggle");
  if (!button) return;
  const index = Number(button.dataset.band);
  bands[index].on = !bands[index].on;
  button.classList.toggle("on", bands[index].on);
  updateAudioParams();
  draw();
});

presetSelect.addEventListener("change", event => {
  bands = JSON.parse(JSON.stringify(presets[event.target.value]));
  renderBands();
  updateAudioParams();
  draw();
});

loadFileButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  await loadAudioFile(file);
  event.target.value = "";
});

refreshInputsButton.addEventListener("click", () => {
  refreshAudioInputDevices(true);
});

audioInputSelect.addEventListener("change", async () => {
  if (!inputActive) return;
  stopAudioInput();
  await startAudioInput();
});

liveInputButton.addEventListener("click", () => {
  if (inputActive) stopAudioInput();
  else startAudioInput();
});

if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    refreshAudioInputDevices(false);
  });
}

monitorButton.addEventListener("click", () => {
  if (monitoring) stopMonitor();
  else startMonitor();
});

playButton.addEventListener("click", play);
stopButton.addEventListener("click", stop);
outputGain.addEventListener("input", () => {
  updateTexts();
  applyOutputGain();
});
eqSensitivity.addEventListener("input", () => {
  updateTexts();
  updateAudioParams();
  draw();
});
limiterThreshold.addEventListener("input", () => {
  updateTexts();
  applyLimiter();
});
limiterToggle.addEventListener("click", () => {
  limiterOn = !limiterOn;
  limiterToggle.classList.toggle("active-on", limiterOn);
  limiterToggle.textContent = limiterOn ? "ON" : "OFF";
  updateTexts();
  applyLimiter();
  status.textContent = limiterOn ? "Limiter safety protection active." : "Limiter bypassed.";
});
normalizeToggle.addEventListener("click", () => {
  ensureAudio();
  normalizeOn = !normalizeOn;
  normalizeToggle.classList.toggle("active-on", normalizeOn);
  normalizeToggle.textContent = normalizeOn ? "ON" : "OFF";
  status.textContent = normalizeOn ? "Auto-Normalize enabled (Targeting stable RMS)." : "Auto-Normalize disabled.";
});
powerButton.addEventListener("click", () => {
  bypass = !bypass;
  powerButton.classList.toggle("off", bypass);
  status.textContent = bypass ? "EQ Bypassed (Direct Out)." : "DSP Equalizer Engaged.";
  updateAudioParams();
  draw();
});

// MOUSE / POINTER EVENT ON GRAPH
graph.addEventListener("pointerdown", event => {
  const rect = graph.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (graph.width / rect.width);
  const y = (event.clientY - rect.top) * (graph.height / rect.height);
  
  const nearest = bands
    .map((band, index) => {
      const bx = freqToX(band.freq);
      const by = graph.height * (.5 - (band.type.includes("pass") ? 0 : effectiveGain(band.gain)) / 72);
      return { index, dist: Math.hypot(x - bx, y - by) };
    })
    .sort((a, b) => a.dist - b.dist)[0];
  
  if (nearest.dist < 45) {
    dragging = nearest.index;
    selectedBandIndex = nearest.index;
    graph.focus();
    graph.setPointerCapture(event.pointerId);
    draw();
  }
});

graph.addEventListener("pointermove", event => {
  if (dragging === null) return;
  const rect = graph.getBoundingClientRect();
  const rawX = (event.clientX - rect.left) * (graph.width / rect.width);
  const rawY = (event.clientY - rect.top) * (graph.height / rect.height);
  
  const band = bands[dragging];
  band.freq = Math.round(xToFreq(rawX));
  if (!band.type.includes("pass")) band.gain = Number(yToGain(rawY).toFixed(1));
  
  syncSliders(dragging);
  updateTexts();
  updateAudioParams();
  draw();
});

graph.addEventListener("pointerup", event => {
  dragging = null;
  graph.releasePointerCapture(event.pointerId);
  draw();
});

// キーボードの十字キー操作
graph.addEventListener("keydown", event => {
  const band = bands[selectedBandIndex];
  if (!band) return;

  let stepFreq = 1;
  let stepGain = 0.1;

  if (event.shiftKey) {
    stepFreq = 20;
    stepGain = 1.0;
  }

  switch (event.key) {
    case "ArrowLeft":
      band.freq = Math.max(20, band.freq - stepFreq);
      event.preventDefault();
      break;
    case "ArrowRight":
      band.freq = Math.min(20000, band.freq + stepFreq);
      event.preventDefault();
      break;
    case "ArrowUp":
      if (!band.type.includes("pass")) {
        band.gain = Math.min(30, Number((band.gain + stepGain).toFixed(1)));
      }
      event.preventDefault();
      break;
    case "ArrowDown":
      if (!band.type.includes("pass")) {
        band.max = Math.max(-30, Number((band.gain - stepGain).toFixed(1)));
        band.gain = Math.max(-30, Number((band.gain - stepGain).toFixed(1)));
      }
      event.preventDefault();
      break;
    default:
      return;
  }

  syncSliders(selectedBandIndex);
  updateTexts();
  updateAudioParams();
  draw();
});

graph.addEventListener("focus", () => draw());
graph.addEventListener("blur", () => draw());

function openHelp() {
  helpBackdrop.classList.add("open");
  helpBackdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("help-open");
  helpCloseButton.focus();
}

function closeHelp() {
  helpBackdrop.classList.remove("open");
  helpBackdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("help-open");
  helpOpenButton.focus();
}

helpOpenButton.addEventListener("click", openHelp);
helpCloseButton.addEventListener("click", closeHelp);
helpBackdrop.addEventListener("click", event => {
  if (event.target === helpBackdrop) closeHelp();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && helpBackdrop.classList.contains("open")) {
    event.preventDefault();
    closeHelp();
  }
});

window.addEventListener("resize", setupCanvas);
renderBands();
setupCanvas();
refreshAudioInputDevices(false);
meterLoop();
liveVisualLoop();

