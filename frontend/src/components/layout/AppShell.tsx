import { Suspense, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { serviceHandle } from "../../api";
import { useI18n } from "../../i18n";

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 lg:px-6" aria-busy="true" aria-live="polite">
      <div className="h-3 w-24 rounded bg-sunken" />
      <div className="mt-3 h-7 w-64 rounded bg-sunken" />
      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-[92px] rounded-lg border border-line bg-card" />
        ))}
      </div>
      <div className="mt-3 h-[420px] rounded-lg border border-line bg-card" />
      <span className="sr-only">{t("common.loadingWorkspace")}</span>
    </div>
  );
}

export function AppShell() {
  // http mode has no push channel (no WebSocket): load the workspace cache on
  // mount and poll it. Mock mode (default) keeps its synchronous store and skips this.
  useEffect(() => {
    if (serviceHandle.mode !== "http") return;
    // The adapter records the failure in the runtime store; an unhandled
    // rejection here would only spam the console.
    const load = (): void => {
      void serviceHandle.refresh().catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
