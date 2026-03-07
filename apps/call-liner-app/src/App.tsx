import { useMemo, useState, type ChangeEvent } from "react";
import type {
  ActionSpaceReport,
  AttackDslReport,
  AttackDslScenario,
  ScenarioTimelineViewModel,
  TimelineFlow,
} from "./domain-types";
import {
  buildScenarioTimelineViewModel,
  deriveTimelineFlows,
  parseActionSpaceReportText,
  parseAttackDslReportText,
} from "./report-integration";
import { sampleActionSpaceReport, sampleAttackDslReport } from "./sample-reports";
import { ScenarioInspector } from "./components/ScenarioInspector";
import { TimelineShell } from "./components/TimelineShell";
import "./styles.css";

async function readTextFile(file: File): Promise<string> {
  return file.text();
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

  const timelineViewModel: ScenarioTimelineViewModel = useMemo(() => {
    return buildScenarioTimelineViewModel({
      scenario: selectedScenario,
      flow: selectedFlow,
      inconclusive: selectedEntrypointInconclusive,
      missingOrSuspect: selectedEntrypointMissingOrSuspect,
    });
  }, [
    selectedScenario,
    selectedFlow,
    selectedEntrypointInconclusive,
    selectedEntrypointMissingOrSuspect,
  ]);

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
          <p>実験機能を統合し、Operation を時間軸で検証する GUI</p>
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

        <TimelineShell viewModel={timelineViewModel} />

        <ScenarioInspector
          reportSummary={{
            generated:
              attackDslReport.summary?.generated ?? attackDslReport.scenarios.length,
            inconclusive: attackDslReport.summary?.inconclusive ?? 0,
            missingOrSuspect: attackDslReport.summary?.missingOrSuspect ?? 0,
          }}
          viewModel={timelineViewModel}
        />
      </section>
    </main>
  );
}
