export type TempUnit = "c" | "f";

const STORAGE_KEY = "cielo-temp";
const FAHRENHEIT = new Set([
  "US",
  "BS",
  "BZ",
  "KY",
  "PW",
  "FM",
  "MH",
  "AS",
  "GU",
  "MP",
  "PR",
  "VI",
  "UM",
]);

let chosen: TempUnit | null =
  localStorage.getItem(STORAGE_KEY) === "f"
    ? "f"
    : localStorage.getItem(STORAGE_KEY) === "c"
      ? "c"
      : null;
let inferred: TempUnit = unitFromCode(localeRegion());

function localeRegion(): string | undefined {
  try {
    return new Intl.Locale(navigator.language).maximize().region;
  } catch {
    return navigator.language.split("-")[1];
  }
}

function unitFromCode(code?: string): TempUnit {
  return code && FAHRENHEIT.has(code.toUpperCase()) ? "f" : "c";
}

export function getTempUnit(): TempUnit {
  return chosen ?? inferred;
}

export function setTempUnit(next: TempUnit): void {
  chosen = next;
  localStorage.setItem(STORAGE_KEY, next);
}

export function inferTempUnit(countryCode?: string): void {
  inferred = unitFromCode(countryCode || localeRegion());
}

export function formatTemperature(celsius: number | null | undefined): string {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return "—";
  const c = Math.round(celsius);
  if (getTempUnit() === "f") return `${Math.round(c * (9 / 5) + 32)}°F`;
  return `${c}°C`;
}
