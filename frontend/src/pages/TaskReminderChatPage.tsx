import { extractErrorMessage } from "@/utils/frappeError";
import { useFrappeAuth, useFrappeCreateDoc, useSearch } from "frappe-react-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function pad2(n: number) {
	return String(n).padStart(2, "0");
}

/** Value for `<input type="datetime-local" />` in local time. */
function toDatetimeLocalValue(d: Date) {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Frappe Datetime string from `datetime-local` value. */
function toFrappeDatetime(local: string): string {
	if (!local) return "";
	const normalized = local.includes("T") ? local.replace("T", " ") : local;
	if (normalized.length === 16) return `${normalized}:00`;
	return normalized;
}

const INTERVAL_CHIPS = [1, 2, 4, 8, 24];

function UserPickerBlock({
	title,
	hint,
	users,
	onChange,
}: {
	title: string;
	hint: string;
	users: string[];
	onChange: (next: string[]) => void;
}) {
	const [q, setQ] = useState("");
	const { data, isLoading } = useSearch("User", q, undefined, 15, 300);
	const suggestions = data?.message ?? [];

	function addUser(id: string) {
		const v = id.trim();
		if (!v || users.includes(v)) return;
		onChange([...users, v]);
		setQ("");
	}

	return (
		<div className="mm-chat-card-block">
			<p className="mm-chat-card-title">{title}</p>
			<p className="mm-chat-card-hint">{hint}</p>
			<div className="mm-chat-chips" role="list">
				{users.map((u) => (
					<button
						key={u}
						type="button"
						className="mm-chat-chip mm-chat-chip-user"
						onClick={() => onChange(users.filter((x) => x !== u))}
						aria-label={`Remove ${u}`}
					>
						{u}
						<span className="mm-chat-chip-x" aria-hidden>
							×
						</span>
					</button>
				))}
			</div>
			<div className="mm-chat-user-search">
				<input
					className="mm-input mm-chat-input-lg"
					placeholder="Type name or email…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					autoComplete="off"
					aria-label="Search user"
				/>
				{q.trim().length >= 1 && (
					<div className="mm-chat-suggest" role="listbox">
						{isLoading && <div className="mm-chat-suggest-row muted">Searching…</div>}
						{!isLoading &&
							suggestions.map((s) => (
								<button
									key={s.value}
									type="button"
									className="mm-chat-suggest-row"
									onClick={() => addUser(s.value)}
								>
									<span className="mm-chat-suggest-label">{s.label || s.value}</span>
									{s.description ? <span className="mm-chat-suggest-desc">{s.description}</span> : null}
								</button>
							))}
						{!isLoading && suggestions.length === 0 && <div className="mm-chat-suggest-row muted">No matches.</div>}
					</div>
				)}
			</div>
		</div>
	);
}

export default function TaskReminderChatPage() {
	const nav = useNavigate();
	const { currentUser } = useFrappeAuth();
	const { createDoc, loading } = useFrappeCreateDoc();
	const streamRef = useRef<HTMLDivElement>(null);

	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [fromLocal, setFromLocal] = useState(() => toDatetimeLocalValue(new Date()));
	const [toLocal, setToLocal] = useState("");
	const [intervalHours, setIntervalHours] = useState(1);
	const [includePoll, setIncludePoll] = useState(true);
	const [reminderUsers, setReminderUsers] = useState<string[]>([]);
	const [completionUsers, setCompletionUsers] = useState<string[]>([]);
	const [formError, setFormError] = useState<string | null>(null);
	const [successName, setSuccessName] = useState<string | null>(null);

	const seeded = useRef(false);
	useEffect(() => {
		if (seeded.current) return;
		if (currentUser && currentUser !== "Guest") {
			setReminderUsers([currentUser]);
			seeded.current = true;
		}
	}, [currentUser]);

	useEffect(() => {
		if (successName && streamRef.current) {
			streamRef.current.scrollTop = streamRef.current.scrollHeight;
		}
	}, [successName]);

	const payloadBase = useMemo(
		() => ({
			title: title.trim(),
			description: description.trim() || undefined,
			from_datetime: toFrappeDatetime(fromLocal),
			to_datetime: toLocal.trim() ? toFrappeDatetime(toLocal) : "",
			reminder_interval_hours: intervalHours,
			include_yes_no_poll: includePoll ? 1 : 0,
			reminder_recipients: reminderUsers.map((user, i) => ({ user, idx: i + 1 })),
			completion_recipients: completionUsers.map((user, i) => ({ user, idx: i + 1 })),
		}),
		[title, description, fromLocal, toLocal, intervalHours, includePoll, reminderUsers, completionUsers],
	);

	function validate(): string | null {
		if (!title.trim()) return "Please write what the reminder is about (short title).";
		if (!fromLocal.trim()) return "Choose date and time for when reminders should start.";
		if (!intervalHours || intervalHours <= 0) return "Choose how many hours between each reminder.";
		if (!reminderUsers.length) return "Add at least one person who should get the reminder messages.";
		return null;
	}

	async function submit(status: "Draft" | "Active") {
		setFormError(null);
		const err = validate();
		if (err) {
			setFormError(err);
			return;
		}
		try {
			const res = await createDoc("MM Task Reminder", {
				doctype: "MM Task Reminder",
				...payloadBase,
				status,
			});
			const n = (res as { name?: string }).name;
			if (n) {
				setSuccessName(n);
				return;
			}
			setFormError("Saved but no document name returned. Check the list.");
		} catch (e) {
			setFormError(extractErrorMessage(e));
		}
	}

	function resetForAnother() {
		setSuccessName(null);
		setTitle("");
		setDescription("");
		setFromLocal(toDatetimeLocalValue(new Date()));
		setToLocal("");
		setIntervalHours(1);
		setIncludePoll(true);
		setFormError(null);
		if (currentUser && currentUser !== "Guest") setReminderUsers([currentUser]);
		else setReminderUsers([]);
		setCompletionUsers([]);
	}

	return (
		<div className="mm-page mm-page-enter mm-chat-page">
			<header className="mm-chat-header">
				<div>
					<h1 className="mm-page-title">Task reminders — simple steps</h1>
					<p className="mm-page-sub">
						Chat-style screen: one question at a time. Hindi + English hints. For the full table form, use{" "}
						<Link to="/tools/task-reminder" className="mm-link-pill">
							Task reminder list
						</Link>
						.
					</p>
				</div>
			</header>

			<div className="mm-chat-stream" ref={streamRef}>
				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						MM
					</div>
					<div className="mm-chat-bubble assistant">
						<strong>Hello.</strong> This screen sets up phone / Raven reminders for a job. Answer each box below, then press{" "}
						<strong>Start reminders</strong> or <strong>Save draft</strong> at the bottom.
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						1
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Kaam kya hai? / What is the task?</span>
						</p>
						<input
							className="mm-input mm-chat-input-lg"
							placeholder="e.g. Finish packing Lot A, clean machine 2…"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							aria-label="Task title"
						/>
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						2
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Aur detail? / More details (optional)</span>
						</p>
						<textarea
							className="mm-input mm-chat-textarea"
							rows={3}
							placeholder="Anything workers should know…"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							aria-label="Details"
						/>
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						3
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Kab se yaad dilayein? / From when should we ping?</span>
						</p>
						<label className="mm-chat-label" htmlFor="mm-chat-from">
							Start date &amp; time
						</label>
						<input
							id="mm-chat-from"
							type="datetime-local"
							className="mm-input mm-chat-input-lg"
							value={fromLocal}
							onChange={(e) => setFromLocal(e.target.value)}
						/>
						<p className="mm-chat-q mm-chat-q-spaced">
							<span className="mm-chat-bilingual">Kab tak? / Until when? (optional)</span>
						</p>
						<label className="mm-chat-label" htmlFor="mm-chat-to">
							Stop after this time (leave empty = until someone marks done)
						</label>
						<input
							id="mm-chat-to"
							type="datetime-local"
							className="mm-input mm-chat-input-lg"
							value={toLocal}
							onChange={(e) => setToLocal(e.target.value)}
						/>
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						4
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Kitne ghante baad baar‑baar? / Repeat every how many hours?</span>
						</p>
						<div className="mm-chat-interval-row">
							{INTERVAL_CHIPS.map((h) => (
								<button
									key={h}
									type="button"
									className={`mm-chat-interval-chip ${intervalHours === h ? "active" : ""}`}
									onClick={() => setIntervalHours(h)}
								>
									{h}h
								</button>
							))}
						</div>
						<label className="mm-chat-label" htmlFor="mm-chat-interval-custom">
							Or type a number (hours)
						</label>
						<input
							id="mm-chat-interval-custom"
							type="number"
							min={0.25}
							step="any"
							className="mm-input mm-chat-input-lg mm-chat-interval-input"
							value={intervalHours}
							onChange={(e) => setIntervalHours(Number(e.target.value) || 1)}
						/>
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						5
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Kisko message bhejein? / Who gets the reminders?</span>
						</p>
						<UserPickerBlock
							title="Reminder people"
							hint="Tap a name below to remove. Search to add."
							users={reminderUsers}
							onChange={setReminderUsers}
						/>
						<button type="button" className="mm-btn-secondary mm-chat-copy-btn" onClick={() => setCompletionUsers([...reminderUsers])}>
							Same people when job is done
						</button>
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						6
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Kaam complete hone par kisko batayein? / Who to notify when finished?</span>
						</p>
						<UserPickerBlock
							title="Done / complete message (optional)"
							hint="Managers or office — who should get “task done”."
							users={completionUsers}
							onChange={setCompletionUsers}
						/>
					</div>
				</div>

				<div className="mm-chat-row assistant">
					<div className="mm-chat-avatar" aria-hidden>
						7
					</div>
					<div className="mm-chat-bubble assistant">
						<p className="mm-chat-q">
							<span className="mm-chat-bilingual">Haan / Naa button chahiye? / Yes–No button on Raven?</span>
						</p>
						<p className="mm-chat-card-hint">Workers can tap Yes when the job is finished (if Raven is set up).</p>
						<div className="mm-chat-yesno">
							<button
								type="button"
								className={`mm-chat-yesno-btn ${includePoll ? "active" : ""}`}
								onClick={() => setIncludePoll(true)}
							>
								Yes — send poll
							</button>
							<button
								type="button"
								className={`mm-chat-yesno-btn ${!includePoll ? "active" : ""}`}
								onClick={() => setIncludePoll(false)}
							>
								No — text only
							</button>
						</div>
					</div>
				</div>

				{formError && (
					<div className="mm-chat-row assistant">
						<div className="mm-chat-avatar mm-chat-avatar-warn" aria-hidden>
							!
						</div>
						<div className="mm-chat-bubble warn" role="alert">
							{formError}
						</div>
					</div>
				)}

				{successName && (
					<div className="mm-chat-row assistant">
						<div className="mm-chat-avatar mm-chat-avatar-ok" aria-hidden>
							✓
						</div>
						<div className="mm-chat-bubble ok">
							<p>
								<strong>Saved.</strong> Reminder id: <code className="mm-chat-code">{successName}</code>
							</p>
							<div className="mm-chat-success-actions">
								<button type="button" className="mm-btn-primary" onClick={() => nav(`/tools/task-reminder/${encodeURIComponent(successName)}`)}>
									Open full form
								</button>
								<Link className="mm-btn-secondary" to="/tools/task-reminder">
									Back to list
								</Link>
								<button type="button" className="mm-btn-secondary" onClick={resetForAnother}>
									Plan another reminder
								</button>
							</div>
						</div>
					</div>
				)}
			</div>

			<div className="mm-chat-footer">
				<button type="button" className="mm-btn-primary mm-btn-glow mm-chat-footer-primary" disabled={loading} onClick={() => void submit("Active")}>
					{loading ? "Saving…" : "Start reminders now"}
				</button>
				<button type="button" className="mm-btn-secondary mm-chat-footer-secondary" disabled={loading} onClick={() => void submit("Draft")}>
					Save as draft
				</button>
			</div>
		</div>
	);
}
