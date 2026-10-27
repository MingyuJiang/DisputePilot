/**
 * One role-aware next step (FRONTEND_COMPONENT_ARCHITECTURE §2).
 *
 * The card receives the pure `NextStep` from `lib/nextStep` plus the reasons
 * the page derived; it never inspects role or proposal state itself. Exactly
 * one primary action is passed in by the page, so two competing CTAs cannot be
 * rendered side by side.
 */

import type { ReactNode } from "react";
import { ArrowRight, Info, ShieldAlert } from "lucide-react";
import type { NextStep, NextStepRole } from "../../lib/nextStep";
import { useI18n } from "../../i18n";
import { Badge } from "../ui/Badge";

export interface NextStepBlocker {
  label: string;
  detail?: string;
}

export function NextStepCard({
  step,
  role,
  why,
  blockers,
  action,
  note,
}: {
  step: NextStep;
  role: NextStepRole;
  why: string[];
  blockers: NextStepBlocker[];
  /** The single primary control; omitted when the step is "wait". */
  action?: ReactNode;
  note?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const label = lang === "zh-CN" ? step.labelZh : step.labelEn;

  return (
    <section
      className="overflow-hidden rounded-lg border border-line bg-card shadow-card"
      data-testid="next-step"
      data-next-step={step.key}
    >
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-strong">{t("case.next.title")}</h2>
          <Badge tone={step.tone} dot>
            {role === "MERCHANT" ? t("merchant.name") : role === "MANAGER" ? t("role.manager") : t("role.specialist")}
          </Badge>
        </div>
        <p className="mt-1.5 text-[14px] font-semibold leading-5 text-ink-strong">{label}</p>
      </header>

      <div className="px-4 py-3">
        <div className="eyebrow mb-1">{t("case.next.why")}</div>
        {why.length === 0 ? (
          <p className="text-base leading-4 text-ink-muted">{t("rd.notProvided")}</p>
        ) : (
          <ul className="space-y-1">
            {why.map((line) => (
              <li key={line} className="flex gap-1.5 text-base leading-4 text-ink">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2.5">
          <div className="eyebrow mb-1">{t("case.next.blockers")}</div>
          {blockers.length === 0 ? (
            <p className="text-base leading-4 text-ink-muted">{t("case.next.noBlockers")}</p>
          ) : (
            <ul className="space-y-1" data-testid="next-step-blockers">
              {blockers.map((blocker) => (
                <li
                  key={blocker.label}
                  className="flex items-start gap-1.5 rounded border border-warn-line bg-warn-bg/50 px-2 py-1.5"
                >
                  <ShieldAlert size={11} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-base font-medium leading-4 text-ink">{blocker.label}</p>
                    {blocker.detail ? (
                      <p className="mt-0.5 text-xs leading-4 text-ink-muted">{blocker.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {action ? (
        <div className="border-t border-line px-4 py-3">
          {action}
          <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-xs leading-4 text-ink-faint">
            <ArrowRight size={9} aria-hidden />
            {t("case.next.single")}
          </p>
        </div>
      ) : null}

      {note ? (
        <div className="flex items-start gap-2 border-t border-line bg-subtle px-4 py-2">
          <Info size={11} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
          <div className="text-xs leading-4 text-ink-muted">{note}</div>
        </div>
      ) : null}
    </section>
  );
}
