import RaindropFX from "raindrop-fx";

const MAX_DPR = 1.5;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const DAY_LIGHT = {
  mistColor: [0.03, 0.05, 0.07, 1] as [number, number, number, number],
  raindropDiffuseLight: [0.28, 0.3, 0.32] as [number, number, number],
  raindropSpecularLight: [0.12, 0.14, 0.16] as [number, number, number],
  raindropLightPos: [-1, 1, 2, 0] as [number, number, number, number],
  raindropShadowOffset: 0.8,
};

const NIGHT_LIGHT = {
  mistColor: [0.01, 0.015, 0.03, 1] as [number, number, number, number],
  raindropDiffuseLight: [0.06, 0.08, 0.12] as [number, number, number],
  raindropSpecularLight: [0.22, 0.26, 0.34] as [number, number, number],
  raindropLightPos: [0.35, 1.05, 2.2, 0] as [number, number, number, number],
  raindropShadowOffset: 0.9,
};

let canvas: HTMLCanvasElement | null = null;
let fx: InstanceType<typeof RaindropFX> | null = null;
let sky: HTMLCanvasElement | null = null;
let running = false;
let wanted = false;
let starting = false;
let night = false;
let resizeTimer = 0;
let skySyncTimer = 0;

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

function sizeCanvas(target: HTMLCanvasElement): { width: number; height: number } {
  const scale = dpr();
  const width = Math.max(1, Math.round(target.clientWidth * scale));
  const height = Math.max(1, Math.round(target.clientHeight * scale));
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
  return { width, height };
}

function paintSky(target: HTMLCanvasElement): void {
  const ctx = target.getContext("2d");
  if (!ctx) return;
  const w = Math.max(target.width, 2);
  const h = Math.max(target.height, 2);
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  const css = getComputedStyle(document.documentElement);
  const zenith = css.getPropertyValue("--sky-zenith").trim() || "#2a3848";
  const haze = css.getPropertyValue("--sky-haze").trim() || "#4d6478";
  const bloom = css.getPropertyValue("--sky-bloom").trim() || "#8aa0b4";
  const horizon = css.getPropertyValue("--sky-horizon").trim() || "#c2ced8";
  const earth = css.getPropertyValue("--sky-earth").trim() || "#1e2a36";

  const fall = ctx.createLinearGradient(w * 0.12, 0, w * 0.08, h);
  fall.addColorStop(0, zenith);
  fall.addColorStop(0.4, haze);
  fall.addColorStop(0.72, horizon);
  fall.addColorStop(1, earth);
  ctx.fillStyle = fall;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.7);
  glow.addColorStop(0, earth);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const bloomGlow = ctx.createRadialGradient(w * 0.78, h * 0.22, 0, w * 0.78, h * 0.22, h * 0.45);
  bloomGlow.addColorStop(0, bloom);
  bloomGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = night ? 0.28 : 0.55;
  ctx.fillStyle = bloomGlow;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  if (night) {
    ctx.fillStyle = "rgba(230, 240, 255, 0.55)";
    const stars = [
      [0.12, 0.18],
      [0.28, 0.42],
      [0.63, 0.14],
      [0.81, 0.36],
      [0.74, 0.68],
      [0.41, 0.22],
      [0.08, 0.64],
      [0.92, 0.12],
      [0.55, 0.48],
    ];
    for (const [x, y] of stars) {
      ctx.beginPath();
      ctx.arc(w * x, h * y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function applyRainLight(): void {
  if (!fx) return;
  const light = night ? NIGHT_LIGHT : DAY_LIGHT;
  fx.options.mistColor = light.mistColor;
  fx.options.raindropDiffuseLight = light.raindropDiffuseLight;
  fx.options.raindropSpecularLight = light.raindropSpecularLight;
  fx.options.raindropLightPos = light.raindropLightPos;
  fx.options.raindropShadowOffset = light.raindropShadowOffset;
}

async function syncBackground(): Promise<void> {
  if (!fx || !sky || !canvas) return;
  sky.width = Math.max(512, Math.round(canvas.width / 2));
  sky.height = Math.max(512, Math.round(canvas.height / 2));
  paintSky(sky);
  await fx.setBackground(sky);
}

async function boot(): Promise<void> {
  if (!canvas || fx || starting || reducedMotion) return;
  starting = true;
  try {
    sizeCanvas(canvas);
    sky = document.createElement("canvas");
    paintSky(sky);
    fx = new RaindropFX({
      canvas,
      background: sky,
      spawnInterval: [0.03, 0.08],
      spawnSize: [32, 88],
      spawnLimit: 900,
      gravity: 1700,
      slipRate: 0.04,
      trailDropDensity: 0.12,
      trailDistance: [22, 40],
      mist: true,
      mistColor: DAY_LIGHT.mistColor,
      mistTime: 1.6,
      mistBlurStep: 4,
      dropletsPerSeconds: 760,
      dropletSize: [12, 34],
      backgroundBlurSteps: 3,
      raindropCompose: "smoother",
      raindropDiffuseLight: DAY_LIGHT.raindropDiffuseLight,
      raindropSpecularLight: DAY_LIGHT.raindropSpecularLight,
      raindropLightPos: DAY_LIGHT.raindropLightPos,
      raindropShadowOffset: DAY_LIGHT.raindropShadowOffset,
    });
    await fx.start();
    applyRainLight();
    running = true;
    if (!wanted) {
      fx.stop();
      running = false;
    }
  } catch (error) {
    console.warn("Raindrop effect unavailable", error);
    fx = null;
  } finally {
    starting = false;
  }
}

function onResize(): void {
  if (!canvas || !wanted) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (!canvas || !fx) return;
    const { width, height } = sizeCanvas(canvas);
    fx.resize(width, height);
    void syncBackground();
  }, 120);
}

export function initRain(target: HTMLCanvasElement | null): void {
  if (!target) return;
  canvas = target;
  window.addEventListener("resize", onResize);
}

export function setRainEnabled(on: boolean): void {
  wanted = on;
  canvas?.classList.toggle("is-on", on && !reducedMotion);
  if (on && !reducedMotion) {
    if (!fx) void boot();
    else if (!running) {
      void fx.start();
      running = true;
      applyRainLight();
      void syncBackground();
    }
  } else if (fx && running) {
    fx.stop();
    running = false;
  }
}

export function setRainNight(on: boolean): void {
  night = on;
  applyRainLight();
  if (wanted && running) void syncBackground();
}

export function syncRainSky(): void {
  if (!wanted || !fx || !running) return;
  window.clearTimeout(skySyncTimer);
  skySyncTimer = window.setTimeout(() => {
    void syncBackground();
  }, 180);
}
