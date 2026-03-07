import type { AttackDslFinding, ScenarioTimelineViewModel } from "../domain-types";

type ScenarioInspectorProps = {
  reportSummary: {
    generated: number;
    inconclusive: number;
    missingOrSuspect: number;
  };
  viewModel: ScenarioTimelineViewModel;
};

function toRecommendedActionLabel(finding: AttackDslFinding): string {
  // 推奨アクションコードを UI で読める日本語ラベルへ変換する。
  switch (finding.recommendedAction) {
    case "add_annotations":
      return "追加の注釈を書くべき";
    case "rewrite_to_framework_convention":
      return "フレームワーク規約に沿って書き直すべき";
    case "manual_minimum_dsl_completion":
      return "最低要件DSLを手動で補完すべき";
    case "fix_implementation_gap":
      return "実装不備として修正すべき";
  }
}

/**
 * シナリオ詳細インスペクタを描画する。
 * 入力例: `<ScenarioInspector reportSummary={{ generated: 2, ... }} viewModel={vm} />`
 * 出力例: Operations / Expected Policies / Findings を区切って表示する UI。
 */
export function ScenarioInspector(props: ScenarioInspectorProps) {
  const { reportSummary, viewModel } = props;

  return (
    <aside className="panel panel-inspector" aria-label="inspector">
      <h2>Inspector</h2>
      <div className="report-summary">
        <span>Generated: {reportSummary.generated}</span>
        <span>Inconclusive: {reportSummary.inconclusive}</span>
        <span>Missing/Suspect: {reportSummary.missingOrSuspect}</span>
      </div>

      <section className="inspector-section">
        <h3>Scenario</h3>
        <p className="scenario-title">{viewModel.inspector.title}</p>
        <p>{viewModel.inspector.description}</p>
      </section>

      <section className="inspector-section">
        <h3>Operations</h3>
        <ul className="operation-list">
          {viewModel.inspector.operations.map((operation, index) => {
            return (
              <li key={`${operation.type}-${index}`}>
                <b className={`operation-badge badge-${operation.type}`}>{operation.type}</b>
                <span>{operation.detail}</span>
                <small>{operation.note}</small>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="inspector-section">
        <h3>Expected Policies</h3>
        <div className="policy-tags">
          {viewModel.inspector.expectedPolicies.map((policyId) => (
            <span key={policyId}>{policyId}</span>
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <h3>Authorize + Callback Flow</h3>
        {viewModel.inspector.flowSummary ? (
          <p>{viewModel.inspector.flowSummary}</p>
        ) : (
          <p>対応する authorize + callback flow は未検出</p>
        )}
      </section>

      <section className="inspector-section">
        <h3>Inconclusive</h3>
        <ul className="finding-list">
          {viewModel.inspector.inconclusive.length > 0 ? (
            viewModel.inspector.inconclusive.map((finding) => (
              <li key={finding.id}>
                <b>{finding.title}</b>
                <span>{finding.detail}</span>
                <small>Next: {toRecommendedActionLabel(finding)}</small>
              </li>
            ))
          ) : (
            <li>該当なし</li>
          )}
        </ul>
      </section>

      <section className="inspector-section">
        <h3>Missing / Suspect</h3>
        <ul className="finding-list">
          {viewModel.inspector.missingOrSuspect.length > 0 ? (
            viewModel.inspector.missingOrSuspect.map((finding) => (
              <li key={finding.id}>
                <b>{finding.title}</b>
                <span>{finding.detail}</span>
                <small>Next: {toRecommendedActionLabel(finding)}</small>
              </li>
            ))
          ) : (
            <li>該当なし</li>
          )}
        </ul>
      </section>
    </aside>
  );
}
