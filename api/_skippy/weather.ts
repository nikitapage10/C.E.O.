/**
 * The weather near home (#1069): a live forecast, keyless and free, for every Skippy surface (the one brain's
 * `weather` tool, rooms/haven/tools.ts; the call's `read_weather`; the Kernel responder's `weather`).
 *
 * Nikita, 2026-11-12: a call's weather question went to a web search, which read a forecast page a day stale, hedged
 * on the date and was passed on. The weather now comes from the National Weather Service's own forecast instead:
 *
 *   1. Where: the home's ZIP as the Haven keeps it privately (the King Soopers picker's ZIP, `haven/kroger.json`), read
 *      at run time and turned into a town by Open-Meteo's geocoder (city level; the ZIP itself is never said, logged
 *      or kept here). No ZIP, or no answer: Denver, the city (rooms/haven/web/daylight.ts). Nothing about the home
 *      is in the code.
 *   2. The forecast: api.weather.gov (`/points` once a day per place, then the forecast and the hourly forecast), the
 *      National Weather Service's free API, which asks only for a User-Agent. Open-Meteo's forecast when it fails.
 *   3. The text: today's date first (clock.ts), right now, then the next periods, short enough to say in a sentence.
 *
 * A forecast is kept ten minutes per place on a warm instance, so a follow-up is instant.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { DENVER } from "../../rooms/haven/web/daylight.js";
import { clockLine, HOME_TZ } from "./clock.js";
import { capLines, said } from "./voicereads.js";

export const NWS_BASE = "https://api.weather.gov";
export const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";
export const METEO_BASE = "https://api.open-meteo.com/v1/forecast";
/** What the Weather Service asks every client to send. Generic: no contact detail. */
export const NWS_AGENT = "C.E.O. Desk weather (keyless)";
/** How long a forecast is kept per place. */
export const WEATHER_KEEP_MS = 10 * 60_000;
/** How long a place (geocoded ZIP, the Weather Service's grid) is kept. */
const PLACE_KEEP_MS = 24 * 60 * 60_000;
/** Each request's own limit, well inside the call tool's budget. */
const REQUEST_MS = 2_500;

/** The fallback place: Denver, the city. */
export const FALLBACK_PLACE = "Denver";

/** Said when no forecast answered: the route then passes the question on (voicelookups.ts isEmptyLookup). */
export const NO_WEATHER = "The live forecast didn't answer just now.";

export interface WeatherPeriod {
  /** The period's name as the forecast gives it: "Today", "This Afternoon", "Tonight", "Friday". */
  name: string;
  /** Degrees Fahrenheit: the high in the day, the low at night. */
  temp: number | null;
  daytime: boolean;
  /** "Sunny", "Chance Rain Showers". */
  sky: string;
  /** The chance of rain or snow, percent; null when not given. */
  rain: number | null;
  /** "SSE 6 mph", or "". */
  wind: string;
  /** The forecaster's own sentence or two, or "". */
  detail: string;
}

export interface Weather {
  /** The town, as the forecast names it ("Denver"): never more precise than that. */
  place: string;
  source: "National Weather Service" | "Open-Meteo";
  now: { temp: number | null; sky: string } | null;
  periods: WeatherPeriod[];
}

export interface WeatherDeps {
  fetch: typeof fetch;
  /** The home's ZIP from the Haven's private store, or "" when none is set. */
  zip: () => Promise<string>;
  now: number;
}

interface Spot {
  lat: number;
  lon: number;
  name: string;
}

