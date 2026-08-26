export interface GeoFix {
  latitude: number;
  longitude: number;
  label: string;
}

interface GeoJs {
  latitude?: string;
  longitude?: string;
  city?: string;
  region?: string;
  country?: string;
}

interface ReverseGeo {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
}

function formatLabel(city?: string, country?: string): string {
  return [city, country].filter(Boolean).join(" : ");
}

async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("localityLanguage", "en");
    const response = await fetch(url);
    if (!response.ok) throw new Error("reverse geocode failed");
    const data = (await response.json()) as ReverseGeo;
    return (
      formatLabel(data.city || data.locality, data.countryName) ||
      `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`
    );
  } catch {
    return `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;
  }
}

function readBrowserLocation(timeoutMs = 7000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: 10 * 60 * 1000,
    });
  });
}

async function locateByIp(): Promise<GeoFix> {
  const response = await fetch("https://get.geojs.io/v1/ip/geo.json");
  if (!response.ok) throw new Error("IP lookup failed");
  const data = (await response.json()) as GeoJs;
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("IP lookup returned no coordinates");
  }
  return {
    latitude,
    longitude,
    label: formatLabel(data.city, data.country) || "Your sky",
  };
}

export async function locate(): Promise<GeoFix> {
  try {
    const position = await readBrowserLocation();
    const { latitude, longitude } = position.coords;
    const label = await reverseGeocode(latitude, longitude);
    return { latitude, longitude, label };
  } catch {
    return locateByIp();
  }
}
