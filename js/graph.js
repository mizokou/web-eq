/** EQ グラフ描画・バンド UI */
function freqToX(freq) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const innerWidth = graph.width - (GRAPH_PADDING_X * 2);
  const pct = (Math.log10(freq) - min) / (max - min);
  return GRAPH_PADDING_X + (pct * innerWidth);
}

function xToFreq(x) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const innerWidth = graph.width - (GRAPH_PADDING_X * 2);
  const pct = (x - GRAPH_PADDING_X) / innerWidth;
  const safePct = Math.max(0, Math.min(1, pct));
  return 10 ** (min + safePct * (max - min));
}

function gainToY(gain) {
  return graph.height * (.5 - effectiveGain(gain) / 72);
}

function yToGain(y) {
  const gain = ((.5 - y / graph.height) * 72) / Number(eqSensitivity.value);
  return Math.max(-30, Math.min(30, gain));
}

function effectiveGain(gain) {
  return gain * Number(eqSensitivity.value);
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

function formatFreq(freq) {
  return freq >= 1000 ? `${(freq / 1000).toFixed(freq < 10000 ? 1 : 0)} kHz` : `${Math.round(freq)} Hz`;
}

function setupCanvas() {
  const rect = graph.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  graph.width = Math.max(640, Math.round(rect.width * ratio));
  graph.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function graphSize() {
  return { w: graph.width / (window.devicePixelRatio || 1), h: graph.height / (window.devicePixelRatio || 1) };
}

function responseAt(freq, band) {
  if (!band.on) return 0;
  if (band.type === "highpass") {
    const ratio = freq / band.freq;
    return -24 / (1 + ratio ** (band.q * 5));
  }
  if (band.type === "lowpass") {
    const ratio = band.freq / freq;
    return -24 / (1 + ratio ** (band.q * 5));
  }
  if (band.type === "lowshelf") {
    return effectiveGain(band.gain) / (1 + (freq / band.freq) ** 2);
  }
  if (band.type === "highshelf") {
    return effectiveGain(band.gain) / (1 + (band.freq / freq) ** 2);
  }
  const oct = Math.log2(freq / band.freq);
  return effectiveGain(band.gain) * Math.exp(-0.5 * (oct * band.q * 1.7) ** 2);
}

function drawGrid(w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#16161a";
  ctx.fillRect(0, 0, w, h);

  // 細かい背景グリッド
  ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
  ctx.lineWidth = 0.5;
  for(let gx=0; gx<w; gx+=25) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  for(let gy=0; gy<h; gy+=25) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }

  // 周波数垂直線線の描画
  const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  ctx.font = "10px -apple-system, sans-serif";
  ctx.textBaseline = "top";
  freqs.forEach(freq => {
    const x = freqToX(freq) / (window.devicePixelRatio || 1);
    ctx.strokeStyle = freq === 1000 ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    
    ctx.fillStyle = "#8e8e93";
    ctx.textAlign = (freq === 20) ? "left" : (freq === 20000) ? "right" : "center";
    const textOffsetX = (freq === 20) ? 4 : (freq === 20000) ? -4 : 0;
    ctx.fillText(formatFreq(freq), x + textOffsetX, h - 16);
  });

  // dB水平線の描画
  [-24, -12, 0, 12, 24].forEach(gain => {
    const y = h * (.5 - gain / 72);
    ctx.strokeStyle = gain === 0 ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    
    ctx.fillStyle = gain === 0 ? "#fff" : "#8e8e93";
    ctx.textAlign = "left";
    ctx.fillText(`${gain > 0 ? "+" : ""}${gain}dB`, 8, y + 4);
  });
}
function drawLiveAnalysis(w, h) {
  if (!analyser || (!monitoring && !inputActive && !playing)) return;

  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(spectrum);
  ctx.save();
  
  const ratio = window.devicePixelRatio || 1;
  const padX = GRAPH_PADDING_X / ratio;

  // ==========================================
  // 1. 背景バーアナライザーの修正（対数マッピング）
  // ==========================================
  ctx.globalAlpha = .12;
  ctx.fillStyle = "#0a84ff";
  
  const bars = 64;
  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);

  for (let i = 0; i < bars; i++) {
    // バーの左端と右端の周波数を対数スケールで計算
    const pctL = i / bars;
    const pctR = (i + 1) / bars;
    
    const freqL = 10 ** (logMin + pctL * (logMax - logMin));
    const freqR = 10 ** (logMin + pctR * (logMax - logMin));

    // 周波数から正確なX座標を取得
    const xL = freqToX(freqL) / ratio;
    const xR = freqToX(freqR) / ratio;
    const barWidth = xR - xL;

    // Web Audio APIのインデックスに変換してその範囲の最大値（ピーク）を取得
    const sampleRate = audioContext.sampleRate;
    const idxL = Math.floor((freqL * analyser.fftSize) / sampleRate);
    const idxR = Math.ceil((freqR * analyser.fftSize) / sampleRate);
    
    let peak = 0;
    for (let j = idxL; j <= idxR; j++) {
      if (spectrum[j] > peak) peak = spectrum[j];
    }

    const barHeight = (peak / 255) * h * .5;
    // 右端まで隙間なく敷き詰めて描画
    ctx.fillRect(xL, h - barHeight, Math.max(1, barWidth - 0.5), barHeight);
  }

  // ==========================================
  // 2. 波形リアルタイムラインの修正（右端までフィット）
  // ==========================================
  // 波形リアルタイムライン
  const wave = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(wave);
  ctx.globalAlpha = .75;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#23f7d0";
  ctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    // 【修正】右端のパディング（余白）を無視して、Canvasの絶対的な右端（w）まで波形ラインを引き伸ばす
    const x = (i / (wave.length - 1)) * w;
    const y = h * .5 + ((wave[i] - 128) / 128) * h * .2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function draw() {
  const { w, h } = graphSize();
  drawGrid(w, h);
  drawLiveAnalysis(w, h);

  const points = [];
  const pixelWidth = w * (window.devicePixelRatio || 1);
  for (let i = 0; i <= pixelWidth; i++) {
    const freq = xToFreq(i);
    const gain = bands.reduce((sum, band) => sum + responseAt(freq, band), 0);
    points.push([i / (window.devicePixelRatio || 1), h * (.5 - Math.max(-36, Math.min(36, gain)) / 72)]);
  }

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = bypass ? "#48484a" : "#0a84ff";
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();

  bands.forEach((band, index) => {
    const x = freqToX(band.freq) / (window.devicePixelRatio || 1);
    const y = h * (.5 - (band.type.includes("pass") ? 0 : effectiveGain(band.gain)) / 72);
    
    ctx.fillStyle = band.on ? colors[index] : "#3a3a3c";
    
    if (selectedBandIndex === index && document.activeElement === graph) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3.0;
    } else {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1.5;
    }
    
    ctx.beginPath();
    const radius = (dragging === index || (selectedBandIndex === index && document.activeElement === graph)) ? 11 : 8;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = (band.type === "flat" || !band.on) ? "#fff" : "#000";
    if (!band.on) ctx.fillStyle = "#fff";
    ctx.font = "600 10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x, y);
  });
}