const places = new Map<string, { at: number; spot: Spot }>();
const grids = new Map<string, { at: number; forecast: string; hourly: string; city: string }>();
const kept = new Map<string, { at: number; weather: Weather }>();
export const forgetWeather = () => {
  places.clear();
  grids.clear();
  kept.clear();
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? said(v, max) : "");
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function getJson(d: WeatherDeps, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await d.fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(REQUEST_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const nws = (d: WeatherDeps, url: string) => getJson(d, url, { "User-Agent": NWS_AGENT, Accept: "application/geo+json" });

/** Two decimals (about a kilometre): plenty for a forecast grid, and no finer than it needs. */
const round = (n: number) => Math.round(n * 100) / 100;

/** The home's town from its ZIP (Open-Meteo's geocoder), else Denver. */
export async function homeSpot(d: WeatherDeps): Promise<Spot> {
  const zip = await d.zip().catch(() => "");
  const name = /^\d{5}$/.test(zip) ? zip : FALLBACK_PLACE;
  const k = places.get(name);
  if (k && d.now - k.at < PLACE_KEEP_MS) return k.spot;
  const fallback: Spot = { lat: DENVER.lat, lon: DENVER.lon, name: FALLBACK_PLACE };
  try {
    const got = o(await getJson(d, `${GEO_BASE}?${new URLSearchParams({ name, count: "1", countryCode: "US", language: "en", format: "json" })}`));
    const r = o(Array.isArray(got.results) ? got.results[0] : null);
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    if (lat === null || lon === null) return fallback;
    const spot = { lat: round(lat), lon: round(lon), name: str(r.name, 40) || FALLBACK_PLACE };
    if (places.size > 20) places.clear();
    places.set(name, { at: d.now, spot });
    return spot;
  } catch {
    return fallback;
  }
}

const pct = (v: unknown): number | null => num(o(v).value);

/** One Weather Service period, read defensively. */
export function nwsPeriod(v: unknown): WeatherPeriod | null {
  const p = o(v);
  const name = str(p.name, 30);
  if (!name) return null;
  const wind = [str(p.windDirection, 4), str(p.windSpeed, 20)].filter(Boolean).join(" ");
  return { name, temp: num(p.temperature), daytime: p.isDaytime === true, sky: str(p.shortForecast, 60), rain: pct(p.probabilityOfPrecipitation), wind, detail: str(p.detailedForecast, 240) };
}

/** The Weather Service's forecast for a spot: its grid (kept a day), then the forecast and the hourly one together. */
async function fromNws(d: WeatherDeps, spot: Spot): Promise<Weather | null> {
  const key = `${spot.lat},${spot.lon}`;
  let grid = grids.get(key);
  if (!grid || d.now - grid.at > PLACE_KEEP_MS) {
    const props = o(o(await nws(d, `${NWS_BASE}/points/${spot.lat},${spot.lon}`)).properties);
    const forecast = typeof props.forecast === "string" ? props.forecast : "";
    const hourly = typeof props.forecastHourly === "string" ? props.forecastHourly : "";
    if (!forecast.startsWith(`${NWS_BASE}/`)) return null;
    grid = { at: d.now, forecast, hourly: hourly.startsWith(`${NWS_BASE}/`) ? hourly : "", city: str(o(o(props.relativeLocation).properties).city, 40) };
    if (grids.size > 20) grids.clear();
    grids.set(key, grid);
  }
  const [daily, hourly] = await Promise.all([nws(d, grid.forecast), grid.hourly ? nws(d, grid.hourly).catch(() => null) : Promise.resolve(null)]);
  const periods = (Array.isArray(o(o(daily).properties).periods) ? (o(o(daily).properties).periods as unknown[]) : []).map(nwsPeriod).filter((p): p is WeatherPeriod => p !== null);
  if (!periods.length) return null;
  const hours = Array.isArray(o(o(hourly).properties).periods) ? (o(o(hourly).properties).periods as unknown[]) : [];
  // The hour that holds now (the list starts at the current hour; an older copy may lead with a past one).
  const hour = hours.map(o).find((h) => Date.parse(String(h.endTime)) > d.now);
  const now = hour ? { temp: num(hour.temperature), sky: str(hour.shortForecast, 60) } : null;
  return { place: grid.city || spot.name, source: "National Weather Service", now, periods: periods.slice(0, 4) };
}

/** WMO weather codes as words (Open-Meteo). */
const WMO: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms", 96: "Thunderstorms with hail", 99: "Thunderstorms with hail",
};
const sky = (code: unknown) => WMO[num(code) ?? -1] ?? "";

/** Open-Meteo's forecast for a spot, when the Weather Service didn't answer. */
async function fromMeteo(d: WeatherDeps, spot: Spot): Promise<Weather | null> {
  const q = new URLSearchParams({
    latitude: String(spot.lat),
    longitude: String(spot.lon),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "2",
    timezone: HOME_TZ,
    temperature_unit: "fahrenheit",
  });
  const got = o(await getJson(d, `${METEO_BASE}?${q}`));
  const daily = o(got.daily);
  const at = (k: string, i: number) => (Array.isArray(daily[k]) ? (daily[k] as unknown[])[i] : null);
  const periods: WeatherPeriod[] = [];
  for (const [i, name] of ["Today", "Tomorrow"].entries()) {
    const hi = num(at("temperature_2m_max", i));
    if (hi === null) continue;
    const lo = num(at("temperature_2m_min", i));
    periods.push({ name, temp: Math.round(hi), daytime: true, sky: sky(at("weather_code", i)), rain: num(at("precipitation_probability_max", i)), wind: "", detail: lo === null ? "" : `High near ${Math.round(hi)}, low around ${Math.round(lo)}.` });
  }
  if (!periods.length) return null;
  const cur = o(got.current);
  const t = num(cur.temperature_2m);
  return { place: spot.name, source: "Open-Meteo", now: t === null ? null : { temp: Math.round(t), sky: sky(cur.weather_code) }, periods };
}

/** The forecast near home: the Weather Service's, else Open-Meteo's; null when neither answered. */
export async function homeWeather(d: WeatherDeps): Promise<Weather | null> {
  const spot = await homeSpot(d);
  const key = `${spot.lat},${spot.lon}`;
  const k = kept.get(key);
  if (k && d.now - k.at < WEATHER_KEEP_MS) return k.weather;
  const weather = (await fromNws(d, spot).catch(() => null)) ?? (await fromMeteo(d, spot).catch(() => null));
  if (weather) {
    if (kept.size > 20) kept.clear();
    kept.set(key, { at: d.now, weather });
  }
  return weather;
}

const deg = (n: number | null) => (n === null ? "" : `${Math.round(n)} degrees`);

/** One period as a short line. */
function periodLine(p: WeatherPeriod): string {
  const rain = p.rain !== null && p.rain > 0 ? `, ${p.rain} percent chance of rain or snow` : "";
  if (p.detail) return `${p.name}: ${p.detail.replace(/\.$/, "")}${rain}.`;
  const temp = p.temp === null ? "" : `, ${p.daytime ? "high" : "low"} ${deg(p.temp)}`;
  return `${p.name}: ${p.sky || "no summary"}${temp}${p.wind ? `, wind ${p.wind}` : ""}${rain}.`;
}

/**
 * The forecast as the tools hear it. Today's date leads, so whatever reads it never doubts which day it is; the
 * instruction after it keeps the answer to a sentence or two.
 */
export function weatherText(w: Weather | null, now: number): string {
  if (!w) return NO_WEATHER;
  return capLines([
    `Live forecast near home (${said(w.place, 40)}), from the ${w.source}, for today, ${clockLine(now)}.`,
    w.now ? `Right now: ${deg(w.now.temp)}${w.now.sky ? `, ${w.now.sky.toLowerCase()}` : ""}.` : "",
    ...w.periods.slice(0, 3).map(periodLine),
    "This is today's live forecast: answer from it with confidence in one or two short sentences (the high, the sky, and rain or snow when there is any), without doubting the date or naming the source unless asked.",
  ]);
}

/** The words a question about the weather uses. */
const WEATHER_WORDS = /\b(?:weather|forecast|rain(?:ing|y)?|snow(?:ing|y)?|umbrella|temperature|temp|how (?:hot|cold|warm)|sunny|cloudy|windy|storm(?:s|y)?|degrees|high|low|hail|sleet|frost|freez(?:e|ing))\b/i;
/** What a home-weather query may say beside the weather words: when, here, home, Denver. */
const HOME_WORDS = /\b(?:weather|forecast|rain(?:ing|y)?|snow(?:ing|y)?|umbrella|temperature|temp|how|hot|cold|warm|sunny|cloudy|windy|storms?|stormy|degrees|high|low|hail|sleet|frost|freez(?:e|ing)|today|todays|tonight|tomorrow|now|right|current|currently|this|morning|afternoon|evening|week|weekend|later|outside|out|here|home|my|place|near|nearby|around|in|at|for|the|a|is|it|will|be|going|to|what|whats|s|like|looking|look|does|do|i|need|an|and|of|co|colorado|denver|area|local|forecasted|chance|hourly|daily|nws|national|service|november|december|january|february|march|april|may|june|july|august|september|october|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+(?:st|nd|rd|th)?)\b/gi;

/**
 * Whether a web query is the weather near home ("Denver weather today", "will it rain tonight"), so the call answers
 * it from the live forecast instead of a web page. A query that names another place ("Tokyo weather") is not.
 */
export function isHomeWeather(query: string): boolean {
  const q = query.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ");
  if (!WEATHER_WORDS.test(q)) return false;
  return q.replace(HOME_WORDS, " ").trim() === "";
}
