import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { MerchantProvider } from "./hooks/useMerchant";
import { LanguageProvider } from "./i18n";
import { ToastProvider } from "./components/ui/Toast";

/**
 * Route-level code splitting keeps the first paint light and gives each
 * workspace its own chunk. The offline prototype still ships as static assets.
 */
const OverviewPage = lazy(() =>
  import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })),
);
const CaseQueuePage = lazy(() =>
  import("./pages/CaseQueuePage").then((module) => ({ default: module.CaseQueuePage })),
);
const AssistantPage = lazy(() =>
  import("./pages/AssistantPage").then((module) => ({ default: module.AssistantPage })),
);
const CaseWorkspacePage = lazy(() =>
  import("./pages/CaseWorkspacePage").then((module) => ({ default: module.CaseWorkspacePage })),
);
const ApprovalQueuePage = lazy(() =>
  import("./pages/ApprovalQueuePage").then((module) => ({ default: module.ApprovalQueuePage })),
);
const ApprovalDetailPage = lazy(() =>
  import("./pages/ApprovalDetailPage").then((module) => ({ default: module.ApprovalDetailPage })),
);
const ExecutionAuditPage = lazy(() =>
  import("./pages/ExecutionAuditPage").then((module) => ({ default: module.ExecutionAuditPage })),
);
const DemoPage = lazy(() =>
  import("./pages/DemoPage").then((module) => ({ default: module.DemoPage })),
);

/** Keeps `?batch=…` when the old /autopilot path redirects to /assistant. */
function AutopilotRedirect() {
  const location = useLocation();
  return <Navigate to={`/assistant${location.search}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <MerchantProvider>
          <ToastProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<OverviewPage />} />
                <Route path="cases" element={<CaseQueuePage />} />
                <Route path="assistant" element={<AssistantPage />} />
                <Route path="autopilot" element={<AutopilotRedirect />} />
                <Route path="cases/:caseId" element={<CaseWorkspacePage />} />
                <Route path="approvals" element={<ApprovalQueuePage />} />
                <Route path="approvals/:proposalId" element={<ApprovalDetailPage />} />
                <Route path="audit" element={<ExecutionAuditPage />} />
                <Route path="demo" element={<DemoPage />} />
                <Route path="*" element={<Navigate to="/cases" replace />} />
              </Route>
            </Routes>
          </ToastProvider>
        </MerchantProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}
