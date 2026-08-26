import "./style.css";
import { initRain, setRainEnabled, setRainNight, syncRainSky } from "./rain";
import { getHourCycle, setClockTimezone, setHourCycle, startClock, type HourCycle } from "./clock";
import { locate } from "./geo";
import {
  applyPalette,
  mixPalettes,
  paletteFor,
  SKY_LABELS,
  type DayPhase,
  type SkyKind,
  type SkyPalette,
} from "./sky";
import { fetchWeather, type WeatherReading } from "./weather";

const TRANSITION_MS = 1800;
const WEATHER_MS = 10 * 60 * 1000;

interface SkyState {
  kind: SkyKind;
  phase: DayPhase;
}

let live: SkyState = { kind: "sunny", phase: "day" };
let shown: SkyState = { kind: "sunny", phase: "day" };
let preview: SkyKind | "live" = "live";
let forceNight = false;
let currentPalette: SkyPalette = paletteFor("sunny", "day");
let animating = false;
let weather: WeatherReading | null = null;
let clockStarted = false;

function swapText(el: HTMLElement | null, next: string): void {
  if (!el || el.textContent === next) return;
  const duration = 180;
  el.classList.add("is-exit");
  window.setTimeout(() => {
    el.textContent = next;
    el.classList.add("is-enter-start");
    el.classList.remove("is-exit");
    void el.offsetWidth;
    el.classList.remove("is-enter-start");
  }, duration);
}

function applySkyAttrs(state: SkyState): void {
  document.body.dataset.sky = state.kind;
  document.body.dataset.phase = state.phase;
  setRainEnabled(state.kind === "rainy");
  setRainNight(state.phase === "night");
}

function tweenTo(next: SkyState): void {
  if (shown.kind === next.kind && shown.phase === next.phase) {
    applySkyAttrs(next);
    return;
  }
  const from = currentPalette;
  const to = paletteFor(next.kind, next.phase);
  const start = performance.now();
  animating = true;
  applySkyAttrs(next);

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / TRANSITION_MS);
    const eased = 1 - (1 - t) ** 3;
    currentPalette = mixPalettes(from, to, eased);
    applyPalette(currentPalette);
    if (next.kind === "rainy") syncRainSky();
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      animating = false;
      shown = next;
    }
  };
  requestAnimationFrame(step);
}

function visibleState(): SkyState {
  if (preview === "live") {
    if (forceNight && live.kind !== "sunrise" && live.kind !== "sunset") {
      return { kind: live.kind, phase: "night" };
    }
    return live;
  }
  return {
    kind: preview,
    phase: preview === "sunrise" || preview === "sunset" ? "day" : forceNight ? "night" : live.phase,
  };
}

function renderSkyCopy(): void {
  const label = document.querySelector<HTMLElement>("[data-sky-label]");
  const temp = document.querySelector<HTMLElement>("[data-temp]");
  const state = visibleState();
  const nightClear = state.kind === "sunny" && state.phase === "night";
  const nightRain = state.kind === "rainy" && state.phase === "night";
  const nightCloud = state.kind === "cloudy" && state.phase === "night";
  const labelText = nightClear
    ? "Clear night"
    : nightRain
      ? "Night rain"
      : nightCloud
        ? "Night cloud"
        : SKY_LABELS[state.kind];
  swapText(label, labelText);
  if (temp) {
    temp.textContent =
      weather?.temperature === null || weather?.temperature === undefined
        ? "—"
        : `${weather.temperature}°`;
  }
}

function setSky(next: SkyState): void {
  tweenTo(next);
  renderSkyCopy();
}

function setLive(next: SkyState): void {
  live = next;
  if (preview === "live") setSky(next);
}

function ensureClock(timezone: string): void {
  if (clockStarted) {
    setClockTimezone(timezone);
    return;
  }
  clockStarted = true;
  startClock(timezone, (now) => {
    if (animating || preview !== "live" || !weather) return;
    const sunrise = weather.sunrise;
    const sunset = weather.sunset;
    if (!sunrise || !sunset) return;
    const windowMs = 45 * 60 * 1000;
    const near = (event: Date) => Math.abs(now.getTime() - event.getTime()) <= windowMs;
    let kind: SkyKind = weather.atmosphere;
    if (near(sunrise)) kind = "sunrise";
    else if (near(sunset)) kind = "sunset";
    const phase: DayPhase =
      kind === "sunrise" || kind === "sunset"
        ? "day"
        : now >= sunrise && now < sunset
          ? "day"
          : "night";
    if (kind !== live.kind || phase !== live.phase) {
      setLive({ kind, phase });
    }
  });
}

