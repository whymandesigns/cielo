import type { DayPhase, SkyKind } from "./sky";

export interface WeatherReading {
  kind: SkyKind;
  atmosphere: Exclude<SkyKind, "sunrise" | "sunset">;
  phase: DayPhase;
  temperature: number | null;
  timezone: string;
  sunrise: Date | null;
  sunset: Date | null;
}

interface OpenMeteoResponse {
  timezone?: string;
  current?: {
    weather_code?: number;
    cloud_cover?: number;
    precipitation?: number;
    is_day?: number;
    temperature_2m?: number;
    time?: string;
  };
  daily?: {
    sunrise?: string[];
    sunset?: string[];
  };
}

const WINDOW_MS = 45 * 60 * 1000;

function parseLocal(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nearEvent(now: number, event: Date | null): boolean {
  if (!event) return false;
  return Math.abs(now - event.getTime()) <= WINDOW_MS;
}

function fromWeatherCode(
  code: number | undefined,
  cloudCover: number | undefined,
  precipitation: number | undefined,
): Exclude<SkyKind, "sunrise" | "sunset"> {
  if ((precipitation ?? 0) > 0.1) return "rainy";
  if (code !== undefined) {
    if (
      (code >= 51 && code <= 67) ||
      (code >= 80 && code <= 82) ||
      (code >= 95 && code <= 99) ||
      (code >= 71 && code <= 77) ||
      (code >= 85 && code <= 86)
    ) {
      return "rainy";
    }
    if (code === 0 || code === 1) return "sunny";
    if (code >= 2) return "cloudy";
  }
  if ((cloudCover ?? 0) >= 55) return "cloudy";
  return "sunny";
}

export function classifySky(data: OpenMeteoResponse, now = new Date()): {
  kind: SkyKind;
  atmosphere: Exclude<SkyKind, "sunrise" | "sunset">;
  phase: DayPhase;
} {
  const sunrise = parseLocal(data.daily?.sunrise?.[0]);
  const sunset = parseLocal(data.daily?.sunset?.[0]);
  const stamp = now.getTime();
  const atmosphere = fromWeatherCode(
    data.current?.weather_code,
    data.current?.cloud_cover,
    data.current?.precipitation,
  );

  let kind: SkyKind = atmosphere;
  if (nearEvent(stamp, sunrise)) kind = "sunrise";
  else if (nearEvent(stamp, sunset)) kind = "sunset";

  const isDayFlag = data.current?.is_day;
  const afterSunrise = sunrise ? stamp >= sunrise.getTime() : true;
  const beforeSunset = sunset ? stamp < sunset.getTime() : true;
  const phase: DayPhase =
    kind === "sunrise" || kind === "sunset"
      ? "day"
      : isDayFlag === 0 || !(afterSunrise && beforeSunset)
        ? "night"
        : "day";

  return { kind, atmosphere, phase };
}

export async function fetchWeather(
  latitude: number,
  longitude: number,
): Promise<WeatherReading> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set(
    "current",
    "weather_code,cloud_cover,precipitation,is_day,temperature_2m",
  );
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Weather request failed");
  const data = (await response.json()) as OpenMeteoResponse;
  const { kind, atmosphere, phase } = classifySky(data);

  return {
    kind,
    atmosphere,
    phase,
    temperature:
      typeof data.current?.temperature_2m === "number" ? data.current.temperature_2m : null,
    timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    sunrise: parseLocal(data.daily?.sunrise?.[0]),
    sunset: parseLocal(data.daily?.sunset?.[0]),
  };
}
