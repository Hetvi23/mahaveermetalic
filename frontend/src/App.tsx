import { FrappeProvider, useFrappeAuth } from "frappe-react-sdk";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import DocFormPage from "./pages/DocFormPage";
import DocListPage from "./pages/DocListPage";
import SalesOrderStock from "./pages/SalesOrderStock";
import CuttingWorklist from "./pages/CuttingWorklist";
import TaskReminderChatPage from "./pages/TaskReminderChatPage";
import Login from "./pages/Login";
import { DOC_REGISTRY } from "@/config/registry";

function TopBar() {
  const navigate = useNavigate();
  const { currentUser, logout } = useFrappeAuth();

  return (
    <div className="mm-topbar">
      <button type="button" className="mm-btn-back" onClick={() => navigate("/")}>
        ← Home
      </button>
      <span className="mm-topbar-brand">Mahavir Metalic</span>
      <span className="mm-topbar-user">{currentUser}</span>
      <button
        type="button"
        className="mm-btn-close"
        title="Log out"
        onClick={async () => {
          await logout();
          navigate("/login", { replace: true });
        }}
      >
        ✕
      </button>
    </div>
  );
}

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

  const isHome = location.pathname === "/";

  return (
    <div className="mm-shell">
      {!isHome && <TopBar />}
      <div className={isHome ? undefined : "mm-main"}>
        <Outlet />
      </div>
    </div>
  );
}

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
            {/* Cutting uses a custom two-panel worklist instead of the generic list. */}
            <Route path="/cutting" element={<CuttingWorklist />} />
            {DOC_REGISTRY.filter((meta) => meta.routeBase !== "/cutting").map((meta) => (
              <Route key={meta.slug} path={meta.routeBase} element={<DocListPage meta={meta} />} />
            ))}
            {DOC_REGISTRY.map((meta) => (
              <Route key={`${meta.slug}-new`} path={`${meta.routeBase}/new`} element={<DocFormPage meta={meta} />} />
            ))}
            {DOC_REGISTRY.map((meta) => (
              <Route key={`${meta.slug}-edit`} path={`${meta.routeBase}/:name`} element={<DocFormPage meta={meta} />} />
            ))}
            <Route path="/sales-order/stock" element={<SalesOrderStock />} />
            <Route path="/tools/reminders-chat" element={<TaskReminderChatPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </FrappeProvider>
  );
}
