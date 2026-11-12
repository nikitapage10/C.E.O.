import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverCallAnswer, searchAnswer } from "./calldeliver.ts";
import { clockLine } from "./clock.ts";
import { MemoryRoomLog } from "./log.ts";
import { lookupPrompt } from "./prompt.ts";
import { WEB_ACT, handle, type RoomSources } from "./toolroute.ts";
import { forgetSearches, forgetWaitingLines, isEmptyLookup, searchParams, voiceLookupPrompt, withoutMeta, type WebDeps } from "./voicelookups.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";
import { FALLBACK_PLACE, GEO_BASE, NO_WEATHER, NWS_BASE, forgetWeather, homeWeather, isHomeWeather, nwsPeriod, weatherText, type Weather } from "./weather.ts";
import { TOOL_DEFS } from "./voicecrew.ts";
import { ALL_TOOLS, EXECUTOR_NAMES } from "./agent/tools.ts";

/** #1069: a quick weather question gets a live forecast, today's date and a final spoken answer; no hand-off. */

// Thursday, November 12, 2026, 10:00 AM in Denver.
const NOW = Date.parse("2026-11-12T17:00:00Z");
const ZIP = "80000"; // a made-up ZIP: only checked never to leak

const point = { properties: { forecast: `${NWS_BASE}/gridpoints/XXX/1,2/forecast`, forecastHourly: `${NWS_BASE}/gridpoints/XXX/1,2/forecast/hourly`, relativeLocation: { properties: { city: "Testville", state: "CO" } } } };
const period = (name: string, temp: number, day: boolean, sky: string, rain: number, detail: string) => ({ name, temperature: temp, temperatureUnit: "F", isDaytime: day, shortForecast: sky, probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: rain }, windSpeed: "6 mph", windDirection: "SSE", detailedForecast: detail });
const forecast = {
  properties: {
    periods: [period("Today", 66, true, "Sunny", 0, "Sunny, with a high near 66. South wind around 6 mph."), period("Tonight", 39, false, "Mostly Clear", 0, "Mostly clear, with a low around 39."), period("Friday", 61, true, "Chance Snow Showers", 30, "")],
  },
};
const hourly = { properties: { periods: [{ startTime: "2026-11-12T09:00:00-07:00", endTime: "2026-11-12T10:00:00-07:00", temperature: 48, shortForecast: "Cloudy" }, { startTime: "2026-11-12T10:00:00-07:00", endTime: "2026-11-12T11:00:00-07:00", temperature: 52, shortForecast: "Sunny" }] } };

function fakeFetch(over: { nws?: boolean; geo?: unknown } = {}) {
  const urls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith(GEO_BASE)) return ok(over.geo ?? { results: [{ name: "Testville", latitude: 39.123456, longitude: -104.987654 }] });
    if (url.startsWith(NWS_BASE)) {
      if (over.nws === false) return new Response("down", { status: 503 });
      if (url.includes("/points/")) return ok(point);
      if (url.endsWith("/forecast/hourly")) return ok(hourly);
      if (url.endsWith("/forecast")) return ok(forecast);
    }
    if (url.startsWith("https://api.open-meteo.com/")) return ok({ current: { temperature_2m: 50.4, weather_code: 2 }, daily: { weather_code: [0, 71], temperature_2m_max: [64.6, 58], temperature_2m_min: [38, 30], precipitation_probability_max: [0, 40] } });
    return new Response("no", { status: 404 });
  });
  return { fetch: fn as unknown as typeof fetch, urls };
}

describe("the weather near home (#1069)", () => {
  afterEach(() => forgetWeather());

  it("reads the Weather Service's forecast for the home's town, today's date first, in a spoken-length shape", async () => {
    const f = fakeFetch();
    const w = await homeWeather({ fetch: f.fetch, zip: async () => ZIP, now: NOW });
    expect(w).toEqual<Weather>({
      place: "Testville",
      source: "National Weather Service",
      now: { temp: 52, sky: "Sunny" },
      periods: [
        { name: "Today", temp: 66, daytime: true, sky: "Sunny", rain: 0, wind: "SSE 6 mph", detail: "Sunny, with a high near 66. South wind around 6 mph." },
        { name: "Tonight", temp: 39, daytime: false, sky: "Mostly Clear", rain: 0, wind: "SSE 6 mph", detail: "Mostly clear, with a low around 39." },
        { name: "Friday", temp: 61, daytime: true, sky: "Chance Snow Showers", rain: 30, wind: "SSE 6 mph", detail: "" },
      ],
    });
    // The grid is asked at two decimals, no finer; the ZIP goes only to the geocoder.
    expect(f.urls.some((u) => u === `${NWS_BASE}/points/39.12,-104.99`)).toBe(true);
    expect(f.urls.filter((u) => u.includes(ZIP)).every((u) => u.startsWith(GEO_BASE))).toBe(true);
    const text = weatherText(w, NOW);
    expect(text).toContain(`for today, ${clockLine(NOW)}`);
    expect(text).toContain("Thursday, November 12, 2026");
    expect(text).toContain("Right now: 52 degrees, sunny.");
    expect(text).toContain("Today: Sunny, with a high near 66. South wind around 6 mph.");
    expect(text).toContain("Friday: Chance Snow Showers, high 61 degrees, wind SSE 6 mph, 30 percent chance of rain or snow.");
    expect(text).toMatch(/answer from it with confidence in one or two short sentences/);
    expect(text).not.toContain(ZIP);
    expect(isEmptyLookup(text)).toBe(false);
  });

  it("keeps a forecast ten minutes, so a follow-up is instant", async () => {
    const f = fakeFetch();
    await homeWeather({ fetch: f.fetch, zip: async () => ZIP, now: NOW });
    const n = f.urls.length;
    await homeWeather({ fetch: f.fetch, zip: async () => ZIP, now: NOW + 60_000 });
    expect(f.urls.length).toBe(n);
  });

  it("falls back to Denver without a ZIP, and to Open-Meteo when the Weather Service is down", async () => {
    const f = fakeFetch({ nws: false, geo: { results: [] } });
    const w = await homeWeather({ fetch: f.fetch, zip: async () => "", now: NOW });
    expect(f.urls[0]).toContain(`name=${FALLBACK_PLACE}`);
    expect(w).toMatchObject({ place: FALLBACK_PLACE, source: "Open-Meteo", now: { temp: 50, sky: "Partly cloudy" } });
    expect(w!.periods[0]).toMatchObject({ name: "Today", temp: 65, sky: "Clear" });
    expect(weatherText(null, NOW)).toBe(NO_WEATHER);
    expect(isEmptyLookup(NO_WEATHER)).toBe(true);
  });

  it("reads a period defensively", () => {
    expect(nwsPeriod({})).toBeNull();
    expect(nwsPeriod({ name: "Tonight", temperature: "cold" })).toEqual({ name: "Tonight", temp: null, daytime: false, sky: "", rain: null, wind: "", detail: "" });
  });

  it("knows a home-weather query from another city's", () => {
    for (const q of ["Denver weather today", "weather forecast Denver CO November 12 2026", "will it rain tonight", "what's the weather like near my place in Denver today", "do I need an umbrella", "Denver forecast this weekend"]) expect(isHomeWeather(q)).toBe(true);
    for (const q of ["Tokyo weather today", "weather in Chicago tomorrow", "Lamar Jackson injury status", "Broncos score", "who won the election"]) expect(isHomeWeather(q)).toBe(false);
  });

  it("is a tool on every surface: the one brain's, and the call's own", () => {
    expect(ALL_TOOLS.find((t) => t.name === "weather")).toMatchObject({ room: "haven", effect: "read" });
    expect(EXECUTOR_NAMES).toContain("weather");
    expect(TOOL_DEFS.find((t) => t.name === "read_weather")).toMatchObject({ read: "weather" });
  });
});

