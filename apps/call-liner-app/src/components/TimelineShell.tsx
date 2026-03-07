import type { ScenarioTimelineViewModel } from "../domain-types";
import { TimelinePanel } from "./TimelinePanel";

type TimelineShellProps = {
  viewModel: ScenarioTimelineViewModel;
};

/**
 * App からタイムライン本体へ ViewModel を受け渡す薄いラッパー。
 * 入力例: `<TimelineShell viewModel={vm} />`
 * 出力例: 再設計済み座標系で描画されるタイムラインパネル。
 */
export function TimelineShell(props: TimelineShellProps) {
  return (
    <section className="panel panel-timeline">
      <TimelinePanel vm={props.viewModel} />
    </section>
  );
}
