import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hands-free listening for Relay's Thread (#615): the browser's own continuous speech recognition (Chrome, Edge and
 * Safari have it; the audio never passes through C.E.O.), with no wake word. Opt-in: nothing listens until Nikita
 * turns it on, and the choice is remembered on this device only. Each finished phrase goes to `onLine`; the half-heard
 * tail shows as it comes. The browser ends a session now and then (silence, a network blip); while it's on, it starts
 * again. Hold Space for a one-off listen instead. Where the browser has no SpeechRecognition, `supported` is false and
 * the Thread runs on keys and taps alone.
 */

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = (): boolean => recognitionClass() !== null;

const PREF = "ceo.relay.voice";
const readPref = () => {
  try {
    return window.localStorage.getItem(PREF) === "on";
  } catch {
    return false;
  }
};
const writePref = (on: boolean) => {
  try {
    window.localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    /* private window: the choice lasts this visit */
  }
};

export type VoiceMode = "off" | "on" | "hold";

export function useVoice(onLine: (line: string) => void) {
  const supported = voiceSupported();
  const [mode, setMode] = useState<VoiceMode>("off");
  const [tail, setTail] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const want = useRef<VoiceMode>("off");
  const line = useRef(onLine);
  line.current = onLine;

  const begin = useCallback(() => {
    const Rec = recognitionClass();
    if (!Rec || rec.current) return;
    const r = new Rec();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = (res[0]?.transcript ?? "").trim();
        if (res.isFinal) {
          if (text) {
            setHeard(text);
            line.current(text);
          }
        } else t += `${text} `;
      }
      setTail(t.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        want.current = "off";
        writePref(false);
        setMode("off");
        setError("The browser blocked the microphone. Keys and taps still work.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") setError("Couldn't hear that. Say it again, or type it.");
    };
    r.onend = () => {
      rec.current = null;
      setTail("");
      // Still on: the browser ended the session by itself, so start again.
      if (want.current === "on") window.setTimeout(() => want.current === "on" && begin(), 250);
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      rec.current = null;
      setError("Couldn't start listening.");
    }
  }, []);

  const end = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setTail("");
  }, []);

  const turn = useCallback(
    (on: boolean) => {
      if (!supported) return;
      want.current = on ? "on" : "off";
      writePref(on);
      setMode(want.current);
      setError(null);
      if (on) begin();
      else end();
    },
    [supported, begin, end],
  );

  /** Hold to talk (Space): listens while held, unless it's on already. */
  const hold = useCallback(
    (down: boolean) => {
      if (!supported || want.current === "on") return;
      want.current = down ? "hold" : "off";
      setMode(want.current);
      if (down) begin();
      else end();
    },
    [supported, begin, end],
  );

  // Back on if Nikita left it on, on this device.
  useEffect(() => {
    if (supported && readPref()) turn(true);
    return () => {
      want.current = "off";
      rec.current?.abort();
      rec.current = null;
    };
  }, [supported, turn]);

  return { supported, mode, listening: mode !== "off", tail, heard, error, turn, hold, setHeard };
}
