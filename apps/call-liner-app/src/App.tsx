import { useMemo, useState, type ChangeEvent } from "react";
import type {
  ActionSpaceReport,
  AttackDslFinding,
  AttackDslOperation,
  AttackDslReport,
  AttackDslScenario,
  TimelineFlow,
  TimelineBoard,
} from "./domain-types";
import {
  buildTimelineBoard,
  deriveTimelineFlows,
  parseActionSpaceReportText,
  parseAttackDslReportText,
} from "./report-integration";
import { sampleActionSpaceReport, sampleAttackDslReport } from "./sample-reports";
import "./styles.css";

const TICK_STEP_MS = 100;
const MAJOR_TICK_STEP_MS = 500;
const PIXELS_PER_MS = 1;

function toOperationDetail(operation: AttackDslOperation): string {
  // 種別ごとに有効なプロパティが異なるため表示文言を分ける。
  switch (operation.type) {
    case "request":
      return `${operation.request.method} ${operation.request.url}`;
    case "advance_time":
      return `Advance ${operation.ms}ms`;
    case "replay":
      return `Replay target: ${operation.target}`;
  }
}

async function readTextFile(file: File): Promise<string> {
  return file.text();
}

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
 * 実験機能の統合結果をタイムラインで検証する GUI を表示する。
 * 入力例: `<App />`
 * 出力例: シナリオ選択、フロー検出、時間軸クリップ表示を含む React 画面。
 */
