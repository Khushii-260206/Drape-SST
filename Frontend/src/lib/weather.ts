/*
 * Weather for outfit advice, from Open-Meteo (free, no API key, allows browser requests). The user
 * picks a city once (or shares their location); it is remembered in this browser, and today's weather
 * is cached for 30 minutes. If anything fails the stylist simply answers without weather.
 */

export type Place = { name: string; lat: number; lon: number };

export type Weather = {
  tempC: number;
  feelsC: number;
  highC: number;
  lowC: number;
  rainChance: number | null;
  windKmh: number;
  code: number;
  isDay: boolean;
  /** When this reading was fetched (ms). */
  at: number;
  place: string;
};

const PLACE_KEY = "drape:place:v1";
const WEATHER_KEY = "drape:weather:v1";
const FRESH_MS = 30 * 60_000;
const STALE_OK_MS = 6 * 3600_000;

function read<T>(key: string): T | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the place just won't be remembered
  }
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function readPlace(): Place | null {
  const p = read<Place>(PLACE_KEY);
  return p && typeof p.name === "string" && num(p.lat) && num(p.lon) ? p : null;
}

export function savePlace(place: Place | null) {
  write(PLACE_KEY, place);
  write(WEATHER_KEY, null);
}

function readCachedWeather(place: Place | null, now = Date.now()): Weather | null {
  if (!place) return null;
  const w = read<Weather>(WEATHER_KEY);
  if (!w || w.place !== place.name || !num(w.at) || now - w.at > STALE_OK_MS) return null;
  return w;
}

const isFresh = (w: Weather, now = Date.now()) => now - w.at < FRESH_MS;

// ---------------------------------------------------------------- lookups

export type PlaceResult = Place & { detail: string };

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
    { signal }
  );
  if (!res.ok) throw new Error("Couldn't search for that place.");
  const json = (await res.json()) as {
    results?: { name?: string; latitude?: number; longitude?: number; admin1?: string; country?: string }[];
  };
  return (json.results ?? [])
    .filter((r) => typeof r.name === "string" && num(r.latitude) && num(r.longitude))
    .map((r) => ({
      name: r.name as string,
      lat: r.latitude as number,
      lon: r.longitude as number,
      detail: [r.admin1, r.country].filter(Boolean).join(", "),
    }));
}

async function fetchWeather(place: Place, signal?: AbortSignal): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(4)}&longitude=${place.lon.toFixed(4)}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Couldn't load the weather.");
  const j = (await res.json()) as {
    current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[] };
  };
  const c = j.current;
  if (!c || !num(c.temperature_2m)) throw new Error("Couldn't read the weather.");
  const weather: Weather = {
    tempC: c.temperature_2m,
    feelsC: num(c.apparent_temperature) ? c.apparent_temperature : c.temperature_2m,
    highC: j.daily?.temperature_2m_max?.[0] ?? c.temperature_2m,
    lowC: j.daily?.temperature_2m_min?.[0] ?? c.temperature_2m,
    rainChance: j.daily?.precipitation_probability_max?.[0] ?? null,
    windKmh: num(c.wind_speed_10m) ? c.wind_speed_10m : 0,
    code: num(c.weather_code) ? c.weather_code : 0,
    isDay: c.is_day !== 0,
    at: Date.now(),
    place: place.name,
  };
  write(WEATHER_KEY, weather);
  return weather;
}

/** Cached weather if it is fresh, otherwise a fetch (falling back to a stale reading if offline). */
export async function loadWeather(place: Place | null, signal?: AbortSignal): Promise<Weather | null> {
  if (!place) return null;
  const cached = readCachedWeather(place);
  if (cached && isFresh(cached)) return cached;
  try {
    return await fetchWeather(place, signal);
  } catch {
    return cached;
  }
}

// ---------------------------------------------------------------- wording

/** WMO weather-interpretation codes → plain words. */
export function describeWeather(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 65) return code === 65 ? "Heavy rain" : "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return code === 82 ? "Violent showers" : "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Mixed weather";
}

export type WeatherKind = "clear" | "night" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export function weatherKind(code: number, isDay: boolean): WeatherKind {
  if (code === 0 || code === 1) return isDay ? "clear" : "night";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

/** The one-line weather brief handed to the stylist. */
export function weatherForPrompt(w: Weather): string {
  const rain = w.rainChance !== null ? `, ${Math.round(w.rainChance)}% chance of rain` : "";
  return `${w.place}: ${describeWeather(w.code).toLowerCase()}, ${Math.round(w.tempC)}°C now (feels like ${Math.round(w.feelsC)}°C), today ${Math.round(w.lowC)}–${Math.round(w.highC)}°C${rain}, wind ${Math.round(w.windKmh)} km/h`;
}
