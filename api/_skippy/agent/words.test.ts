import { describe, expect, it } from "vitest";
import { ALL_LIGHTS, directAsk, infoQuestion, lightsAsk, scheduleAsk, spokenAsked, spokenLights } from "./words.ts";

describe("a schedule question reads that device's schedule, on every surface (#952)", () => {
  it("knows which device's schedule is asked about", () => {
    expect(scheduleAsk("When is the next wet food cycle for my cat?")).toBe("wet-feeder");
    expect(scheduleAsk("what time is the cat's next wet meal")).toBe("wet-feeder");
    expect(scheduleAsk("when does the dry food feeder feed next?")).toBe("dry-feeder");
    expect(scheduleAsk("when is the cat's next meal?")).toBe("feeders");
    expect(scheduleAsk("Um, can you tell me what the vacuum cleaner's next schedule is gonna be?")).toBe("vacuum");
    expect(scheduleAsk("when is the next Eagles game?")).toBeNull();
    expect(scheduleAsk("feed the cat")).toBeNull();
    expect(scheduleAsk("when did the vacuum last clean the kitchen?")).toBeNull();
  });
  it("the rules answer it with the read, never by running the device", () => {
    expect(directAsk("When is the next wet food cycle for my cat?")).toEqual({ tool: "home_status", input: { about: "wet-feeder" } });
    expect(directAsk("what's the vacuum's schedule?")).toEqual({ tool: "home_status", input: { about: "vacuum" } });
  });
});

describe("a question never runs a home device (2026-11-06)", () => {
  const asked = "Yeah. Um, can you tell me, um, what the vacuum cleaner's, uh, next schedule is gonna be?";

  it("reads the question as a question", () => {
    expect(infoQuestion(asked)).toBe(true);
    expect(infoQuestion("is the vacuum running?")).toBe(true);
    expect(infoQuestion("when does the litter box run next")).toBe(true);
    expect(infoQuestion("um, what's the wet feeder's schedule")).toBe(true);
  });

  it("the rules never turn it into an order", () => {
    expect(directAsk(asked)?.tool).toBe("home_status");
    expect(directAsk("when did the vacuum last clean the kitchen?")).toBeNull();
  });

  it("the model's call to run it is refused", () => {
    expect(spokenAsked(asked, { action: "vacuum.start" })).toBe(false);
    expect(spokenAsked(asked, { action: "vacuum.rooms" })).toBe(false);
  });

  it("plain orders still run, fillers and all", () => {
    expect(infoQuestion("can you vacuum the kitchen?")).toBe(false);
    expect(directAsk("yeah, um, vacuum the kitchen")?.input.action).toBe("vacuum.rooms");
    expect(directAsk("can you open the wet food feeder")?.input.action).toBe("wet.open");
    expect(directAsk("send the vacuum home")?.input.action).toBe("vacuum.dock");
    expect(spokenAsked("Yeah, I didn't want that. Send the vacuum back.", { action: "vacuum.dock" })).toBe(true);
    expect(directAsk("what's in the wet feeder?")).toEqual({ tool: "home_status", input: { about: "wet-feeder" } });
    expect(directAsk("what's the temperature in the apartment?")?.tool).toBe("home_status");
  });
});

describe("a plain order switches the lights, said anywhere (#1011)", () => {
  it("reads the order, which way and which lights", () => {
    expect(directAsk("Turn on the lights.")).toEqual({ tool: "lights_set", input: { name: ALL_LIGHTS, on: true } });
    expect(directAsk("hey Skippy, turn off all the lights")).toEqual({ tool: "lights_set", input: { name: ALL_LIGHTS, on: false } });
    expect(directAsk("lights off")).toEqual({ tool: "lights_set", input: { name: ALL_LIGHTS, on: false } });
    expect(directAsk("can you switch the study lamp on please")).toEqual({ tool: "lights_set", input: { name: "study lamp", on: true } });
    expect(directAsk("kill the lights")).toEqual({ tool: "lights_set", input: { name: ALL_LIGHTS, on: false } });
    expect(lightsAsk("turn the kitchen lights on")).toEqual({ name: "kitchen lights", on: true });
    expect(lightsAsk("turn on the vacuum")).toBeNull();
    expect(lightsAsk("turn on the charm")).toBeNull();
  });
  it("a question about the lights never switches them", () => {
    expect(directAsk("are the lights on?")).toBeNull();
    expect(directAsk("is the porch light off")).toBeNull();
    expect(directAsk("did I leave the lights on")).toBeNull();
    expect(spokenLights("are the lights on?", "lights_set", { name: "all", on: true })).toBe(false);
  });
  it("the model's switch runs only on Nikita's own words for it", () => {
    expect(spokenLights("turn on the lights", "lights_set", { name: "all", on: true })).toBe(true);
    expect(spokenLights("turn on the lights", "lights_set", { name: "all", on: false })).toBe(false);
    expect(spokenLights("switch the beamer on", "lights_set", { name: "Beamer", on: true })).toBe(true);
    expect(spokenLights("what's for dinner", "lights_set", { name: "Porch", on: true })).toBe(false);
    expect(spokenLights("movie night", "lights_scene", { name: "Movie night" })).toBe(true);
    expect(spokenLights("turn on the lights", "lights_scene", { name: "Turn off lights" })).toBe(false);
    expect(spokenLights(undefined, "lights_set", { name: "all", on: true })).toBe(false);
  });
});
