import { Store } from "lucide-react";
import { useMerchant } from "../../hooks/useMerchant";
import { useI18n } from "../../i18n";

/**
 * v2.1: the identity shown in the topbar.
 *
 * There is no role switch any more: the product has one user (the merchant).
 * The backend still applies its own per-operation role checks, which the UI
 * neither exposes nor bypasses.
 */
export function RoleSwitcher() {
  const { merchant } = useMerchant();
  const { t } = useI18n();

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-sunken px-2 py-[5px] text-xs font-medium text-ink"
      title={t("merchant.identityHint")}
    >
      <Store size={12} aria-hidden />
      {t(merchant.nameKey)}
    </span>
  );
}
