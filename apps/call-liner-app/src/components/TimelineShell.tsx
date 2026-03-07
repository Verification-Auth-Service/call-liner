import type { ScenarioTimelineViewModel } from "../domain-types";
import { appStyles } from "../react-styles";
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
    <section className="panel panel-timeline" style={{ ...appStyles.panel, ...appStyles.timelinePanelShell }}>
      <TimelinePanel vm={props.viewModel} />
    </section>
  );
}
