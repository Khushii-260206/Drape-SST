"use client";

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  LocateFixed,
  MapPin,
  Moon,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  describeWeather,
  loadWeather,
  readPlace,
  savePlace,
  searchPlaces,
  weatherKind,
  type Place,
  type PlaceResult,
  type Weather,
  type WeatherKind,
} from "@/lib/weather";
import { cn } from "@/lib/utils";
import { Modal } from "../ui/Modal";

// ---------------------------------------------------------------- remembered place (external store)

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedPlace: Place | null = null;

function placeSnapshot(): Place | null {
  const raw = (() => {
    try {
      return localStorage.getItem("drape:place:v1");
    } catch {
      return null;
    }
  })();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPlace = readPlace();
  }
  return cachedPlace;
}

function subscribePlace(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === "drape:place:v1" || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function usePlace(): Place | null {
  return useSyncExternalStore(subscribePlace, placeSnapshot, () => null);
}

function choosePlace(place: Place | null) {
  savePlace(place);
  listeners.forEach((l) => l());
}

function useWeather(place: Place | null): Weather | null {
  const [state, setState] = useState<{ key: string; weather: Weather | null } | null>(null);
  const key = place ? `${place.name}|${place.lat}|${place.lon}` : null;
  useEffect(() => {
    if (!place || !key) return;
    const controller = new AbortController();
    loadWeather(place, controller.signal).then((weather) => {
      if (!controller.signal.aborted) setState({ key, weather });
    });
    return () => controller.abort();
    // `place` is represented by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && state?.key === key ? state.weather : null;
}

// ---------------------------------------------------------------- UI

const ICONS: Record<WeatherKind, LucideIcon> = {
  clear: Sun,
  night: Moon,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

function WeatherIcon({ weather, className }: { weather: Weather; className?: string }) {
  const Icon = ICONS[weatherKind(weather.code, weather.isDay)];
  return <Icon className={className} aria-hidden />;
}

function PlaceModal({ open, onClose, current }: { open: boolean; onClose: () => void; current: Place | null }) {
  return (
    <Modal open={open} onClose={onClose} title="Weather for your outfits" className="sm:max-w-md">
      {open && <PlaceForm onClose={onClose} current={current} />}
    </Modal>
  );
}

function PlaceForm({ onClose, current }: { onClose: () => void; current: Place | null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "none" | "error">("idle");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        if (q.length < 2) {
          setResults([]);
          setStatus("idle");
          return;
        }
        setStatus("searching");
        searchPlaces(q, controller.signal)
          .then((r) => {
            if (controller.signal.aborted) return;
            setResults(r);
            setStatus(r.length ? "idle" : "none");
          })
          .catch(() => {
            if (!controller.signal.aborted) setStatus("error");
          });
      },
      q.length < 2 ? 0 : 300
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function pick(p: Place) {
    choosePlace({ name: p.name, lat: p.lat, lon: p.lon });
    onClose();
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocError("Your browser can't share its location — search for your city instead.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick({ name: "Your location", lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setLocError("Couldn't get your location — allow it in the browser, or search for your city.");
      },
      { timeout: 10_000, maximumAge: 10 * 60_000 }
    );
  }

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm leading-relaxed text-gray-600">
        Pick your city and Drape will factor today&apos;s weather into every outfit. It&apos;s remembered on this device only.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for your city…"
          aria-label="City"
          className="w-full rounded-full border border-gray-200 bg-surface py-2.5 pr-4 pl-10 text-base shadow-soft transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:text-sm"
        />
      </div>

      {status === "searching" && <p className="text-sm text-gray-500">Searching…</p>}
      {status === "none" && <p className="text-sm text-gray-500">No place found — try another spelling.</p>}
      {status === "error" && <p className="text-sm text-red-600">Couldn&apos;t search right now. Check your connection.</p>}

      {results.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl ring-1 ring-gray-200">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
              >
                <MapPin className="size-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{r.name}</span>
                  {r.detail && <span className="block truncate text-xs text-gray-500">{r.detail}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="inline-flex items-center gap-2 btn-secondary rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
        >
          <LocateFixed className="size-4 text-blush-600" aria-hidden /> {locating ? "Locating…" : "Use my location"}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => {
              choosePlace(null);
              onClose();
            }}
            className="text-sm text-red-500 hover:text-red-600 hover:underline"
          >
            Turn weather off
          </button>
        )}
      </div>
      {locError && <p className="text-sm text-red-600">{locError}</p>}
    </div>
  );
}

/** Today's weather on the welcome screen — or an invitation to add a city. */
export function WeatherChip({ className }: { className?: string }) {
  const place = usePlace();
  const weather = useWeather(place);
  const [open, setOpen] = useState(false);

  const base =
    "glass-card inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition hover:border-gray-300 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none";

  return (
    <>
      {place && weather ? (
        <button type="button" onClick={() => setOpen(true)} className={cn(base, className)} aria-label={`Weather in ${place.name}: change place`}>
          <WeatherIcon weather={weather} className="size-4.5 shrink-0 text-blush-600" />
          <span className="truncate">
            <span className="font-semibold text-gray-900">{Math.round(weather.tempC)}°</span>
            <span className="text-gray-600"> · {describeWeather(weather.code)} · {place.name}</span>
          </span>
        </button>
      ) : place ? (
        <button type="button" onClick={() => setOpen(true)} className={cn(base, "text-gray-500", className)}>
          <MapPin className="size-4 shrink-0" aria-hidden /> {place.name} · loading weather…
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={cn(base, "text-gray-600", className)}>
          <CloudSun className="size-4.5 shrink-0 text-blush-600" aria-hidden /> Add your city for weather-aware outfits
        </button>
      )}
      <PlaceModal open={open} onClose={() => setOpen(false)} current={place} />
    </>
  );
}
