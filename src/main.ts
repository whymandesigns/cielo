import "./style.css";
import { initRain, setRainEnabled, setRainNight, syncRainSky } from "./rain";
import { getHourCycle, setClockTimezone, setHourCycle, startClock, type HourCycle } from "./clock";
import { formatTemperature, getTempUnit, inferTempUnit, setTempUnit, type TempUnit } from "./temp";
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
let syncTempTabs: ((animate: boolean) => void) | undefined;

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
  if (temp) temp.textContent = formatTemperature(weather?.temperature);
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
    inferTempUnit(geo.countryCode);
    syncTempTabs?.(false);
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
  const card = modal?.querySelector<HTMLElement>(".settings-card");
  const closeBtn = document.querySelector<HTMLButtonElement>("[data-settings-close]");
  const dismiss = document.querySelector("[data-settings-dismiss]");
  const hourBar = document.querySelector<HTMLElement>('[data-tabs="hour"]');
  const tempBar = document.querySelector<HTMLElement>('[data-tabs="temp"]');
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");
  let open = false;
  let closing = false;
  let pointerX = 0;
  let pointerY = 0;
  let floatFrame = 0;

  const resetFloat = () => {
    if (!card) return;
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
    card.style.setProperty("--float-x", "0px");
    card.style.setProperty("--float-y", "0px");
    card.style.setProperty("--glare-x", "50%");
    card.style.setProperty("--glare-y", "18%");
  };

  const applyFloat = () => {
    floatFrame = 0;
    if (!card || !open || reduceMotion.matches || !finePointer.matches) {
      resetFloat();
      return;
    }
    const rect = modal.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = Math.max(-1, Math.min(1, (pointerX - (rect.left + rect.width / 2)) / (rect.width * 0.9)));
    const ny = Math.max(-1, Math.min(1, (pointerY - (rect.top + rect.height / 2)) / (rect.height * 1.15)));
    card.style.setProperty("--tilt-x", `${(ny * 8).toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${(-nx * 10).toFixed(2)}deg`);
    card.style.setProperty("--float-x", `${(nx * 18).toFixed(2)}px`);
    card.style.setProperty("--float-y", `${(ny * 14).toFixed(2)}px`);
    card.style.setProperty("--glare-x", `${(50 + nx * 38).toFixed(1)}%`);
    card.style.setProperty("--glare-y", `${Math.max(0, Math.min(100, 28 + ny * 42)).toFixed(1)}%`);
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!floatFrame) floatFrame = requestAnimationFrame(applyFloat);
  };

  const bindTabGroup = (
    bar: HTMLElement | null,
    isActive: (tab: HTMLButtonElement) => boolean,
    onPick: (tab: HTMLButtonElement) => void,
  ): ((animate: boolean) => void) => {
    const pill = bar?.querySelector<HTMLElement>(".t-tabs-pill");
    const tabs = [...(bar?.querySelectorAll<HTMLButtonElement>(".t-tab") ?? [])];

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

    const sync = (animate: boolean) => {
      for (const tab of tabs) {
        tab.setAttribute("aria-selected", isActive(tab) ? "true" : "false");
      }
      const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs[0];
      if (selected) movePill(selected, animate);
    };

    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        onPick(tab);
        sync(true);
      });
    }

    return sync;
  };

  const syncHourTabs = bindTabGroup(
    hourBar,
    (tab) => tab.dataset.hour === getHourCycle(),
    (tab) => setHourCycle((tab.dataset.hour as HourCycle) ?? "h23"),
  );

  syncTempTabs = bindTabGroup(
    tempBar,
    (tab) => tab.dataset.tempUnit === getTempUnit(),
    (tab) => {
      setTempUnit((tab.dataset.tempUnit as TempUnit) ?? "c");
      renderSkyCopy();
    },
  );

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
      window.addEventListener("pointermove", onPointerMove);
      requestAnimationFrame(() => {
        modal.classList.add("is-open");
        scrim.classList.add("is-open");
        syncHourTabs(false);
        syncTempTabs?.(false);
        closeBtn?.focus();
      });
      return;
    }
    closing = true;
    window.removeEventListener("pointermove", onPointerMove);
    if (floatFrame) cancelAnimationFrame(floatFrame);
    floatFrame = 0;
    resetFloat();
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

  window.addEventListener("resize", () => {
    if (open) {
      syncHourTabs(false);
      syncTempTabs?.(false);
    }
  });

  syncHourTabs(false);
  syncTempTabs?.(false);
}

function bindPreview(): void {
  const SKY_BAR_KEY = "cielo-sky-bar";
  const bar = document.querySelector<HTMLElement>(".preview");
  const switchBtn = document.querySelector<HTMLInputElement>("[data-preview-mode]");
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-preview]");
  const nightButton = document.querySelector<HTMLButtonElement>("[data-night]");
  let hideTimer = 0;

  if (switchBtn?.dataset.bound === "1") {
    return;
  }
  if (switchBtn) switchBtn.dataset.bound = "1";

  const syncNightButton = () => {
    nightButton?.classList.toggle("is-active", forceNight);
  };

  const syncPreviewButtons = () => {
    for (const button of buttons) {
      button.classList.toggle("is-active", button.dataset.preview === preview);
    }
    syncNightButton();
  };

  const setBarVisible = (on: boolean, instant = false) => {
    localStorage.setItem(SKY_BAR_KEY, on ? "1" : "0");
    if (switchBtn) switchBtn.checked = on;
    document.body.dataset.skyBar = on ? "on" : "off";
    if (!bar) return;
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    if (on) {
      bar.hidden = false;
      if (instant) {
        bar.classList.add("is-shown");
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => bar.classList.add("is-shown"));
        });
      }
    } else {
      bar.classList.remove("is-shown");
      const hide = () => {
        hideTimer = 0;
        if (document.body.dataset.skyBar !== "on") bar.hidden = true;
      };
      if (instant) hide();
      else hideTimer = window.setTimeout(hide, 280);
      if (preview !== "live" || forceNight) {
        preview = "live";
        forceNight = false;
        syncPreviewButtons();
        setSky(visibleState());
      }
    }
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset.preview as SkyKind | "live";
      preview = value;
      syncPreviewButtons();
      setSky(visibleState());
    });
  }

  nightButton?.addEventListener("click", () => {
    forceNight = !forceNight;
    syncNightButton();
    setSky(visibleState());
  });

  switchBtn?.addEventListener("change", () => {
    setBarVisible(switchBtn.checked);
  });

  setBarVisible(localStorage.getItem(SKY_BAR_KEY) === "1", true);
  syncPreviewButtons();
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
