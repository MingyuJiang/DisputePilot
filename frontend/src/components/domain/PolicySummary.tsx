/**
 * Validator summary (FRONTEND_REDESIGN_PLAN §3.4 step 4).
 *
 * The counts and every failed check stay on the surface — a manager must not
 * have to open a disclosure to learn that the action was blocked. Only the
 * per-check detail (V1–V18) is collapsed.
 */

import { CheckCircle2, MinusCircle, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import type { PolicyCheck } from "../../api/types";
import { validationState } from "../../lib/statusModel";
import { useI18n } from "../../i18n";
import { Disclosure } from "../ui/Disclosure";
import { StatusBadge } from "../ui/StatusBadge";

const iconFor = (status: PolicyCheck["status"]) => {
  if (status === "PASS") return <CheckCircle2 size={12} className="text-pass" aria-hidden />;
  if (status === "FAIL") return <XCircle size={12} className="text-stop" aria-hidden />;
  return <MinusCircle size={12} className="text-ink-faint" aria-hidden />;
};

const decisionIcon = (decision: "PASS" | "BLOCKED" | "NEEDS_REVIEW") =>
  decision === "PASS" ? (
    <ShieldCheck size={14} className="text-pass" aria-hidden />
  ) : (
    <ShieldX size={14} className={decision === "BLOCKED" ? "text-stop" : "text-warn"} aria-hidden />
  );

const decisionTone = (decision: "PASS" | "BLOCKED" | "NEEDS_REVIEW"): string =>
  decision === "PASS"
    ? "border-pass-line bg-pass-bg"
    : decision === "BLOCKED"
      ? "border-stop-line bg-stop-bg"
      : "border-warn-line bg-warn-bg";

export function PolicySummary({
  checks,
  decision,
  summary,
}: {
  checks: PolicyCheck[];
  decision: "PASS" | "BLOCKED" | "NEEDS_REVIEW";
  summary: string;
}) {
  const { t } = useI18n();
  const passed = checks.filter((check) => check.status === "PASS").length;
  const failed = checks.filter((check) => check.status === "FAIL");
  const state = validationState(decision);

  return (
    <div data-testid="policy-summary">
      <div className={["rounded-md border px-3 py-2.5", decisionTone(decision)].join(" ")}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">{decisionIcon(decision)}</span>
          <div className="min-w-0">
            <StatusBadge state={state} />
            <p className="num mt-1 text-base leading-4 text-ink">
              {t("approval.summary.counts", { passed, failed: failed.length })}
            </p>
            <p className="mt-0.5 text-base leading-4 text-ink-muted">{summary}</p>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <div className="eyebrow mb-1">{t("approval.policy.failed")}</div>
        {failed.length === 0 ? (
          <p className="text-base leading-4 text-ink-muted">{t("approval.policy.noFailed")}</p>
        ) : (
          <ul className="space-y-1" data-testid="policy-failures">
            {failed.map((check) => (
              <li
                key={check.id}
                className="flex items-start gap-2 rounded border border-stop-line bg-stop-bg/60 px-2.5 py-1.5"
              >
                <span className="mt-0.5 shrink-0">
                  <XCircle size={12} className="text-stop" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="num font-mono text-xs font-semibold text-stop">
                      {check.id}
                    </span>
                    <span className="text-base font-medium text-ink">{check.label}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-ink-muted">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2">
        <Disclosure summary={`${t("approval.policy.details")} · ${checks.length}`}>
          <ul className="divide-y divide-line">
            {checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2 py-1.5">
                <span className="mt-[2px] shrink-0">{iconFor(check.status)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="num font-mono text-xs font-medium text-ink-faint">
                      {check.id}
                    </span>
                    <span className="text-base font-medium text-ink">{check.label}</span>
                    <span className="num ml-auto text-xs text-ink-faint">{check.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-ink-muted">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Disclosure>
        <p className="mt-1 text-xs leading-4 text-ink-faint">
          {t("approval.policy.notHidden")}
        </p>
      </div>
    </div>
  );
}
