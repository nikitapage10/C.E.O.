import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation with the browser's own speech recognition (Chrome, Edge and Safari have it; nothing leaves the Desk
 * through us). The hook gives back the words as they come, finished phrases first and the half-heard tail after,
 * so a text box can show them live. Where the browser can't listen, `supported` is false and the mic stays hidden.
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
    rec.current?.stop();
    rec.current = null;
    setListening(false);
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
      words.current(finished.trim(), tail.trim());
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" ? "The browser blocked the microphone." : "Couldn't hear that. Try again, or type it.");
      stop();
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch {
      setError("Couldn't start listening.");
      stop();
    }
  }, [stop]);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported: dictationSupported(), listening, error, start, stop };
}