function syncSliders(bandIdx) {
  const band = bands[bandIdx];
  const panelGroup = bandPanel.children[bandIdx];
  if (!panelGroup) return;
  const fSlider = panelGroup.querySelector(`[data-field="freq"]`);
  const gSlider = panelGroup.querySelector(`[data-field="gain"]`);
  if (fSlider) fSlider.value = band.freq;
  if (gSlider) gSlider.value = band.gain;
}

function renderBands() {
  bandPanel.innerHTML = "";
  bands.forEach((band, index) => {
    const el = document.createElement("article");
    el.className = "band";
    el.style.setProperty("--knob-color", colors[index]);
    el.innerHTML = `
      <div class="band-head">
        <div class="band-name">
          <span class="dot" style="background:${colors[index]}"></span>
          CH ${index + 1}
        </div>
        <button class="band-toggle ${band.on ? "on" : ""}" title="Toggle band" data-band="${index}" data-action="toggle"></button>
      </div>
      <div class="type-row">
        <span>MODE</span>
        <select data-band="${index}" data-field="type">
          <option value="highpass">High Pass</option>
          <option value="lowshelf">Low Shelf</option>
          <option value="peaking">Peaking</option>
          <option value="highshelf">High Shelf</option>
          <option value="lowpass">Low Pass</option>
        </select>
      </div>
      <div class="control-grid">
        ${sliderMarkup(index, "freq", "FREQ", 20, 20000, band.freq)}
        ${sliderMarkup(index, "gain", "GAIN", -30, 30, band.gain)}
        ${sliderMarkup(index, "q", "Q", .2, 12, band.q)}
      </div>
    `;
    bandPanel.appendChild(el);
    el.querySelector("select").value = band.type;
  });
  updateTexts();
}

function sliderMarkup(index, field, label, min, max, value) {
  const step = field === "freq" ? 1 : .1;
  return `
    <div class="knob-cell">
      <label>${label}</label>
      <input class="slider" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-band="${index}" data-field="${field}">
      <div class="value" id="value-${index}-${field}"></div>
    </div>
  `;
}

function updateTexts() {
  bands.forEach((band, index) => {
    document.getElementById(`value-${index}-freq`).textContent = formatFreq(band.freq);
    document.getElementById(`value-${index}-gain`).textContent = band.type.includes("pass") ? "--" : `${band.gain > 0 ? "+" : ""}${band.gain.toFixed(1)} dB`;
    document.getElementById(`value-${index}-q`).textContent = band.q.toFixed(1);
  });
  outputText.textContent = `${Number(outputGain.value).toFixed(1)} dB`;
  eqSensitivityText.textContent = `x${Number(eqSensitivity.value).toFixed(1)}`;
  limiterText.textContent = limiterOn ? `${Number(limiterThreshold.value).toFixed(0)} dB` : "Off";
  readout.innerHTML = bands.map((band, i) => `<span class="pill">CH ${i + 1}: ${band.on ? formatFreq(band.freq) : "Off"}</span>`).join("");
}