describe("today's date in the lookups (#1069)", () => {
  it("tells the search what today is, and to write only the findings", () => {
    const p = lookupPrompt(NOW);
    expect(p).toContain("Thursday, November 12, 2026");
    expect(p).toMatch(/never narrate what you are doing/);
    expect(voiceLookupPrompt(NOW)).toContain(p);
    expect(searchParams("q", undefined, NOW).system).toBe(voiceLookupPrompt(NOW));
  });

  it("drops the narration and the date doubts from a search's summary, and keeps the findings", () => {
    const raw = "Searching now. The site's page's date is Wednesday, which may not be today's date, so I'll flag it. Sunny with a high near 58 today. Check a live source such as the Weather Service to be sure.";
    expect(withoutMeta(raw)).toBe("Sunny with a high near 58 today.");
    expect(withoutMeta("Results were certified on Friday, November 6.")).toBe("Results were certified on Friday, November 6.");
  });
});

describe("a usable quick answer is final (#1069)", () => {
  afterEach(() => {
    forgetSearches();
    forgetWaitingLines();
    forgetWeather();
  });

  it("a stale date in a search result never sends the question deeper: it is kept as the answer, cleaned", async () => {
    const deep = vi.fn(async () => "deeper words");
    const kept: string[] = [];
    const text = 'Web search for "q": Searching now. The page is dated yesterday, which may not be today. Clear and 58 today, breezy tonight.';
    const how = await deliverCallAnswer({ id: "w1", ask: "q", depth: "talk", search: Promise.resolve(text) }, { keep: async (_id, t) => (kept.push(t), true), deep, now: Date.now });
    expect(how).toBe("search");
    expect(deep).not.toHaveBeenCalled();
    expect(kept).toEqual(["Clear and 58 today, breezy tonight."]);
    expect(searchAnswer('Web search for "q": Searching now.')).toBe("");
  });

  it("a weather web_search on a call is answered from the live forecast at once: no search, no hand-off", async () => {
    const crew = new MemoryCrewStore();
    const log = new MemoryRoomLog();
    const DESK = "a test desk key, not a real one";
    const token = (await issueToolToken(crew, DESK, "conv_live_1069", NOW + 12 * 60_000, NOW))!;
    const search = vi.fn(async () => ({ text: "a web page", usage: { input_tokens: 1, output_tokens: 1 }, usd: 0.01 }));
    const web: WebDeps = { search, canSpend: async () => true, addSpend: async () => undefined };
    const sources = { web, weather: async () => "Live forecast near home (Testville), for today. Today: Sunny, high near 66." } as unknown as RoomSources;
    const deliver = vi.fn();
    const d = { deskKey: DESK, crew, log, sources, now: NOW, deliver };
    const post = (query: string) => handle(new Request(`https://ceo.test/api/skippy-tools?act=${WEB_ACT}`, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }), d);
    const body = (await (await post("Denver weather today")).json()) as { text: string; escalated?: boolean };
    expect(body.text).toContain("Today: Sunny, high near 66.");
    expect(body.escalated).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(await log.list("kernel", NOW)).toEqual([]);
    // The call's own read_weather: the same text, straight.
    const read = (await (await handle(new Request("https://ceo.test/api/skippy-tools?read=weather", { headers: { [TOOL_HEADER]: token } }), d)).json()) as { text: string };
    expect(read.text).toContain("Today: Sunny");
    // Another city's weather is still a web search.
    await post("Tokyo weather today");
    expect(search).toHaveBeenCalledTimes(1);
  });
});
