
import type { AnalysisScenario } from '../../types/nexora';

export function ScenariosPanel({
  scenarios,
}: {
  scenarios: AnalysisScenario[];
}): JSX.Element {
  if (scenarios.length === 0) return <></>;

  const biasLabels = {
    bullish: 'صعودی',
    bearish: 'نزولی',
    neutral: 'خنثی',
  };

  const confidenceLabels = {
    low: 'کم',
    medium: 'متوسط',
    high: 'زیاد',
  };

  return (
    <section
      dir="rtl"
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <h2 className="font-semibold">سناریوهای احتمالی بازار</h2>
        <p className="text-xs text-slate-500">
          سناریوها مشروط به تحقق شرایط ذکرشده هستند و پیش‌بینی قطعی قیمت نیستند.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {scenarios.map((scenario) => (
          <article
            key={scenario.id}
            className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
          >
            <h3 className="font-medium">{scenario.title}</h3>

            <p className="mt-2 text-sm">
              جهت: {biasLabels[scenario.bias]}
            </p>

            <p className="mt-2 text-sm">
              <span className="font-medium">شرط تحقق:</span>{' '}
              {scenario.condition}
            </p>

            <p className="mt-2 text-sm">
              <span className="font-medium">شرط ابطال:</span>{' '}
              {scenario.invalidation}
            </p>

            <p className="mt-2 text-xs text-slate-500">
              سطح اطمینان: {confidenceLabels[scenario.confidence]}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