async function refreshWeather(): Promise<void> {
  const placeEl = document.querySelector<HTMLElement>("[data-place]");
  try {
    const geo = await locate();
    swapText(placeEl, geo.label);
    weather = await fetchWeather(geo.latitude, geo.longitude);
    ensureClock(weather.timezone);
    setLive({ kind: weather.kind, phase: weather.phase });
    renderSkyCopy();
  } catch {
    swapText(placeEl, "Local time");
    ensureClock(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setLive({ kind: "sunny", phase: "day" });
  }
}

function closeMs(): number {
  return (
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) ||
    150
  );
}

function bindSettings(): void {
  const toggle = document.querySelector<HTMLButtonElement>(".settings-toggle");
  const modal = document.querySelector<HTMLElement>("#settings");
  const scrim = document.querySelector<HTMLElement>(".settings-scrim");
  const closeBtn = document.querySelector<HTMLButtonElement>("[data-settings-close]");
  const dismiss = document.querySelector("[data-settings-dismiss]");
  const bar = document.querySelector<HTMLElement>(".t-tabs");
  const pill = bar?.querySelector<HTMLElement>(".t-tabs-pill");
  const tabs = [...(bar?.querySelectorAll<HTMLButtonElement>(".t-tab") ?? [])];
  let open = false;
  let closing = false;

  const movePill = (tab: HTMLElement, animate: boolean) => {
    if (!pill) return;
    if (!animate) {
      const prev = pill.style.transition;
      pill.style.transition = "none";
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = prev;
      return;
    }
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
  };

  const activeTab = () =>
    tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs[0];

  const syncHourTabs = (cycle: HourCycle, animate: boolean) => {
    for (const tab of tabs) {
      tab.setAttribute("aria-selected", tab.dataset.hour === cycle ? "true" : "false");
    }
    const selected = activeTab();
    if (selected) movePill(selected, animate);
  };

  const setOpen = (next: boolean) => {
    if (!toggle || !modal || !scrim) return;
    if (next === open || (next && closing)) return;
    open = next;
    toggle.setAttribute("aria-expanded", String(next));
    if (next) {
      modal.hidden = false;
      scrim.hidden = false;
      modal.classList.remove("is-closing");
      scrim.classList.remove("is-closing");
      requestAnimationFrame(() => {
        modal.classList.add("is-open");
        scrim.classList.add("is-open");
        syncHourTabs(getHourCycle(), false);
        closeBtn?.focus();
      });
      return;
    }
    closing = true;
    modal.classList.remove("is-open");
    scrim.classList.remove("is-open");
    modal.classList.add("is-closing");
    scrim.classList.add("is-closing");
    window.setTimeout(() => {
      modal.classList.remove("is-closing");
      scrim.classList.remove("is-closing");
      modal.hidden = true;
      scrim.hidden = true;
      closing = false;
      toggle.focus();
    }, closeMs());
  };

  toggle?.addEventListener("click", () => setOpen(!open));
  closeBtn?.addEventListener("click", () => setOpen(false));
  dismiss?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) setOpen(false);
  });

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const cycle = (tab.dataset.hour as HourCycle) ?? "h23";
      setHourCycle(cycle);
      syncHourTabs(cycle, true);
    });
  }

  window.addEventListener("resize", () => {
    if (open) {
      const selected = activeTab();
      if (selected) movePill(selected, false);
    }
  });

  syncHourTabs(getHourCycle(), false);
}

function bindPreview(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-preview]");
  const nightButton = document.querySelector<HTMLButtonElement>("[data-night]");

  const syncNightButton = () => {
    nightButton?.classList.toggle("is-active", forceNight);
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset.preview as SkyKind | "live";
      preview = value;
      for (const other of buttons) {
        other.classList.toggle("is-active", other === button);
      }
      setSky(visibleState());
    });
  }

  nightButton?.addEventListener("click", () => {
    forceNight = !forceNight;
    syncNightButton();
    setSky(visibleState());
  });

  syncNightButton();
}

applyPalette(currentPalette);
initRain(document.querySelector(".rain") as HTMLCanvasElement);
applySkyAttrs(shown);
bindSettings();
bindPreview();
ensureClock(Intl.DateTimeFormat().resolvedOptions().timeZone);
renderSkyCopy();

window.setTimeout(() => {
  document.querySelector(".t-stagger")?.classList.add("is-shown");
}, 80);

void refreshWeather();
window.setInterval(() => {
  void refreshWeather();
}, WEATHER_MS);
