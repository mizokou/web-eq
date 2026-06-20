/** プリセット定義と定数 */
const colors = ["#0a84ff", "#30d158", "#ffd60a", "#bf5af2"];
const presets = {
  flat: [
    { on: true, type: "lowshelf", freq: 100, gain: 0, q: .7 },
    { on: true, type: "peaking", freq: 450, gain: 0, q: 1 },
    { on: true, type: "peaking", freq: 2200, gain: 0, q: 1 },
    { on: true, type: "highshelf", freq: 9000, gain: 0, q: .7 }
  ],
  vocal: [
    { on: true, type: "highpass", freq: 85, gain: 0, q: .8 },
    { on: true, type: "peaking", freq: 280, gain: -2.5, q: 1.15 },
    { on: true, type: "peaking", freq: 3200, gain: 3.2, q: 1.05 },
    { on: true, type: "highshelf", freq: 10500, gain: 2.1, q: .7 }
  ],
  bass: [
    { on: true, type: "highpass", freq: 38, gain: 0, q: .7 },
    { on: true, type: "peaking", freq: 78, gain: 3.4, q: .9 },
    { on: true, type: "peaking", freq: 260, gain: -3.1, q: 1.1 },
    { on: true, type: "highshelf", freq: 6200, gain: 1, q: .7 }
  ],
  mix: [
    { on: true, type: "lowshelf", freq: 90, gain: 1.2, q: .7 },
    { on: true, type: "peaking", freq: 380, gain: -1.8, q: 1.2 },
    { on: true, type: "peaking", freq: 2600, gain: 1.4, q: .9 },
    { on: true, type: "highshelf", freq: 11800, gain: 1.8, q: .7 }
  ],
  air: [
    { on: true, type: "lowshelf", freq: 120, gain: -1, q: .7 },
    { on: true, type: "peaking", freq: 700, gain: -.8, q: 1 },
    { on: true, type: "peaking", freq: 4500, gain: 1.8, q: .85 },
    { on: true, type: "highshelf", freq: 13000, gain: 4.4, q: .65 }
  ],
  deepcut: [
    { on: true, type: "lowshelf", freq: 120, gain: 8, q: .7 },
    { on: true, type: "peaking", freq: 500, gain: -12, q: 1.8 },
    { on: true, type: "peaking", freq: 3000, gain: 9, q: 1.3 },
    { on: true, type: "highshelf", freq: 9000, gain: 7, q: .7 }
  ],
  telephone: [
    { on: true, type: "highpass", freq: 320, gain: 0, q: 1.1 },
    { on: true, type: "peaking", freq: 900, gain: 5, q: 1.6 },
    { on: true, type: "peaking", freq: 2600, gain: 6, q: 1.4 },
    { on: true, type: "lowpass", freq: 3600, gain: 0, q: 1.1 }
  ]
};

const targetRMS = 0.15;
const GRAPH_PADDING_X = 45;