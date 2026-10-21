import { useEffect } from "react";
import { formatDuration, useWeekStory } from "../chronicle.ts";
import { paragraphs } from "./DayStory.tsx";
import { Avatar } from "./ui.tsx";

/**
 * A week in Ilyr (#211; docs/WORLD.md): the Historian's Sunday evening story of the week, under the daily one. Shown
 * only when one exists (the first of `weeks` that has one, newest first): a plain <audio controls> from our own origin
 * (api/day-story.ts?week=…) and the script as a transcript. A week that couldn't be read aloud still shows its
 * transcript. Nothing to make by hand: the world step tells it by itself.
 */
export function WeekStory({ weeks }: { weeks: string[] }) {
  const all = useWeekStory((s) => s.weeks);
  const key = weeks.join(",");

  useEffect(() => {
    for (const w of key.split(",")) void useWeekStory.getState().loadWeek(w);
  }, [key]);

  const story = weeks.map((w) => all[w]).find((s) => s && s !== "loading" && s !== "failed" && s.ready);
  if (!story || story === "loading" || story === "failed" || !story.ready) return null;

  const title = `A week in Ilyr · ${formatDuration(story.durationSec)}`;
  return (
    <div className="story story--week">
      <div className="story__head">
        <Avatar agent="The Historian" size="sm" room="archive" />
        <span className="story__title">
          <b>A week in Ilyr</b>
          <small>{story.audio ? `${formatDuration(story.durationSec)} · ` : ""}told on Sunday evening by the Historian</small>
        </span>
      </div>
      {story.audio ? <audio className="story__audio" controls preload="none" src={story.audio} aria-label={title} /> : <p className="quiet story__note">Not read aloud this week: the transcript is below.</p>}
      <details className="story__script" open={!story.audio}>
        <summary>Transcript</summary>
        {paragraphs(story.script).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </details>
    </div>
  );
}
