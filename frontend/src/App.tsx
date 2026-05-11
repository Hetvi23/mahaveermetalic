import { DOC_REGISTRY, type NavGroup } from "@/config/registry";
import { FrappeProvider, useFrappeAuth } from "frappe-react-sdk";
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import DocFormPage from "./pages/DocFormPage";
import DocListPage from "./pages/DocListPage";
import SalesOrderStock from "./pages/SalesOrderStock";
import TaskReminderChatPage from "./pages/TaskReminderChatPage";
import Login from "./pages/Login";

const EXTRA_NAV: { to: string; label: string; end: boolean; navGroup: NavGroup }[] = [
	{ to: "/sales-order/stock", label: "SO Stock helper", end: false, navGroup: "tools" },
	{ to: "/tools/reminders-chat", label: "Reminders (simple chat)", end: true, navGroup: "tools" },
];

const NAV_GROUP_LABELS: { key: NavGroup; label: string }[] = [
	{ key: "masters", label: "Masters" },
	{ key: "operations", label: "Operations" },
	{ key: "tools", label: "Tools" },
];

function NavFooter() {
	const { logout, currentUser } = useFrappeAuth();
	const nav = useNavigate();
	return (
		<div className="mm-nav-footer">
			<div className="mm-nav-user">{currentUser}</div>
			<button
				type="button"
				className="mm-btn-nav-logout"
				onClick={async () => {
					await logout();
					nav("/login", { replace: true });
				}}
			>
				Log out
			</button>
		</div>
	);
}

function AuthedShell() {
	const { currentUser, isLoading } = useFrappeAuth();
	if (isLoading) {
		return (
			<div className="mm-shell mm-shell-center">
				<div className="mm-card mm-card-pad">Loading session…</div>
			</div>
		);
	}
	if (!currentUser || currentUser === "Guest") {
		return <Navigate to="/login" replace state={{ from: window.location.pathname }} />;
	}
	return (
		<div className="mm-shell">
			<nav className="mm-nav">
				<div className="mm-nav-brand">Mahaveer Metallic</div>
				<div className="mm-nav-scroll">
					<NavLink to="/" end className={({ isActive }) => `mm-nav-top ${isActive ? "active" : ""}`}>
						Dashboard
					</NavLink>
					{NAV_GROUP_LABELS.map((g) => {
						const items = DOC_REGISTRY.filter((d) => (d.navGroup ?? "masters") === g.key);
						const extras = EXTRA_NAV.filter((e) => e.navGroup === g.key);
						if (!items.length && !extras.length) return null;
						return (
							<div key={g.key} className="mm-nav-group">
								<div className="mm-nav-group-label">{g.label}</div>
								{items.map((d) => (
									<NavLink key={d.slug} to={d.routeBase} className={({ isActive }) => (isActive ? "active" : "")}>
										{d.title}
									</NavLink>
								))}
								{extras.map((l) => (
									<NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
										{l.label}
									</NavLink>
								))}
							</div>
						);
					})}
				</div>
				<NavFooter />
			</nav>
			<main className="mm-main mm-main-work">
				<Outlet />
			</main>
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
						{DOC_REGISTRY.map((meta) => (
							<Route key={meta.slug} path={meta.routeBase} element={<DocListPage meta={meta} />} />
						))}
						{DOC_REGISTRY.map((meta) => (
							<Route key={`${meta.slug}-new`} path={`${meta.routeBase}/new`} element={<DocFormPage meta={meta} />} />
						))}
						{DOC_REGISTRY.map((meta) => (
							<Route
								key={`${meta.slug}-edit`}
								path={`${meta.routeBase}/:name`}
								element={<DocFormPage meta={meta} />}
							/>
						))}
						<Route path="/sales-order/stock" element={<SalesOrderStock />} />
						<Route path="/tools/reminders-chat" element={<TaskReminderChatPage />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</FrappeProvider>
	);
}
