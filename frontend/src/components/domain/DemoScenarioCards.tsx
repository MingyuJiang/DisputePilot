/**
 * The five guided-demo cards (FRONTEND_REDESIGN_PLAN §3.7).
 *
 * One component feeds both the `/demo` page and the legacy `/cases?guide=1`
 * dialog so the seven fields, source labels and "no real funds" warning cannot
 * drift between the two entry points. All content comes from
 * `lib/demoScenarios.ts`; nothing is invented here.
 */

import {
  CheckCircle2,
  FileUp,
  FlaskConical,
  Receipt,
  Send,
  ShieldX,
  Wallet,
  ArrowRight,
} from "lucide-react";
import type { ServiceMode } from "../../api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DEMO_SCENARIOS, demoCaseIdFor, isSyntheticScenario } from "../../lib/demoScenarios";
import { useI18n } from "../../i18n";

const ICONS = {
  "DEMO-INR-O7": Send,
  "DEMO-SNAD-O13": FileUp,
  "DEMO-BLOCK-O9": ShieldX,
  "CAP-DEMO-9001": Wallet,
  "DEMO-BILL-O16": Receipt,
} as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
        {label}
      </dt>
      <dd className="min-w-0 text-base leading-6 text-ink">{value}</dd>
    </div>
  );
}

export function DemoScenarioCards({
  mode,
  onOpenCase,
}: {
  mode: ServiceMode;
  onOpenCase: (caseId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="demo-scenario-cards">
      {DEMO_SCENARIOS.map((scenario) => {
        const Icon = ICONS[scenario.id as keyof typeof ICONS] ?? FlaskConical;
        const synthetic = isSyntheticScenario(scenario);
        const target = demoCaseIdFor(scenario, mode);

        return (
          <article
            key={scenario.id}
            data-testid={`demo-card-${scenario.id}`}
            className="flex min-w-0 flex-col rounded-lg border border-line bg-card"
          >
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-subtle px-4 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-card">
                  <Icon size={15} className="text-ink-muted" aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="num text-xs font-semibold text-ink-faint">{scenario.number}</div>
                  <h3 className="text-base font-semibold leading-6 text-ink-strong">
                    {t(scenario.titleKey)}
                  </h3>
                </div>
              </div>
              <Badge tone={scenario.tone}>{scenario.id}</Badge>
            </header>

            <dl className="flex-1 px-4 py-3">
              <Field label={t("guide.card.caseType")} value={t(scenario.caseTypeKey)} />
              <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-2 py-1">
                <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">
                  {t("guide.card.dataSource")}
                </dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span
                    data-testid={`demo-source-${scenario.id}`}
                    className="num rounded border border-line bg-subtle px-1.5 py-0.5 text-xs font-medium text-ink-muted"
                  >
                    {scenario.dataSource}
                  </span>
                  {synthetic ? (
                    <span className="text-xs font-semibold text-warn">{t("guide.noRealFunds")}</span>
                  ) : null}
                </dd>
              </div>
              <Field label={t("guide.card.mainProblem")} value={t(scenario.mainProblemKey)} />
              <Field label={t("guide.card.aiRecommendation")} value={t(scenario.aiRecommendationKey)} />
              <Field label={t("guide.card.expectedAction")} value={t(scenario.expectedActionKey)} />
              <Field label={t("guide.card.demonstrates")} value={t(scenario.demonstratesKey)} />
              <div className="mt-1.5 rounded-md border border-pass-line bg-pass-bg/50 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-pass">
                  <CheckCircle2 size={12} aria-hidden />
                  {t("guide.card.proof")}
                </div>
                <p className="mt-0.5 text-base leading-6 text-ink">{t(scenario.proofKey)}</p>
              </div>
            </dl>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-subtle px-4 py-2.5">
              <span className="text-xs text-ink-faint">
                {mode === "mock"
                  ? t("guide.mockFixture", { id: target })
                  : t("guide.case", { id: scenario.id })}
              </span>
              <Button size="sm" variant="secondary" onClick={() => onOpenCase(target)}>
                {t("guide.openCase")}
                <ArrowRight size={12} aria-hidden />
              </Button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
