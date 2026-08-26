export type SkyKind = "sunrise" | "sunset" | "sunny" | "cloudy" | "rainy";
export type DayPhase = "day" | "night";

export interface SkyPalette {
  zenith: string;
  haze: string;
  bloom: string;
  horizon: string;
  earth: string;
  glow: string;
  ink: string;
  glass: string;
}

const DAY: Record<SkyKind, SkyPalette> = {
  sunrise: {
    zenith: "#5b4a86",
    haze: "#e08b9a",
    bloom: "#f3b56a",
    horizon: "#ffe1bf",
    earth: "#c46b4a",
    glow: "#ffd7a0",
    ink: "#2a1610",
    glass: "rgba(255, 232, 210, 0.42)",
  },
  sunset: {
    zenith: "#1c1033",
    haze: "#8b2458",
    bloom: "#e45a2b",
    horizon: "#f4b25d",
    earth: "#4a1840",
    glow: "#ff9a4a",
    ink: "#ffe8d2",
    glass: "rgba(255, 180, 120, 0.28)",
  },
  sunny: {
    zenith: "#1a6fbf",
    haze: "#56b4e8",
    bloom: "#fff0b0",
    horizon: "#c8e8f8",
    earth: "#2f8fd4",
    glow: "#ffe58a",
    ink: "#072033",
    glass: "rgba(220, 244, 255, 0.38)",
  },
  cloudy: {
    zenith: "#7d8794",
    haze: "#c4c0b6",
    bloom: "#ece7dc",
    horizon: "#b7b3a8",
    earth: "#8d93a0",
    glow: "#f4efe4",
    ink: "#26282e",
    glass: "rgba(255, 255, 250, 0.34)",
  },
  rainy: {
    zenith: "#2a3848",
    haze: "#4d6478",
    bloom: "#8aa0b4",
    horizon: "#c2ced8",
    earth: "#1e2a36",
    glow: "#9eb4c4",
    ink: "#eef4f8",
    glass: "rgba(190, 210, 225, 0.22)",
  },
};

const NIGHT: Record<SkyKind, SkyPalette> = {
  sunrise: DAY.sunrise,
  sunset: DAY.sunset,
  sunny: {
    zenith: "#04060f",
    haze: "#0a1736",
    bloom: "#1a3368",
    horizon: "#243e70",
    earth: "#05060c",
    glow: "#e8d9a8",
    ink: "#eef3fb",
    glass: "rgba(180, 205, 235, 0.14)",
  },
  cloudy: {
    zenith: "#0c0e14",
    haze: "#1c2028",
    bloom: "#3a3e48",
    horizon: "#5c5852",
    earth: "#08090c",
    glow: "#c4b8a6",
    ink: "#ece8e0",
    glass: "rgba(200, 196, 188, 0.12)",
  },
  rainy: {
    zenith: "#07090e",
    haze: "#121822",
    bloom: "#243044",
    horizon: "#3d4f63",
    earth: "#05070a",
    glow: "#8fa8c4",
    ink: "#e4eef6",
    glass: "rgba(170, 198, 220, 0.12)",
  },
};

export function paletteFor(kind: SkyKind, phase: DayPhase): SkyPalette {
  return phase === "night" ? NIGHT[kind] : DAY[kind];
}

export const SKY_LABELS: Record<SkyKind, string> = {
  sunrise: "Sunrise",
  sunset: "Sunset",
  sunny: "Clear",
  cloudy: "Cloud",
  rainy: "Rain",
};

function parseRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const h = color.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const m = color.match(/[\d.]+/g);
  if (!m || m.length < 3) return [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHex(from: string, to: string, t: number): string {
  const [r1, g1, b1] = parseRgb(from);
  const [r2, g2, b2] = parseRgb(to);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  return `rgb(${r} ${g} ${b})`;
}

function lerpAlpha(from: string, to: string, t: number): string {
  const parse = (value: string) => {
    const m = value.match(/[\d.]+/g);
    if (!m || m.length < 4) return [255, 255, 255, 0.2];
    return m.map(Number);
  };
  const a = parse(from);
  const b = parse(to);
  return `rgba(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))}, ${lerp(a[3], b[3], t).toFixed(3)})`;
}

export function mixPalettes(from: SkyPalette, to: SkyPalette, t: number): SkyPalette {
  const k = Math.min(1, Math.max(0, t));
  return {
    zenith: lerpHex(from.zenith, to.zenith, k),
    haze: lerpHex(from.haze, to.haze, k),
    bloom: lerpHex(from.bloom, to.bloom, k),
    horizon: lerpHex(from.horizon, to.horizon, k),
    earth: lerpHex(from.earth, to.earth, k),
    glow: lerpHex(from.glow, to.glow, k),
    ink: lerpHex(from.ink, to.ink, k),
    glass: lerpAlpha(from.glass, to.glass, k),
  };
}

export function applyPalette(palette: SkyPalette): void {
  const root = document.documentElement;
  root.style.setProperty("--sky-zenith", palette.zenith);
  root.style.setProperty("--sky-haze", palette.haze);
  root.style.setProperty("--sky-bloom", palette.bloom);
  root.style.setProperty("--sky-horizon", palette.horizon);
  root.style.setProperty("--sky-earth", palette.earth);
  root.style.setProperty("--sky-glow", palette.glow);
  root.style.setProperty("--sky-ink", palette.ink);
  root.style.setProperty("--sky-glass", palette.glass);
  document.body.style.color = palette.ink;
}
