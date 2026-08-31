import { useEffect } from "react";
import { FrappeProvider, useFrappeAuth } from "frappe-react-sdk";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import AppNav, { isSupplierOnly } from "./components/AppNav";
import Dashboard from "./pages/Dashboard";
import DocFormPage from "./pages/DocFormPage";
import DocListPage from "./pages/DocListPage";
import CuttingWorklist from "./pages/CuttingWorklist";
import ProgramScreen from "./pages/ProgramScreen";
import FinishedPattyPage from "@/pages/FinishedPattyPage";
import ProductionScreen from "./pages/ProductionScreen";
import ProductionViewPage from "./pages/ProductionViewPage";
import CloseoutStackPage from "./pages/CloseoutStackPage";
import BobbinReportPage from "./pages/BobbinReportPage";
import JobChallanPage from "./pages/JobChallanPage";
import JobReportPage from "./pages/JobReportPage";
import JobHisabPage from "./pages/JobHisabPage";
import OrderReportPage from "./pages/OrderReportPage";
import InwardReportPage from "./pages/InwardReportPage";
import SalesChallanVoucher from "./pages/SalesChallanVoucher";
import ChallanReportPage from "./pages/ChallanReportPage";
import MasterWorkspace from "./pages/MasterWorkspace";
import OrderWorkspace from "./pages/OrderWorkspace";
import InwardWorkspace from "./pages/InwardWorkspace";
import InventoryScreen from "./pages/InventoryScreen";
import StockLedgerScreen from "./pages/StockLedgerScreen";
import TaskReminderChatPage from "./pages/TaskReminderChatPage";
import Login from "./pages/Login";
import Toaster from "./components/Toaster";
import { DOC_REGISTRY } from "@/config/registry";

function AuthedShell() {
  const { currentUser, isLoading } = useFrappeAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="mm-login-wrap">
        <div className="mm-card mm-card-pad">Loading…</div>
      </div>
    );
  }

  if (!currentUser || currentUser === "Guest") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Supplier logins only get their own purchase orders — keep them out of the ops home.
  if (isSupplierOnly() && location.pathname === "/") {
    return <Navigate to="/purchase-order" replace />;
  }

  // Every screen uses the full width now; forms self-center via their own .mm-page cap,
  // so the app fills the screen consistently instead of a narrow centered column.
  const wide = true;

  return (
    <div className="mm-app">
      <AppNav />
      <main className={`mm-app-content ${wide ? "mm-app-content-wide" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  // Faster number entry everywhere: focusing a number field selects its value (type to
  // overwrite) and asks phones/tablets for a numeric keypad. One listener covers all forms.
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLInputElement | null;
      if (t && t.tagName === "INPUT" && t.type === "number") {
        if (!t.getAttribute("inputmode")) t.setAttribute("inputmode", "decimal");
        setTimeout(() => { try { t.select(); } catch { /* ignore */ } }, 0);
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const url = import.meta.env.DEV ? "" : window.location.origin;
  return (
    <FrappeProvider
      url={url}
      siteName={
        typeof window !== "undefined"
          ? (window as unknown as { frappe?: { boot?: { sitename?: string } } }).frappe?.boot?.sitename
          : undefined
      }
    >
      <BrowserRouter basename="/mahaveermetalic">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AuthedShell />}>
            <Route path="/" element={<Dashboard />} />
            {/* Cutting + Orders use custom full-width screens instead of the generic list. */}
            <Route path="/cutting" element={<CuttingWorklist />} />
            <Route path="/program" element={<ProgramScreen />} />
            <Route path="/finished-patty" element={<FinishedPattyPage />} />
            <Route path="/production" element={<ProductionScreen />} />
            <Route path="/production-view" element={<ProductionViewPage />} />
            <Route path="/closeout" element={<CloseoutStackPage />} />
            <Route path="/bobbin-report" element={<BobbinReportPage />} />
            <Route path="/job-out" element={<JobChallanPage type="Job Out" />} />
            <Route path="/job-in" element={<JobChallanPage type="Job In" />} />
            <Route path="/job-report" element={<JobReportPage />} />
            <Route path="/job-hisab" element={<JobHisabPage />} />
            <Route path="/order-report" element={<OrderReportPage />} />
            <Route path="/inward-report" element={<InwardReportPage />} />
            <Route path="/sales-challan-voucher" element={<SalesChallanVoucher />} />
            <Route path="/challan-report" element={<ChallanReportPage />} />
            <Route path="/sales-order" element={<OrderWorkspace />} />
            <Route path="/inward" element={<InwardWorkspace />} />
            <Route path="/inventory" element={<InventoryScreen />} />
            <Route path="/stock-ledger" element={<StockLedgerScreen />} />
            {DOC_REGISTRY.filter((meta) => !["/cutting", "/sales-order", "/inward"].includes(meta.routeBase)).map((meta) => (
              <Route
                key={meta.slug}
                path={meta.routeBase}
                element={
                  meta.navGroup === "masters" ? (
                    <MasterWorkspace meta={meta} />
                  ) : (
                    <DocListPage meta={meta} />
                  )
                }
              />
            ))}
            {DOC_REGISTRY.map((meta) => (
              <Route key={`${meta.slug}-new`} path={`${meta.routeBase}/new`} element={<DocFormPage meta={meta} />} />
            ))}
            {DOC_REGISTRY.map((meta) => (
              <Route key={`${meta.slug}-edit`} path={`${meta.routeBase}/:name`} element={<DocFormPage meta={meta} />} />
            ))}
            <Route path="/tools/reminders-chat" element={<TaskReminderChatPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </FrappeProvider>
  );
}
