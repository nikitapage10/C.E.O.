import { useCallback, useEffect, useRef, useState } from "react";
import { claim, letGo, micBusy, micFree, released } from "./micGate.ts";

/**
 * Dictation with the browser's own speech recognition (Chrome, Edge and Safari have it; nothing leaves the Desk
 * through us). The hook gives back the words as they come, finished phrases first and the half-heard tail after,
 * so a text box can show them live. Where the browser can't listen, `supported` is false and the mic stays hidden.
 * One recognition holds the phone's mic at a time (#1094, micGate.ts): a page that goes lets its own go, and a start
 * waits for the last one's end, so the mic hears again after a page change.
 */

/** The slice of the Web Speech API we use; TypeScript's DOM types don't carry it everywhere. */
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

export const dictationSupported = (): boolean => recognitionClass() !== null;

export function useDictation(onWords: (finished: string, tail: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const words = useRef(onWords);
  words.current = onWords;

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    setListening(false);
    if (r) void letGo(r, "stop");
  }, []);

  const start = useCallback(() => {
    const Rec = recognitionClass();
    if (!Rec || rec.current) return;
    const r = new Rec();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    let finished = "";
    r.onresult = (e) => {
      let tail = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finished += `${text.trim()} `;
        else tail += text;
      }
      if (rec.current === r) words.current(finished.trim(), tail.trim());
    };
    r.onerror = (e) => {
      if (rec.current !== r) return;
      if (e.error === "aborted" || e.error === "no-speech") return;
      setError(e.error === "not-allowed" ? "The browser blocked the microphone." : "Couldn't hear that. Try again, or type it.");
      stop();
    };
    // Only this hook's current recognition clears the state: an old one ending late never stops the new one (#1094).
    r.onend = () => {
      released(r);
      if (rec.current !== r) return;
      rec.current = null;
      setListening(false);
    };
    claim(r);
    rec.current = r;
    setError(null);
    setListening(true);
    const go = () => {
      if (rec.current !== r) return;
      try {
        r.start();
      } catch {
        setError("Couldn't start listening.");
        stop();
      }
    };
    if (micBusy()) void micFree().then(go);
    else go();
  }, [stop]);

  useEffect(
    () => () => {
      const r = rec.current;
      rec.current = null;
      if (r) void letGo(r);
    },
    [],
  );

  return { supported: dictationSupported(), listening, error, start, stop };
}
