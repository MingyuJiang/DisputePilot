import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, MinusCircle, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import type { PolicyCheck } from "../../api/types";
import { useI18n, type MessageKey } from "../../i18n";

export function PolicyChecks({
  checks,
  decision,
  summary,
  defaultOpen = false,
}: {
  checks: PolicyCheck[];
  decision: "PASS" | "BLOCKED" | "NEEDS_REVIEW";
  summary: string;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);

  const passed = checks.filter((item) => item.status === "PASS").length;
  const failed = checks.filter((item) => item.status === "FAIL").length;
  const na = checks.filter((item) => item.status === "NOT_APPLICABLE").length;

  const bases = new Set(checks.map((item) => item.basis).filter(Boolean));
  const basisKey: MessageKey | undefined =
    bases.size === 0
      ? undefined
      : bases.has("LIVE_HATEOAS") && bases.has("FIXTURE_SNAPSHOT")
        ? "policy.basis.mixed"
        : bases.has("LIVE_HATEOAS")
          ? "policy.basis.live"
          : "policy.basis.frozen";

  const tone =
    decision === "PASS"
      ? { wrap: "border-pass-line bg-pass-bg", text: "text-pass", icon: <ShieldCheck size={14} aria-hidden />, label: t("policy.passed") }
      : decision === "BLOCKED"
        ? { wrap: "border-stop-line bg-stop-bg", text: "text-stop", icon: <ShieldX size={14} aria-hidden />, label: t("policy.blocked") }
        : { wrap: "border-warn-line bg-warn-bg", text: "text-warn", icon: <ShieldX size={14} aria-hidden />, label: t("policy.review") };

  return (
    <div>
      <div className={["rounded-md border px-3 py-2.5", tone.wrap].join(" ")}>
        <div className="flex items-start gap-2">
          <span className={["mt-0.5", tone.text].join(" ")}>{tone.icon}</span>
          <div className="min-w-0">
            <div className={["text-xs font-semibold", tone.text].join(" ")}>{tone.label}</div>
            <p className="mt-0.5 text-[11px] leading-4 text-ink">{summary}</p>
          </div>
        </div>
      </div>

      {basisKey ? (
        <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">
          <span className="text-ink-faint">{t("policy.basis.label")}</span>
          {t(basisKey)}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-faint">
        <span className="num">{t("policy.counts", { passed, failed, na })}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 font-medium text-ink-muted transition-colors hover:text-ink"
        >
          {open ? t("policy.hide") : t("policy.show")}
          {open ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />}
        </button>
      </div>

      {open ? (
        <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2 px-2.5 py-1.5">
              <span className="mt-[1px] shrink-0">
                {check.status === "PASS" ? (
                  <CheckCircle2 size={12} className="text-pass" aria-label={t("badge.outcome.SUCCEEDED")} />
                ) : check.status === "FAIL" ? (
                  <XCircle size={12} className="text-stop" aria-label={t("badge.outcome.FAILED")} />
                ) : (
                  <MinusCircle size={12} className="text-ink-faint" aria-label={t("policy.notApplicable")} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="num font-mono text-[10px] font-medium text-ink-faint">{check.id}</span>
                  <span className="text-[11.5px] font-medium text-ink">{check.label}</span>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-4 text-ink-muted">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
