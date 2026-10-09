import type { AnalysisReport } from '../../types/nexora';
import { IndicatorGrid } from './IndicatorGrid';
import { InterpretationPanel } from './InterpretationPanel';
import { LevelsPanel } from './LevelsPanel';
import { NoticePanel } from './NoticePanel';
import { ReportMeta } from './ReportMeta';
import { ScenariosPanel } from './ScenariosPanel';
import { StatusNotice } from './StatusNotice';
import { TrendPanel } from './TrendPanel';

/**
 * Full report renderer.
 *
 * Shared by the AI Analysis page and the History detail view so a saved report
 * looks identical to a fresh one — there is exactly one place where the report
 * contract is turned into UI.
 */
export function ReportView({ report }: { report: AnalysisReport }): JSX.Element {
  const facts = report.facts;

  return (
    <div className="space-y-4 sm:space-y-5">
      <ReportMeta report={report} />
      <StatusNotice report={report} />

      {facts ? (
        <>
          {/* Facts first, interpretation second: the order is part of the message. */}
          <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
            <IndicatorGrid facts={facts} />
            {facts.trend ? <TrendPanel trend={facts.trend} /> : null}
          </div>

          {facts.levels ? <LevelsPanel levels={facts.levels} /> : null}

          {report.interpretation ? (
            <InterpretationPanel interpretation={report.interpretation} />
          ) : null}

          <ScenariosPanel scenarios={report.scenarios} />
        </>
      ) : null}

      <NoticePanel report={report} />
    </div>
  );
}
