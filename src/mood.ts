import type { DayPhase, SkyKind } from "./sky";

const STORAGE_KEY = "cielo-mood";
const MASTER = 0.2;
const FADE_IN = 1.35;
const FADE_OUT = 0.9;
const MIX_FADE = 2.6;

interface Mix {
  brown: number;
  rain: number;
  wind: number;
  stream: number;
  thunder: number;
  crickets: number;
  birds: number;
}

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  brown: GainNode;
  rain: GainNode;
  wind: GainNode;
  stream: GainNode;
  events: GainNode;
  rumble: AudioBuffer;
}

let wanted = localStorage.getItem(STORAGE_KEY) === "1";
let sky: { kind: SkyKind; phase: DayPhase } = { kind: "sunny", phase: "day" };
let engine: Engine | null = null;
let thunderTimer = 0;
let cricketTimer = 0;
let birdTimer = 0;

const MIX: Record<SkyKind, { day: Mix; night: Mix }> = {
  sunny: {
    day: { brown: 0.22, rain: 0, wind: 0.12, stream: 0.07, thunder: 0, crickets: 0, birds: 0.16 },
    night: { brown: 0.28, rain: 0, wind: 0.08, stream: 0, thunder: 0, crickets: 0.3, birds: 0 },
  },
  cloudy: {
    day: { brown: 0.26, rain: 0, wind: 0.4, stream: 0.05, thunder: 0, crickets: 0, birds: 0.05 },
    night: { brown: 0.3, rain: 0, wind: 0.26, stream: 0, thunder: 0, crickets: 0.2, birds: 0 },
  },
  rainy: {
    day: { brown: 0.1, rain: 0.52, wind: 0.12, stream: 0, thunder: 0.2, crickets: 0, birds: 0 },
    night: { brown: 0.14, rain: 0.56, wind: 0.08, stream: 0, thunder: 0.14, crickets: 0.08, birds: 0 },
  },
  sunrise: {
    day: { brown: 0.18, rain: 0, wind: 0.1, stream: 0.16, thunder: 0, crickets: 0.04, birds: 0.26 },
    night: { brown: 0.18, rain: 0, wind: 0.1, stream: 0.16, thunder: 0, crickets: 0.04, birds: 0.26 },
  },
  sunset: {
    day: { brown: 0.22, rain: 0, wind: 0.18, stream: 0.1, thunder: 0, crickets: 0.12, birds: 0.07 },
    night: { brown: 0.22, rain: 0, wind: 0.18, stream: 0.1, thunder: 0, crickets: 0.12, birds: 0.07 },
  },
};

function mixFor(kind: SkyKind, phase: DayPhase): Mix {
  return MIX[kind][phase === "night" && kind !== "sunrise" && kind !== "sunset" ? "night" : "day"];
}

function ramp(ctx: AudioContext, param: AudioParam, value: number, seconds: number): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(Math.max(0, value), now + seconds);
}

function peakNormalize(data: Float32Array, peak = 0.86): void {
  let max = 0;
  for (const sample of data) max = Math.max(max, Math.abs(sample));
  if (max < 1e-6) return;
  const scale = peak / max;
  for (let i = 0; i < data.length; i++) data[i] *= scale;
}

function fillPink(data: Float32Array): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  peakNormalize(data);
}

function fillBrown(data: Float32Array): void {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last;
  }
  peakNormalize(data);
}

function makeBuffer(ctx: AudioContext, fill: (data: Float32Array) => void, seconds = 8): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) fill(buffer.getChannelData(ch));
  return buffer;
}

function loop(ctx: AudioContext, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.playbackRate.value = rate;
  source.start();
  return source;
}

