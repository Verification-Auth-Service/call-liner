import { buildTickMarks, sampleTimelineData } from "./timeline-model";
import "./styles.css";

const PIXELS_PER_UNIT = 1;

/**
 * タイムライン画面を描画する。
 * 入力例: `<App />`
 * 出力例: 画像テイストに寄せたダーク系のタイムライン DOM を返す。
 */
export default function App() {
  const data = sampleTimelineData;
  const timelineWidth = data.maxTime * PIXELS_PER_UNIT;
  const ticks = buildTickMarks(data.maxTime, data.tickStep, data.majorStep);

  return (
    <main className="timeline-root">
      <section className="timeline-frame" aria-label="timeline-board">
        <header className="timeline-ruler" style={{ width: timelineWidth }}>
          {ticks.map((tick) => {
            return (
              <span
                key={tick.time}
                className={`tick-label ${tick.isMajor ? "major" : "minor"}`}
                style={{ left: tick.time * PIXELS_PER_UNIT }}
              >
                {tick.time}
              </span>
            );
          })}
          <span
            className="cursor-badge"
            style={{ left: data.cursorTime * PIXELS_PER_UNIT }}
          >
            {data.cursorTime}
          </span>
        </header>

        <div className="timeline-canvas" style={{ width: timelineWidth }}>
          <span
            className="cursor-line"
            style={{ left: data.cursorTime * PIXELS_PER_UNIT }}
            aria-label="current-time"
          />

          {data.lanes.map((lane) => {
            return (
              <article key={lane.id} className="lane" aria-label={lane.name}>
                <span className="lane-title">{lane.name}</span>

                {lane.segments.map((segment) => {
                  return (
                    <span
                      key={segment.id}
                      className={`segment ${segment.tone}`}
                      style={{
                        left: segment.start * PIXELS_PER_UNIT,
                        width: (segment.end - segment.start) * PIXELS_PER_UNIT,
                      }}
                    />
                  );
                })}

                {lane.markers.map((marker) => {
                  return (
                    <span
                      key={marker.id}
                      className="marker"
                      style={{ left: marker.time * PIXELS_PER_UNIT }}
                    />
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
