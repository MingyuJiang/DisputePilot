/**
 * Legacy guided-demo dialog (`/cases?guide=1`).
 *
 * The canonical entry point is now `/demo`; this dialog stays as a shortcut so
 * existing links keep working. It renders the same shared cards and reset
 * control, so both entry points stay identical.
 */

import { useNavigate } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useRuntime } from "../../hooks/useRuntime";
import { disputePilot, type ServiceMode } from "../../api";
import type { DemoResetOutcome } from "../../api/demoReset";
import { sandboxModeOf } from "./SandboxStatus";
import { DemoScenarioCards } from "./DemoScenarioCards";
import { DemoResetPanel } from "./DemoResetPanel";
import { useI18n } from "../../i18n";

export function DemoGuideDialog({
  open,
  onClose,
  mode = disputePilot.mode,
  offline,
  reset,
}: {
  open: boolean;
  onClose: () => void;
  /** Injected in tests; defaults to the active service mode. */
  mode?: ServiceMode;
  /** Whether the backend runs in offline replay mode (reset is only valid then). */
  offline?: boolean;
  reset?: () => Promise<DemoResetOutcome>;
}) {
  const navigate = useNavigate();
  
  const { t } = useI18n();
  const runtime = useRuntime();
  const offlineMode = offline ?? sandboxModeOf(runtime.health) === "offline";

  const openCase = (caseId: string) => {
    onClose();
    navigate(`/cases/${caseId}`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("guide.title")}
      description={t("guide.description")}
      width="max-w-[1120px]"
      footer={
        <>
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-ink-faint">
            <FlaskConical size={13} aria-hidden />
            {t("guide.demoData")}
          </span>
          <Button variant="secondary" onClick={() => navigate("/demo")}>
            {t("demo.title")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <DemoResetPanel
          mode={mode}
          offline={offlineMode}
          reset={reset}
          onResetSuccess={() => undefined}
        />
        <DemoScenarioCards mode={mode} onOpenCase={openCase} />
        <div className="rounded-md border border-line bg-subtle px-3.5 py-2.5 text-base leading-6 text-ink-muted">
          <span className="font-semibold text-ink">{t("guide.boundaryTitle")}</span>{" "}
          {t("guide.boundaryBody")}
        </div>
      </div>
    </Dialog>
  );
}
