import { extractErrorMessage } from "@/utils/frappeError";
import { useFrappeAuth, useFrappeCreateDoc, useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { 
  Users, 
  ShieldAlert, 
  Clock, 
  Calendar, 
  Send, 
  X,
  ChevronDown
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function pad2(n: number) {
	return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date) {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toFrappeDatetime(local: string): string {
	if (!local) return "";
	const normalized = local.includes("T") ? local.replace("T", " ") : local;
	if (normalized.length === 16) return `${normalized}:00`;
	return normalized;
}

// value is in hours (fractional for minutes)
const INTERVAL_CHIPS: { label: string; value: number }[] = [
  { label: '15m', value: 0.25 },
  { label: '30m', value: 0.5 },
  { label: '1h', value: 1 },
  { label: '2h', value: 2 },
  { label: '4h', value: 4 },
  { label: '8h', value: 8 },
  { label: '24h', value: 24 },
];

function formatInterval(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours}h`;
}

interface Message {
  id: string;
  type: 'assistant' | 'user';
  content: string | React.ReactNode;
  variant?: 'normal' | 'success' | 'error';
}

export default function TaskReminderChatPage() {
	const nav = useNavigate();
	const { currentUser } = useFrappeAuth();
	const { createDoc, loading } = useFrappeCreateDoc();
	const streamRef = useRef<HTMLDivElement>(null);
	const footerRef = useRef<HTMLDivElement>(null);
	const searchContainerRef = useRef<HTMLDivElement>(null);

	const { data: activeTasks } = useFrappeGetCall(
		"mahaveermetalic.mahaveer_metallic.doctype.mm_task_reminder.poll_hooks.get_active_tasks_for_user"
	);

	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [fromLocal, setFromLocal] = useState(() => toDatetimeLocalValue(new Date()));
	const [toLocal, setToLocal] = useState("");
	const [intervalHours, setIntervalHours] = useState(1);
	const [reminderUsers, setReminderUsers] = useState<string[]>([]);
	const [completionUsers, setCompletionUsers] = useState<string[]>([]);
	
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'assistant',
      content: (
        <>
          <strong>Welcome back.</strong> How can I help you today? Type your message below and use the options to configure recipients and timing.
        </>
      )
    }
  ]);

  const [activeOverlay, setActiveOverlay] = useState<'assign' | 'notify' | 'duration' | 'dates' | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // Fetch all users for dropdown
  const { data: allUsersData } = useFrappeGetDocList("User", {
    fields: ["name", "full_name", "user_image"],
    filters: [["enabled", "=", 1], ["user_type", "=", "System User"]],
    limit: 50,
    orderBy: { field: "full_name", order: "asc" },
  });

  const allUsers = allUsersData ?? [];

  // Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!userQuery.trim()) return allUsers;
    const q = userQuery.toLowerCase();
    return allUsers.filter(u => 
      (u.full_name || "").toLowerCase().includes(q) || 
      (u.name || "").toLowerCase().includes(q)
    );
  }, [allUsers, userQuery]);

	const seeded = useRef(false);
	useEffect(() => {
		if (seeded.current) return;
		if (currentUser && currentUser.toLowerCase() !== "guest" && currentUser.toLowerCase() !== "administrator") {
			setReminderUsers([currentUser]);
			seeded.current = true;
		}
	}, [currentUser]);

	useEffect(() => {
		if (streamRef.current) {
			streamRef.current.scrollTop = streamRef.current.scrollHeight;
		}
	}, [messages]);

	useEffect(() => {
		if (activeTasks && Array.isArray(activeTasks)) {
			const activeTasksMsg: Message = {
				id: "active-tasks-list",
				type: "assistant",
				content: (
					<div>
						<p>📋 <strong>Your Active Tasks ({activeTasks.length})</strong></p>
						{activeTasks.length === 0 ? (
							<p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem', margin: '4px 0 0 0' }}>
								You have no active tasks at the moment!
							</p>
						) : (
							activeTasks.map((t: any, index: number) => {
								const intervalMin = t.reminder_interval_minutes || 60;
								let intervalStr = "";
								if (intervalMin < 60) {
									intervalStr = `${intervalMin}m`;
								} else if (intervalMin % 60 === 0) {
									intervalStr = `${intervalMin / 60}h`;
								} else {
									intervalStr = `${(intervalMin / 60).toFixed(1)}h`;
								}

								return (
									<div key={t.name} className="mm-active-task-item" style={{
										borderLeft: t.role === "Owner" ? '3px solid #10b981' : '3px solid #3b82f6',
										paddingLeft: '8px',
										marginBottom: '12px',
										fontSize: '0.9rem'
									}}>
										<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
											<strong>{index + 1}. {t.title}</strong>
											<span style={{
												fontSize: '0.7rem',
												fontWeight: 'bold',
												padding: '1px 6px',
												borderRadius: '4px',
												backgroundColor: t.role === "Owner" ? '#d1fae5' : '#dbeafe',
												color: t.role === "Owner" ? '#065f46' : '#1e40af'
											}}>
												{t.role}
											</span>
										</div>
										<span style={{color: '#64748b', fontSize: '0.85rem'}}>
											{t.role === "Owner" ? (
												<>Assigned to: <strong>{t.assignees ? t.assignees.join(', ') : 'None'}</strong></>
											) : (
												<>Assigned by: <strong>{t.creator_name}</strong></>
											)}
											{" | Status: "}<strong style={{color: '#3b82f6'}}>{t.status}</strong>
										</span><br/>
										{t.description && <span style={{display: 'block', fontStyle: 'italic', margin: '4px 0', color: '#475569'}}>{t.description}</span>}
										<span style={{color: '#94a3b8', fontSize: '0.8rem'}}>Repeats every {intervalStr}</span>
									</div>
								);
							})
						)}
					</div>
				)
			};
			setMessages(prev => {
				if (prev.some(m => m.id === "active-tasks-list")) {
					return prev.map(m => m.id === "active-tasks-list" ? activeTasksMsg : m);
				}
				return [...prev, activeTasksMsg];
			});
		}
	}, [activeTasks]);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (footerRef.current && !footerRef.current.contains(event.target as Node)) {
				setActiveOverlay(null);
			}
			if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
				setShowDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, []);

  // Reset search when overlay changes
  useEffect(() => {
    setUserQuery("");
    setShowDropdown(false);
  }, [activeOverlay]);

	const payloadBase = useMemo(
		() => ({
			title: title.trim(),
			description: description.trim() || undefined,
			from_datetime: toFrappeDatetime(fromLocal),
			to_datetime: toLocal.trim() ? toFrappeDatetime(toLocal) : "",
			reminder_interval_minutes: Math.round(intervalHours * 60),
			include_yes_no_poll: 1,
			reminder_recipients: reminderUsers.map((user, i) => ({ user, idx: i + 1 })),
			completion_recipients: completionUsers.map((user, i) => ({ user, idx: i + 1 })),
		}),
		[title, description, fromLocal, toLocal, intervalHours, reminderUsers, completionUsers],
	);

	function validate(): string | null {
		if (!title.trim()) return "Please enter a message to continue.";
		if (!fromLocal.trim()) return "A start time is required.";
		if (!reminderUsers.length) return "Please assign at least one recipient.";
		return null;
	}

	async function submit() {
		const err = validate();
		if (err) {
      setMessages(prev => [...prev, { id: Date.now().toString(), type: 'assistant', content: err, variant: 'error' }]);
			return;
		}

    setMessages(prev => [...prev, { id: 'sending', type: 'assistant', content: <div className="mm-typing"><div className="mm-typing-dot"></div><div className="mm-typing-dot"></div><div className="mm-typing-dot"></div></div> }]);

		try {
			const res = await createDoc("MM Task Reminder", {
				doctype: "MM Task Reminder",
				...payloadBase,
				status: "Active",
			});
			const n = (res as { name?: string }).name;
			if (n) {
				setTitle("");
				setDescription("");
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== 'sending');
          return [...filtered, { 
            id: n, 
            type: 'assistant', 
            variant: 'success',
            content: (
              <div>
                <strong>Reminder created successfully.</strong><br/>
                Repeats every {intervalHours} hour(s).<br/>
                <div className="mm-chat-success-actions">
                  <button type="button" className="mm-btn-primary" onClick={() => nav(`/tools/task-reminder/${encodeURIComponent(n)}`)}>View Details</button>
                  <button type="button" className="mm-btn-secondary" onClick={resetForAnother}>New Reminder</button>
                </div>
              </div>
            )
          }];
        });
				return;
			}
		} catch (e) {
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== 'sending');
        return [...filtered, { id: Date.now().toString(), type: 'assistant', content: extractErrorMessage(e), variant: 'error' }];
      });
		}
	}

	function resetForAnother() {
		setTitle("");
		setDescription("");
		setFromLocal(toDatetimeLocalValue(new Date()));
		setToLocal("");
		setIntervalHours(1);
		if (currentUser && currentUser.toLowerCase() !== "guest" && currentUser.toLowerCase() !== "administrator") setReminderUsers([currentUser]);
		else setReminderUsers([]);
		setCompletionUsers([]);
    setMessages([{
      id: 'welcome-' + Date.now(),
      type: 'assistant',
      content: "Ready. What would you like to set up?"
    }]);
	}

  function addUser(id: string, list: 'reminder' | 'completion') {
    if (list === 'reminder') {
      if (!reminderUsers.includes(id)) setReminderUsers([...reminderUsers, id]);
    } else {
      if (!completionUsers.includes(id)) setCompletionUsers([...completionUsers, id]);
    }
    setUserQuery("");
    setShowDropdown(false);
  }

  function removeUser(id: string, list: 'reminder' | 'completion') {
    if (list === 'reminder') {
      setReminderUsers(reminderUsers.filter(u => u !== id));
    } else {
      setCompletionUsers(completionUsers.filter(u => u !== id));
    }
  }

  const toggleOverlay = (type: 'assign' | 'notify' | 'duration' | 'dates') => {
    setActiveOverlay(prev => prev === type ? null : type);
  }

  /** Reusable user picker overlay */
  function renderUserPicker(list: 'reminder' | 'completion', title: string, selectedUsers: string[]) {
    return (
      <div className="mm-chat-overlay">
        <div className="mm-chat-overlay-head">
          <span className="mm-chat-overlay-title">{title}</span>
          <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={18}/></button>
        </div>

        {/* Selected users as chips */}
        {selectedUsers.length > 0 && (
          <div className="mm-chat-chips">
            {selectedUsers.map(u => {
              const userData = allUsers.find(au => au.name === u);
              return (
                <span key={u} className="mm-chat-chip-user">
                  {userData?.full_name || u}
                  <X size={14} style={{cursor: 'pointer', marginLeft: '4px', opacity: 0.6}} onClick={() => removeUser(u, list)}/>
                </span>
              );
            })}
          </div>
        )}

        {/* Search + Dropdown */}
        <div className="mm-chat-user-search" ref={searchContainerRef}>
          <div className="mm-chat-select-trigger" onClick={() => setShowDropdown(!showDropdown)}>
            <input 
              className="mm-input" 
              placeholder="Search or select user..." 
              value={userQuery} 
              onChange={(e) => { setUserQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
            />
            <ChevronDown size={16} className="mm-chat-select-arrow" />
          </div>
          {showDropdown && (
            <div className="mm-chat-suggest">
              {filteredUsers.length === 0 ? (
                <div className="mm-chat-suggest-row" style={{color: '#94a3b8', cursor: 'default'}}>No users found</div>
              ) : (
                filteredUsers
                  .filter(u => !selectedUsers.includes(u.name))
                  .map(u => (
                    <button key={u.name} type="button" className="mm-chat-suggest-row" onClick={() => addUser(u.name, list)}>
                      <span style={{fontWeight: 600}}>{u.full_name || u.name}</span>
                      {u.full_name && u.full_name !== u.name && (
                        <span style={{color: '#94a3b8', fontSize: '0.75rem', marginLeft: '0.5rem'}}>{u.name}</span>
                      )}
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

	return (
		<div className="mm-page-enter mm-chat-page">
			<header className="mm-chat-header">
				<h1>Task Reminders</h1>
        <Link to="/tools/task-reminder" className="mm-btn-secondary">
          History
        </Link>
			</header>

			<div className="mm-chat-stream" ref={streamRef}>
        {messages.map(m => (
          <div key={m.id} className={`mm-chat-row ${m.type}`}>
            <div className="mm-chat-avatar">
              {m.type === 'assistant' ? 'AI' : 'ME'}
            </div>
            <div className={`mm-chat-bubble ${m.variant === 'success' ? 'mm-chat-success-bubble' : m.variant === 'error' ? 'mm-chat-error-bubble' : ''}`}>
              {m.content}
            </div>
          </div>
        ))}
			</div>

			<div className="mm-chat-footer" ref={footerRef}>
        {activeOverlay === 'assign' && renderUserPicker('reminder', 'Assign Recipients', reminderUsers)}
        {activeOverlay === 'notify' && renderUserPicker('completion', 'Completion Notifications', completionUsers)}

        {activeOverlay === 'duration' && (
          <div className="mm-chat-overlay">
            <div className="mm-chat-overlay-head">
              <span className="mm-chat-overlay-title">Recurrence Interval</span>
              <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={18}/></button>
            </div>
            <div className="mm-chat-interval-row">
							{INTERVAL_CHIPS.map((chip) => (
								<button key={chip.value} type="button"
									className={`mm-chat-interval-chip ${intervalHours === chip.value ? "active" : ""}`}
									onClick={() => setIntervalHours(chip.value)}
								>
									{chip.label}
								</button>
							))}
						</div>
            <div style={{marginTop: '0.75rem'}}>
              <label className="mm-chat-label" style={{display: 'block', marginBottom: '0.4rem'}}>Custom (minutes)</label>
              <input type="number" className="mm-input" value={Math.round(intervalHours * 60)} 
                onChange={(e) => setIntervalHours(Number(e.target.value) / 60)} min={5} step={5}
              />
            </div>
          </div>
        )}

        {activeOverlay === 'dates' && (
          <div className="mm-chat-overlay">
            <div className="mm-chat-overlay-head">
              <span className="mm-chat-overlay-title">Schedule Window</span>
              <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={18}/></button>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
              <div>
                <label className="mm-chat-label" style={{display: 'block', marginBottom: '0.4rem'}}>Start Date & Time</label>
                <input type="datetime-local" className="mm-input" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
              </div>
              <div>
                <label className="mm-chat-label" style={{display: 'block', marginBottom: '0.4rem'}}>End Date & Time (Optional)</label>
                <input type="datetime-local" className="mm-input" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <div className="mm-chat-actions-row">
          <button type="button"
            className={`mm-chat-action-btn ${reminderUsers.length > 0 ? 'active' : ''}`} 
            onClick={() => toggleOverlay('assign')}
          >
            <Users size={18} /> {reminderUsers.length || 'Assign'}
          </button>
          <button type="button"
            className={`mm-chat-action-btn ${completionUsers.length > 0 ? 'active' : ''}`} 
            onClick={() => toggleOverlay('notify')}
          >
            <ShieldAlert size={18} /> {completionUsers.length || 'Notify'}
          </button>
          <button type="button"
            className={`mm-chat-action-btn active`} 
            onClick={() => toggleOverlay('duration')}
          >
            <Clock size={18} /> {formatInterval(intervalHours)}
          </button>
          <button type="button"
            className={`mm-chat-action-btn ${toLocal ? 'active' : ''}`} 
            onClick={() => toggleOverlay('dates')}
          >
            <Calendar size={18} /> {toLocal ? 'Scheduled' : 'Schedule'}
          </button>
        </div>

        <div className="mm-chat-input-row">
          <textarea 
            className="mm-chat-input-box" 
            placeholder="Write your request..." 
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button 
            className="mm-chat-send-btn" 
            disabled={loading || !title.trim()} 
            onClick={submit}
          >
            <Send size={22} />
          </button>
        </div>
			</div>
		</div>
	);
}
