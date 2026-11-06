import { useEffect, useRef, useState } from "react";
import { PRIORITY, registerHoldToTalk } from "@ceo/desk/holdToTalk.ts";
import { listen, setOwnVoice, type Listener } from "@ceo/desk/roomvoice/roomVoice.ts";
import { useRoomShown } from "@ceo/engine/web/roomReady.ts";

/**
 * Hold Space to talk into the reply box (#904, Nikita: "no mic button"). The Desk's one hold-to-talk listener
 * (apps/desk/src/holdToTalk.ts, #905) owns the key: it never scrolls the page, leaves Space to fields and buttons, and
 * hands a hold to the highest handler. While the reply box is on screen Relay registers at room priority, above the
 * page's Messenger mic, and a hold dictates into the box with the browser's own speech recognition (the path the old
 * mic button took); letting go ends it. Nothing is sent: the words wait in the box for Send. While it listens,
 * hands-free waits (`setOwnVoice`). Kept mounted out of sight (#934, apps/desk/src/keptRooms.ts), Relay leaves Space
 * to the page on screen (`when`).
 */
export function useHoldSpace(on: boolean, write: (words: string) => void, base: () => string): { hearing: boolean; note: string } {
  const [hearing, setHearing] = useState(false);
  const [note, setNote] = useState("");
  const ear = useRef<Listener | null>(null);
  const cb = useRef({ write, base });
  cb.current = { write, base };
  const shown = useRoomShown();
  const onScreen = useRef(shown);
  onScreen.current = shown;

  useEffect(() => {
    if (!on) return;
    const stop = async (keep: boolean) => {
      const l = ear.current;
      if (!l) return;
      ear.current = null;
      setHearing(false);
      setOwnVoice(null);
      if (!keep) return l.cancel();
      const got = await l.finish();
      if ("error" in got) setNote(got.error);
      else if ("clip" in got) setNote("Talking into the box needs a browser with speech recognition (Chrome, Edge or Safari).");
    };
    const off = registerHoldToTalk(
      {
        ownIndicator: true,
        when: () => onScreen.current,
        start: () => {
          if (ear.current) return;
          const start = cb.current.base().trimEnd();
          const lead = start ? `${start} ` : "";
          setNote("");
          ear.current = listen((w) => cb.current.write(`${lead}${w}`));
          setHearing(true);
          setOwnVoice({ space: true, listening: true });
        },
        end: () => void stop(true),
        // Abandoned (Escape, the window lost focus): stop listening; what was heard stays in the box, unsent.
        cancel: () => void stop(true),
      },
      PRIORITY.room,
    );
    return () => {
      off();
      void stop(false);
    };
  }, [on]);

  return { hearing, note };
}
