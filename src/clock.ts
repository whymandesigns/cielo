const STORAGE_KEY = "cielo-hour";
const LEGACY_HOUR_KEY = "skyclock-hour";

export type HourCycle = "h12" | "h23";

let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let hourCycle: HourCycle =
  localStorage.getItem(STORAGE_KEY) === "h12" ||
  localStorage.getItem(LEGACY_HOUR_KEY) === "h12"
    ? "h12"
    : "h23";
let timeFmt = makeTimeFmt();
let dateFmt = makeDateFmt();
let frame = 0;
let started = false;
let onTick: ((now: Date) => void) | undefined;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function makeTimeFmt(): Intl.DateTimeFormat {
  const hour12 = hourCycle === "h12";
  return new Intl.DateTimeFormat(hour12 ? "en-US" : "en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  });
}

function makeDateFmt(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function splitDigits(value: string): string {
  return [...value]
    .map((char, index) => `<span class="t-digit"${index ? ` data-stagger="${index}"` : ""}>${char}</span>`)
    .join("");
}

function popDigits(group: HTMLElement, next: string): void {
  if (group.dataset.value === next) return;
  group.dataset.value = next;
  group.classList.remove("is-animating");
  group.innerHTML = splitDigits(next);
  void group.offsetWidth;
  group.classList.add("is-animating");
}

function rebuildFormatters(): void {
  timeFmt = makeTimeFmt();
  dateFmt = makeDateFmt();
  const periodEl = document.querySelector<HTMLElement>("[data-period]");
  periodEl?.toggleAttribute("hidden", hourCycle !== "h12");
  document.body.dataset.hour = hourCycle;
}

function tick(): void {
  const now = new Date();
  const hoursEl = document.querySelector<HTMLElement>("[data-hours]");
  const minutesEl = document.querySelector<HTMLElement>("[data-minutes]");
  const secondsEl = document.querySelector<HTMLElement>("[data-seconds]");
  const periodEl = document.querySelector<HTMLElement>("[data-period]");
  const dateEl = document.querySelector<HTMLElement>("[data-date]");
  const timeEl = document.querySelector<HTMLTimeElement>(".clock");
  const ring = document.querySelector<SVGCircleElement>(".ring-progress");

  const parts = Object.fromEntries(
    timeFmt.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const hours = parts.hour ?? "00";
  const minutes = parts.minute ?? "00";
  const seconds = parts.second ?? "00";
  const period = (parts.dayPeriod ?? "").replace(/\./g, "").trim();

  if (hoursEl) popDigits(hoursEl, hours);
  if (minutesEl) popDigits(minutesEl, minutes);
  if (secondsEl) secondsEl.textContent = pad(Number(seconds));
  if (periodEl) periodEl.textContent = period;
  if (dateEl) dateEl.textContent = dateFmt.format(now);
  if (timeEl) {
    timeEl.dateTime = now.toISOString();
    timeEl.setAttribute(
      "aria-label",
      hourCycle === "h12"
        ? `${hours}:${minutes}:${seconds} ${period} ${dateFmt.format(now)}`
        : `${hours}:${minutes}:${seconds} ${dateFmt.format(now)}`,
    );
  }
  if (ring) {
    const ms = Number(seconds) * 1000 + now.getMilliseconds();
    const circumference = 2 * Math.PI * 47.4;
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = String(circumference * (1 - ms / 60_000));
  }
  onTick?.(now);
  frame = requestAnimationFrame(tick);
}

export function getHourCycle(): HourCycle {
  return hourCycle;
}

export function setHourCycle(next: HourCycle): void {
  if (hourCycle === next) return;
  hourCycle = next;
  localStorage.setItem(STORAGE_KEY, next);
  localStorage.removeItem(LEGACY_HOUR_KEY);
  rebuildFormatters();
}

export function setClockTimezone(next: string): void {
  if (timezone === next) return;
  timezone = next;
  rebuildFormatters();
}

export function startClock(
  zone: string,
  tickHandler?: (now: Date) => void,
): void {
  timezone = zone;
  onTick = tickHandler;
  rebuildFormatters();
  if (started) return;
  started = true;
  tick();
}

export function stopClock(): void {
  cancelAnimationFrame(frame);
  started = false;
}
