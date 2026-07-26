import { useRef, useState } from "react";
import { Play } from "lucide-react";

const chapters = [
  { at: 0, time: "0:00", label: "What it is" },
  { at: 9, time: "0:09", label: "Locations and attendance" },
  { at: 21, time: "0:21", label: "Schedules that repeat" },
  { at: 42, time: "0:42", label: "Staff on their phones" },
  { at: 59, time: "0:59", label: "Progress and exceptions" },
  { at: 68, time: "1:08", label: "AI review", planned: true },
];

export function ProductVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(0);

  const play = (at?: number) => {
    const element = video.current;
    if (!element) return;
    if (at !== undefined) element.currentTime = at;
    setStarted(true);
    void element.play();
  };

  const onTimeUpdate = () => {
    const time = video.current?.currentTime ?? 0;
    setCurrent(
      chapters.reduce((found, chapter, index) => (time >= chapter.at ? index : found), 0),
    );
  };

  return (
    <section className="hx-watch" id="watch" aria-labelledby="watch-title">
      <div className="marketing-container">
        <h2 id="watch-title">Watch a working day run through Hygene Ops.</h2>
        <p className="hx-watch-meta">1 minute 30 seconds, with sound.</p>
        <div className="hx-watch-grid">
          <div className="hx-player">
            <video
              ref={video}
              preload="metadata"
              playsInline
              controls={started}
              poster="/media/explainer-poster.jpg"
              onTimeUpdate={onTimeUpdate}
            >
              <source src="/media/hygene-ops-explainer.mp4" type="video/mp4" />
            </video>
            {!started && (
              <button
                className="hx-play"
                type="button"
                aria-label="Play the product video"
                onClick={() => play()}
              >
                <Play aria-hidden="true" fill="currentColor" />
                <span>Play video</span>
              </button>
            )}
          </div>
          <ol className="hx-chapters" aria-label="Jump to a part of the video">
            {chapters.map((chapter, index) => (
              <li key={chapter.at}>
                <button
                  type="button"
                  aria-current={index === current ? "true" : undefined}
                  onClick={() => play(chapter.at)}
                >
                  <time>{chapter.time}</time>
                  <span>
                    {chapter.label}
                    {chapter.planned && <em>Planned</em>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