function filter(ctx: AudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

function gain(ctx: AudioContext, value = 0): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function connect(nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

function currentMix(): Mix {
  return mixFor(sky.kind, sky.phase);
}

function applyMix(seconds = MIX_FADE): void {
  if (!engine) return;
  const mix = currentMix();
  const { ctx } = engine;
  ramp(ctx, engine.brown.gain, mix.brown, seconds);
  ramp(ctx, engine.rain.gain, mix.rain, seconds);
  ramp(ctx, engine.wind.gain, mix.wind, seconds);
  ramp(ctx, engine.stream.gain, mix.stream, seconds);
}

function clearEvents(): void {
  window.clearTimeout(thunderTimer);
  window.clearTimeout(cricketTimer);
  window.clearTimeout(birdTimer);
  thunderTimer = 0;
  cricketTimer = 0;
  birdTimer = 0;
}

function later(min: number, max: number, fn: () => void): number {
  return window.setTimeout(fn, min + Math.random() * (max - min));
}

function chirp(frequency: number, duration: number, volume: number, slide = 0.92): void {
  if (!engine || engine.ctx.state !== "running") return;
  const { ctx, events } = engine;
  const osc = ctx.createOscillator();
  const amp = gain(ctx, 0);
  const tone = filter(ctx, "bandpass", frequency, 6);
  osc.type = "sine";
  osc.frequency.value = frequency;
  const now = ctx.currentTime;
  osc.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * slide), now + duration);
  amp.gain.setValueAtTime(0, now);
  amp.gain.linearRampToValueAtTime(volume, now + 0.018);
  amp.gain.exponentialRampToValueAtTime(0.0008, now + duration);
  osc.connect(tone);
  tone.connect(amp);
  amp.connect(events);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function scheduleThunder(): void {
  thunderTimer = later(18000, 48000, () => {
    const mix = currentMix();
    if (wanted && engine && mix.thunder > 0) {
      const { ctx, events } = engine;
      const src = ctx.createBufferSource();
      src.buffer = engine.rumble;
      src.playbackRate.value = 0.32 + Math.random() * 0.12;
      const low = filter(ctx, "lowpass", 160 + Math.random() * 80, 0.6);
      const amp = gain(ctx, 0);
      const now = ctx.currentTime;
      const peak = 0.18 * mix.thunder;
      amp.gain.setValueAtTime(0.0008, now);
      amp.gain.exponentialRampToValueAtTime(peak, now + 0.12);
      amp.gain.exponentialRampToValueAtTime(0.0008, now + 2.6);
      src.connect(low);
      low.connect(amp);
      amp.connect(events);
      src.start(now, Math.random() * 4);
      src.stop(now + 3);
    }
    if (wanted) scheduleThunder();
  });
}

function scheduleCrickets(): void {
  cricketTimer = later(1600, 3800, () => {
    const mix = currentMix();
    if (wanted && mix.crickets > 0) {
      const pulses = 4 + Math.floor(Math.random() * 4);
      const base = 3900 + Math.random() * 700;
      for (let i = 0; i < pulses; i++) {
        window.setTimeout(
          () => chirp(base + Math.random() * 80, 0.028, 0.045 * mix.crickets, 0.98),
          i * 52,
        );
      }
    }
    if (wanted) scheduleCrickets();
  });
}

function scheduleBirds(): void {
  birdTimer = later(12000, 28000, () => {
    const mix = currentMix();
    if (wanted && mix.birds > 0) {
      const first = 2400 + Math.random() * 1100;
      chirp(first, 0.11, 0.055 * mix.birds, 1.06);
      window.setTimeout(() => chirp(first * 1.12, 0.09, 0.04 * mix.birds, 0.94), 130);
    }
    if (wanted) scheduleBirds();
  });
}

async function ensureEngine(): Promise<Engine> {
  if (engine) {
    if (engine.ctx.state === "suspended") await engine.ctx.resume();
    return engine;
  }

  const ctx = new AudioContext({ latencyHint: "playback" });
  const pink = makeBuffer(ctx, fillPink);
  const brown = makeBuffer(ctx, fillBrown);

  const master = gain(ctx, 0);
  const air = filter(ctx, "highshelf", 6200, 0.5);
  air.gain.value = -6;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 16;
  compressor.ratio.value = 2.6;
  compressor.attack.value = 0.04;
  compressor.release.value = 0.28;
  connect([master, air, compressor, ctx.destination]);

  const brownGain = gain(ctx);
  const rainGain = gain(ctx);
  const windGain = gain(ctx);
  const streamGain = gain(ctx);
  const events = gain(ctx, 1);
  brownGain.connect(master);
  rainGain.connect(master);
  windGain.connect(master);
  streamGain.connect(master);
  events.connect(master);

  const brownLow = filter(ctx, "lowpass", 240, 0.5);
  connect([loop(ctx, brown, 0.7), brownLow, brownGain]);

  const rainNear = filter(ctx, "bandpass", 1400, 0.55);
  const rainAir = filter(ctx, "highpass", 520, 0.6);
  connect([loop(ctx, pink, 1.02), rainNear, rainAir, rainGain]);
  const rainFar = filter(ctx, "lowpass", 1100, 0.5);
  const rainFarGain = gain(ctx, 0.55);
  connect([loop(ctx, pink, 0.94), rainFar, rainFarGain, rainGain]);

  const windFilter = filter(ctx, "lowpass", 480, 0.55);
  const windLfo = ctx.createOscillator();
  const windDepth = gain(ctx, 220);
  windLfo.type = "sine";
  windLfo.frequency.value = 0.07;
  windLfo.connect(windDepth);
  windDepth.connect(windFilter.frequency);
  windLfo.start();
  connect([loop(ctx, brown, 0.55), windFilter, windGain]);

  const streamFilter = filter(ctx, "bandpass", 920, 0.8);
  const streamHigh = filter(ctx, "highpass", 380, 0.7);
  connect([loop(ctx, pink, 1.08), streamFilter, streamHigh, streamGain]);

  engine = {
    ctx,
    master,
    brown: brownGain,
    rain: rainGain,
    wind: windGain,
    stream: streamGain,
    events,
    rumble: brown,
  };
  if (ctx.state === "suspended") await ctx.resume();
  document.body.dataset.moodCtx = ctx.state;
  return engine;
}

function startEvents(): void {
  clearEvents();
  scheduleThunder();
  scheduleCrickets();
  scheduleBirds();
}

async function start(): Promise<void> {
  const next = await ensureEngine();
  applyMix(0.01);
  ramp(next.ctx, next.master.gain, MASTER, FADE_IN);
  startEvents();
}

async function stop(): Promise<void> {
  clearEvents();
  if (!engine) return;
  ramp(engine.ctx, engine.master.gain, 0, FADE_OUT);
  const ctx = engine.ctx;
  window.setTimeout(() => {
    if (!wanted && ctx.state === "running") void ctx.suspend();
  }, FADE_OUT * 1000 + 40);
}

function paintButton(on: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>("[data-mood-toggle]");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(on));
  btn.title = on ? "Mute soundscape" : "Play soundscape";
  const label = btn.querySelector(".sr-only");
  if (label) label.textContent = on ? "Mute soundscape" : "Play soundscape";
  const swap = btn.querySelector(".t-icon-swap");
  if (swap) swap.setAttribute("data-state", on ? "b" : "a");
  document.body.dataset.mood = on ? "on" : "off";
}

export function setMoodSky(kind: SkyKind, phase: DayPhase): void {
  sky = { kind, phase };
  if (wanted && engine) applyMix();
}

export async function setMoodEnabled(on: boolean): Promise<void> {
  wanted = on;
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  paintButton(on);
  if (on) await start();
  else await stop();
}

export function bindMood(): void {
  const btn = document.querySelector<HTMLButtonElement>("[data-mood-toggle]");
  paintButton(wanted);

  btn?.addEventListener("click", () => {
    void setMoodEnabled(!wanted);
  });

  if (wanted) {
    const unlock = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && btn?.contains(target)) return;
      window.removeEventListener("pointerdown", unlock, true);
      if (wanted) void start();
    };
    window.addEventListener("pointerdown", unlock, true);
  }

  document.addEventListener("visibilitychange", () => {
    if (!engine) return;
    if (document.hidden) {
      clearEvents();
      void engine.ctx.suspend();
      return;
    }
    if (wanted) void start();
  });
}
