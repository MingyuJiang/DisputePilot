import { Check, FlaskConical, X } from "lucide-react";
import type { HateoasSnapshot } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { useI18n } from "../../i18n";

export function HateoasTable({ snapshot }: { snapshot: HateoasSnapshot }) {
  const { t } = useI18n();
  const live = snapshot.links.some((link) => link.basis === "LIVE_HATEOAS");
  return (
    <div>
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line bg-subtle text-[10px] uppercase tracking-[0.06em] text-ink-faint">
              <th scope="col" className="px-2.5 py-1.5 font-medium">{t("hateoas.link")}</th>
              <th scope="col" className="w-12 px-1 py-1.5 font-medium">{t("hateoas.method")}</th>
              <th scope="col" className="w-[76px] px-2.5 py-1.5 text-right font-medium">
                {t("hateoas.present")}
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshot.links.map((link) => (
              <tr key={link.rel} className="border-b border-line last:border-b-0">
                <td className="px-2.5 py-[5px] font-mono text-[10.5px] text-ink">{link.rel}</td>
                <td className="px-1 py-[5px] font-mono text-[10px] text-ink-muted">{link.method}</td>
                <td className="px-2.5 py-[5px] text-right">
                  {link.available ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-pass">
                      <Check size={11} aria-hidden /> {t("common.yes")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-stop">
                      <X size={11} aria-hidden /> {t("common.no")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
        <Badge tone={live ? "info" : "scenario"}>
          <FlaskConical size={9} aria-hidden />
          {t(live ? "hateoas.live" : "hateoas.frozen")}
        </Badge>
        <span>{snapshot.source}</span>
        <span aria-hidden>·</span>
        <span className="num">{t("hateoas.readAt", { at: formatDateTime(snapshot.observedAt) })}</span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-4 text-ink-muted">
        {t(live ? "hateoas.liveNote" : "hateoas.note")}
      </p>
    </div>
  );
}
