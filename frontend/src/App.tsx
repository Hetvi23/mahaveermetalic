import { FrappeProvider, useFrappeAuth } from "frappe-react-sdk";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import AppNav, { isSupplierOnly } from "./components/AppNav";
import Dashboard from "./pages/Dashboard";
import DocFormPage from "./pages/DocFormPage";
import DocListPage from "./pages/DocListPage";
import SalesOrderStock from "./pages/SalesOrderStock";
import SupplierPending from "./pages/SupplierPending";
import CuttingWorklist from "./pages/CuttingWorklist";
import ProgramScreen from "./pages/ProgramScreen";
import MasterWorkspace from "./pages/MasterWorkspace";
import OrderWorkspace from "./pages/OrderWorkspace";
import InwardWorkspace from "./pages/InwardWorkspace";
import TaskReminderChatPage from "./pages/TaskReminderChatPage";
import Login from "./pages/Login";
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

  // Supplier logins only get their pending view — keep them out of the ops home.
  if (isSupplierOnly() && location.pathname === "/") {
    return <Navigate to="/supplier-pending" replace />;
  }

  const isHome = location.pathname === "/";
  // Full-width screens (workspaces / multi-pane) break out of the centered column.
  const wide = isHome || WIDE_PATHS.includes(location.pathname);

  return (
    <div className="mm-app">
      <AppNav />
      <main className={`mm-app-content ${wide ? "mm-app-content-wide" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}

// Masters use the combined form+list workspace; cutting is a two-panel worklist.
const WIDE_PATHS = [
  ...DOC_REGISTRY.filter((m) => m.navGroup === "masters").map((m) => m.routeBase),
  "/cutting",
  "/program",
  "/sales-order",
  "/inward",
];

export default function App() {
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
            <Route path="/sales-order" element={<OrderWorkspace />} />
            <Route path="/inward" element={<InwardWorkspace />} />
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
            <Route path="/sales-order/stock" element={<SalesOrderStock />} />
            <Route path="/supplier-pending" element={<SupplierPending />} />
            <Route path="/tools/reminders-chat" element={<TaskReminderChatPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </FrappeProvider>
  );
}
