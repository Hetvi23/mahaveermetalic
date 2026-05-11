import { extractErrorMessage } from "@/utils/frappeError";
import { useFrappeAuth, useFrappeCreateDoc, useSearch } from "frappe-react-sdk";
import { 
  Users, 
  ShieldAlert, 
  Clock, 
  Calendar, 
  Send, 
  X
} from "lucide-react";
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
	const { data: searchData, isLoading: searchLoading } = useSearch("User", userQuery, undefined, 15, 300);
	const suggestions = searchData?.message ?? [];

	const seeded = useRef(false);
	useEffect(() => {
		if (seeded.current) return;
		if (currentUser && currentUser !== "Guest") {
			setReminderUsers([currentUser]);
			seeded.current = true;
		}
	}, [currentUser]);

	useEffect(() => {
		if (streamRef.current) {
			streamRef.current.scrollTop = streamRef.current.scrollHeight;
		}
	}, [messages]);

	const payloadBase = useMemo(
		() => ({
			title: title.trim(),
			description: description.trim() || undefined,
			from_datetime: toFrappeDatetime(fromLocal),
			to_datetime: toLocal.trim() ? toFrappeDatetime(toLocal) : "",
			reminder_interval_hours: intervalHours,
			include_yes_no_poll: 1, // Default to Yes
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
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== 'sending');
          return [...filtered, { 
            id: n, 
            type: 'assistant', 
            variant: 'success',
            content: (
              <div>
                <strong>Reminder initialized successfully.</strong><br/>
                Repetitions set for every {intervalHours} hour(s).<br/>
                <div className="mm-chat-success-actions">
                  <button type="button" className="mm-btn-primary" style={{marginTop: '1rem', marginRight: '0.5rem'}} onClick={() => nav(`/tools/task-reminder/${encodeURIComponent(n)}`)}>Details</button>
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
		if (currentUser && currentUser !== "Guest") setReminderUsers([currentUser]);
		else setReminderUsers([]);
		setCompletionUsers([]);
    setMessages([{
      id: 'welcome-' + Date.now(),
      type: 'assistant',
      content: "Ready for your next request. What would you like to set up?"
    }]);
	}

  function addUser(id: string, list: 'reminder' | 'completion') {
    if (list === 'reminder') {
      if (!reminderUsers.includes(id)) setReminderUsers([...reminderUsers, id]);
    } else {
      if (!completionUsers.includes(id)) setCompletionUsers([...completionUsers, id]);
    }
    setUserQuery("");
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

			<div className="mm-chat-footer">
        {activeOverlay === 'assign' && (
          <div className="mm-chat-overlay">
            <div className="mm-chat-overlay-head">
              <span className="mm-chat-overlay-title">Assign Recipients</span>
              <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={20}/></button>
            </div>
            <div className="mm-chat-chips">
              {reminderUsers.map(u => (
                <span key={u} className="mm-chat-chip-user">
                  {u} <X size={14} style={{cursor: 'pointer', marginLeft: '4px'}} onClick={() => removeUser(u, 'reminder')}/>
                </span>
              ))}
            </div>
            <div className="mm-chat-user-search">
              <input 
                className="mm-input" 
                placeholder="Search users..." 
                value={userQuery} 
                onChange={(e) => setUserQuery(e.target.value)}
              />
              {userQuery && (
                <div className="mm-chat-suggest">
                  {searchLoading ? <div className="mm-chat-suggest-row">Searching...</div> : 
                    suggestions.map(s => (
                      <button key={s.value} type="button" className="mm-chat-suggest-row" onClick={() => addUser(s.value, 'reminder')}>
                        {s.label || s.value}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {activeOverlay === 'notify' && (
          <div className="mm-chat-overlay">
            <div className="mm-chat-overlay-head">
              <span className="mm-chat-overlay-title">Completion Notifications</span>
              <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={20}/></button>
            </div>
            <div className="mm-chat-chips">
              {completionUsers.map(u => (
                <span key={u} className="mm-chat-chip-user">
                  {u} <X size={14} style={{cursor: 'pointer', marginLeft: '4px'}} onClick={() => removeUser(u, 'completion')}/>
                </span>
              ))}
            </div>
            <div className="mm-chat-user-search">
              <input 
                className="mm-input" 
                placeholder="Search admins..." 
                value={userQuery} 
                onChange={(e) => setUserQuery(e.target.value)}
              />
              {userQuery && (
                <div className="mm-chat-suggest">
                   {searchLoading ? <div className="mm-chat-suggest-row">Searching...</div> : 
                    suggestions.map(s => (
                      <button key={s.value} type="button" className="mm-chat-suggest-row" onClick={() => addUser(s.value, 'completion')}>
                        {s.label || s.value}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {activeOverlay === 'duration' && (
          <div className="mm-chat-overlay">
            <div className="mm-chat-overlay-head">
              <span className="mm-chat-overlay-title">Recurrence Interval</span>
              <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={20}/></button>
            </div>
            <div className="mm-chat-interval-row" style={{justifyContent: 'center'}}>
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
            <input 
              type="number" 
              className="mm-input" 
              style={{marginTop: '1rem'}}
              value={intervalHours} 
              onChange={(e) => setIntervalHours(Number(e.target.value))}
              placeholder="Custom hours..."
            />
          </div>
        )}

        {activeOverlay === 'dates' && (
          <div className="mm-chat-overlay">
            <div className="mm-chat-overlay-head">
              <span className="mm-chat-overlay-title">Schedule Window</span>
              <button type="button" className="mm-chat-overlay-close" onClick={() => setActiveOverlay(null)}><X size={20}/></button>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
              <div>
                <label className="mm-chat-label" style={{marginBottom: '0.5rem', display: 'block', fontWeight: '600'}}>Commences At</label>
                <input type="datetime-local" className="mm-input" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
              </div>
              <div>
                <label className="mm-chat-label" style={{marginBottom: '0.5rem', display: 'block', fontWeight: '600'}}>Terminates At (Optional)</label>
                <input type="datetime-local" className="mm-input" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <div className="mm-chat-actions-row">
          <button 
            type="button"
            className={`mm-chat-action-btn ${reminderUsers.length > 0 ? 'active' : ''}`} 
            onPointerDown={() => toggleOverlay('assign')}
            onClick={() => toggleOverlay('assign')}
          >
            <Users size={18} /> {reminderUsers.length || 'Assign'}
          </button>
          <button 
            type="button"
            className={`mm-chat-action-btn ${completionUsers.length > 0 ? 'active' : ''}`} 
            onPointerDown={() => toggleOverlay('notify')}
            onClick={() => toggleOverlay('notify')}
          >
            <ShieldAlert size={18} /> {completionUsers.length || 'Notify'}
          </button>
          <button 
            type="button"
            className={`mm-chat-action-btn active`} 
            onPointerDown={() => toggleOverlay('duration')}
            onClick={() => toggleOverlay('duration')}
          >
            <Clock size={18} /> {intervalHours}h
          </button>
          <button 
            type="button"
            className={`mm-chat-action-btn ${toLocal ? 'active' : ''}`} 
            onPointerDown={() => toggleOverlay('dates')}
            onClick={() => toggleOverlay('dates')}
          >
            <Calendar size={18} /> {toLocal ? 'Window' : 'Schedule'}
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
