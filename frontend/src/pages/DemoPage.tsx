/**
 * Guided demo route (FRONTEND_REDESIGN_PLAN §3.7).
 *
 * The five cards are static demo descriptions (they are not derived from the
 * loaded workspace), while the case links and reset operate on real data:
 * http mode opens the backend demo ids, mock mode opens the paired fixtures.
 */

import { Link } from "react-router-dom";
import { ArrowLeft, FlaskConical, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/domain/PageHeader";
import { ModeStrip } from "../components/ui/ModeStrip";
import { Card } from "../components/ui/Card";
import { DemoScenarioCards } from "../components/domain/DemoScenarioCards";
import { DemoResetPanel } from "../components/domain/DemoResetPanel";
import { useRuntime } from "../hooks/useRuntime";
import { useWorkspace } from "../hooks/useWorkspace";
import { disputePilot, serviceHandle } from "../api";
import { useNavigate } from "react-router-dom";
import { sandboxModeOf } from "../components/domain/SandboxStatus";
import { useI18n } from "../i18n";

export function DemoPage() {
  const runtime = useRuntime();
  const workspace = useWorkspace();
  const { t } = useI18n();
  const navigate = useNavigate();
  const offline = sandboxModeOf(runtime.health) === "offline";

  const openCase = (caseId: string) => {
    navigate(`/cases/${caseId}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6 lg:py-6">
      <div className="mb-3">
        <Link
          to="/cases"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} aria-hidden />
          {t("demo.backToCases")}
        </Link>
      </div>

      <PageHeader
        eyebrow={t("demo.eyebrow")}
        title={t("demo.title")}
        description={t("demo.description")}
      />

      <ModeStrip
        health={runtime.health}
        lastReadAt={runtime.lastSuccessReadAt}
        lastReadKind={runtime.lastReadKind}
      />

      <Card className="mt-3 flex flex-wrap items-start gap-2.5 border-warn-line bg-warn-bg/50 px-4 py-3">
        <FlaskConical size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink">{t("demo.boundaryTitle")}</div>
          <p className="mt-0.5 text-base leading-6 text-ink">{t("demo.boundaryBody")}</p>
          <p className="mt-0.5 text-sm font-semibold text-warn">{t("demo.noRealFunds")}</p>
        </div>
        <div className="ml-auto text-right text-xs leading-5 text-ink-muted">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck size={13} aria-hidden />
            {t("overview.derived", { count: workspace.cases.length })}
          </div>
          <div className="num">{disputePilot.mode === "http" ? "HTTP" : "MOCK"}</div>
        </div>
      </Card>

      <div className="mt-3">
        <DemoScenarioCards mode={disputePilot.mode} onOpenCase={openCase} />
      </div>

      <div className="mt-3">
        <DemoResetPanel
          mode={disputePilot.mode}
          offline={offline}
          onResetSuccess={async () => {
            await serviceHandle.refresh().catch(() => undefined);
          }}
        />
      </div>

      <p className="mt-3 text-sm leading-6 text-ink-muted">{t("demo.boundaryFootnote")}</p>
    </div>
  );
}