export default function App() {
  const [attackDslReport, setAttackDslReport] =
    useState<AttackDslReport>(sampleAttackDslReport);
  const [actionSpaceReport, setActionSpaceReport] =
    useState<ActionSpaceReport>(sampleActionSpaceReport);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    sampleAttackDslReport.scenarios[0]?.id ?? "",
  );
  const [parseError, setParseError] = useState<string>("");

  const flows = useMemo(() => {
    return deriveTimelineFlows(actionSpaceReport);
  }, [actionSpaceReport]);

  const selectedScenario: AttackDslScenario = useMemo(() => {
    const fallback = attackDslReport.scenarios[0];

    // シナリオ自体が空なら画面継続できないため明示エラーにする。
    if (!fallback) {
      throw new Error("No scenarios found in attack-dsl report.");
    }

    // 選択IDが空のときは先頭シナリオを既定値として使う。
    if (!selectedScenarioId) {
      return fallback;
    }

    const found = attackDslReport.scenarios.find(
      (scenario) => scenario.id === selectedScenarioId,
    );

    // 以前の選択IDが現在レポートに存在しない場合は先頭へフォールバックする。
    if (!found) {
      return fallback;
    }

    return found;
  }, [attackDslReport, selectedScenarioId]);

  const selectedFlow: TimelineFlow | undefined = useMemo(() => {
    return flows.find(
      (flow) => flow.callbackEntrypointId === selectedScenario.entrypointId,
    );
  }, [flows, selectedScenario.entrypointId]);

  const board: TimelineBoard = useMemo(() => {
    return buildTimelineBoard(selectedScenario, selectedFlow);
  }, [selectedScenario, selectedFlow]);
  const selectedEntrypointInconclusive = useMemo(() => {
    return (attackDslReport.inconclusive ?? []).filter(
      (finding) => finding.entrypointId === selectedScenario.entrypointId,
    );
  }, [attackDslReport.inconclusive, selectedScenario.entrypointId]);
  const selectedEntrypointMissingOrSuspect = useMemo(() => {
    return (attackDslReport.missingOrSuspect ?? []).filter(
      (finding) => finding.entrypointId === selectedScenario.entrypointId,
    );
  }, [attackDslReport.missingOrSuspect, selectedScenario.entrypointId]);

  const ticks = useMemo(() => {
    const generated: Array<{ timeMs: number; major: boolean }> = [];

    for (let timeMs = TICK_STEP_MS; timeMs <= board.maxMs; timeMs += TICK_STEP_MS) {
      generated.push({
        timeMs,
        major: timeMs % MAJOR_TICK_STEP_MS === 0,
      });
    }

    return generated;
  }, [board.maxMs]);

  const onLoadAttackDsl = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];

    // ファイル未選択のときは入力確定していないため処理しない。
    if (!file) {
      return;
    }

    try {
      const parsed = parseAttackDslReportText(await readTextFile(file));
      setAttackDslReport(parsed);
      setSelectedScenarioId(parsed.scenarios[0]?.id ?? "");
      setParseError("");
    } catch (error) {
      setParseError((error as Error).message);
    }
  };

  const onLoadActionSpace = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];

    // ファイル未選択のときは入力確定していないため処理しない。
    if (!file) {
      return;
    }

    try {
      const parsed = parseActionSpaceReportText(await readTextFile(file));
      setActionSpaceReport(parsed);
      setParseError("");
    } catch (error) {
      setParseError((error as Error).message);
    }
  };

  return (
    <main className="app-root">
      <header className="app-header">
        <div>
          <h1>Call Liner Timeline Lab</h1>
          <p>
            実験機能を統合し、Operation を時間軸で検証する GUI
          </p>
        </div>
        <div className="file-controls">
          <label>
            attack-dsl.json
            <input type="file" accept="application/json" onChange={onLoadAttackDsl} />
          </label>
          <label>
            action-space.json
            <input type="file" accept="application/json" onChange={onLoadActionSpace} />
          </label>
        </div>
      </header>

      {parseError ? <p className="error-banner">{parseError}</p> : null}

      <section className="workspace-grid">
        <aside className="panel panel-scenarios" aria-label="scenario-list">
          <h2>Scenarios</h2>
          <ul>
            {attackDslReport.scenarios.map((scenario) => {
              const isActive = selectedScenarioId === scenario.id;

              return (
                <li key={scenario.id}>
                  <button
                    type="button"
                    className={isActive ? "active" : ""}
                    onClick={() => setSelectedScenarioId(scenario.id)}
                  >
                    <span>{scenario.title}</span>
                    <small>{scenario.routePath}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="panel panel-timeline" aria-label="timeline-board">
          <header className="timeline-ruler" style={{ width: board.maxMs * PIXELS_PER_MS }}>
            {ticks.map((tick) => {
              return (
                <span
                  key={tick.timeMs}
                  className={`tick-label ${tick.major ? "major" : "minor"}`}
                  style={{ left: tick.timeMs * PIXELS_PER_MS }}
                >
                  {tick.timeMs}
                </span>
              );
            })}
            <span
              className="cursor-badge"
              style={{ left: board.cursorMs * PIXELS_PER_MS }}
            >
              {board.cursorMs}
            </span>
          </header>

          <div className="timeline-canvas" style={{ width: board.maxMs * PIXELS_PER_MS }}>
            <span
              className="cursor-line"
              style={{ left: board.cursorMs * PIXELS_PER_MS }}
              aria-label="current-time"
            />

            {board.lanes.map((lane, laneIndex) => {
              return (
                <article key={lane.id} className="lane" aria-label={lane.label}>
                  <span className="lane-title">{lane.label}</span>

                  {board.clips
                    .filter((clip) => clip.laneId === lane.id)
                    .map((clip) => {
                      return (
                        <span
                          key={clip.id}
                          className={`clip tone-${clip.tone}`}
                          style={{
                            top: 42 + laneIndex * 0,
                            left: clip.startMs * PIXELS_PER_MS,
                            width: (clip.endMs - clip.startMs) * PIXELS_PER_MS,
                          }}
                          title={`${clip.category}: ${clip.label}`}
                        >
                          {clip.label}
                        </span>
                      );
                    })}

                </article>
              );
            })}
          </div>
        </section>

        <aside className="panel panel-inspector" aria-label="inspector">
          <h2>Inspector</h2>
          <div className="report-summary">
            <span>Generated: {attackDslReport.summary?.generated ?? attackDslReport.scenarios.length}</span>
            <span>Inconclusive: {attackDslReport.summary?.inconclusive ?? 0}</span>
            <span>Missing/Suspect: {attackDslReport.summary?.missingOrSuspect ?? 0}</span>
          </div>
          <p className="scenario-title">{selectedScenario.title}</p>
          <p>{selectedScenario.description}</p>
          <h3>Operations</h3>
          <ul className="operation-list">
            {selectedScenario.operations.map((operation, index) => {
              return (
                <li key={`${operation.type}-${index}`}>
                  <b>{operation.type}</b>
                  <span>{toOperationDetail(operation)}</span>
                  <small>{operation.note}</small>
                </li>
              );
            })}
          </ul>

          <h3>Expected Policies</h3>
          <div className="policy-tags">
            {selectedScenario.expectedPolicyIds.map((policyId) => (
              <span key={policyId}>{policyId}</span>
            ))}
          </div>

          <h3>Authorize + Callback Flow</h3>
          {selectedFlow ? (
            <p>
              {selectedFlow.authorizePath}
              {" -> "}
              {selectedFlow.callbackPath}
            </p>
          ) : (
            <p>対応する authorize + callback flow は未検出</p>
          )}

          <h3>Inconclusive</h3>
          <ul className="finding-list">
            {selectedEntrypointInconclusive.length > 0 ? (
              selectedEntrypointInconclusive.map((finding) => (
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

          <h3>Missing / Suspect</h3>
          <ul className="finding-list">
            {selectedEntrypointMissingOrSuspect.length > 0 ? (
              selectedEntrypointMissingOrSuspect.map((finding) => (
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
        </aside>
      </section>
    </main>
  );
}
