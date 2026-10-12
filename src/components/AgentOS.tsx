'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, ArrowUp, AudioLines, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight,
  Circle, CircleCheck, Command, Copy, Cpu, ExternalLink, FolderOpen, LayoutGrid, ListTodo,
  LoaderCircle, Menu, MessageSquare, Moon, MoreHorizontal, PanelRight, Plus, RefreshCw,
  Search, Settings2, ShieldCheck, Sparkles, Square, Sun, Terminal, Trash2, Users, X, Zap,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AgentPresence from './AgentPresence';
import { api, post } from '../lib/api';
import type { ActivityEvent, Bootstrap, Conversation, MemoryFile, Profile, Run, Task, Thread, View } from '../lib/types';

const navigation: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'workspace', label: 'Workspace', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'activity', label: 'Activity', icon: AudioLines },
  { id: 'memory', label: 'Memory', icon: BookOpen },
];
const running = (status?: string) => status === 'running' || status === 'waiting';
const shortModel = (model: string) => model.split('/').at(-1) || model;
const relativeTime = (date: string) => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return mins < 1 ? 'Just now' : mins < 60 ? mins + 'm ago' : mins < 1440 ? Math.floor(mins / 60) + 'h ago' : Math.floor(mins / 1440) + 'd ago';
};
const roleFor = (id: string) => ({ fiddle: 'Design', sigma: 'Engineering', scout: 'Research', ledger: 'Finance', 'hermes-root': 'Orchestrator', default: 'General' } as Record<string, string>)[id] || 'Agent';

function Mark({ small = false }: { small?: boolean }) {
  return <span className={'brand-mark ' + (small ? 'small' : '')} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>;
}
function Avatar({ profile, size = 'medium' }: { profile?: Profile; size?: 'small' | 'medium' | 'large' }) {
  const id = profile?.id || 'default';
  const Icon = id === 'sigma' ? Terminal : id === 'fiddle' ? Sparkles : id === 'scout' ? Search : id === 'ledger' ? LayoutGrid : Zap;
  return <span className={'avatar ' + size} style={{ '--agent-color': profile?.color || '#ed7040' } as CSSProperties}><Icon aria-hidden="true" /></span>;
}
function AgentPicker({ profiles, value, onChange, disabled }: { profiles: Profile[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const selected = profiles.find(p => p.id === value);
  const reveal = () => { setActive(Math.max(0, profiles.findIndex(p => p.id === value))); search.current.text = ''; setOpen(true); };
  const choose = (index: number) => { if (profiles[index]) onChange(profiles[index].id); setOpen(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      if (rect.bottom < top || rect.top > top + height) { setOpen(false); return; }
      const above = rect.top - top - 20, below = top + height - rect.bottom - 20;
      const sections = Array.from(panel.current.children) as HTMLElement[];
      const desired = Math.min(408, sections.reduce((height, section) => height + section.scrollHeight, 0) + 22);
      const upwards = below < desired && above > below;
      const available = Math.max(0, upwards ? above : below);
      const menuHeight = Math.min(desired, available);
      const menuWidth = Math.min(292, width - 24);
      setPosition({ width: menuWidth, left: Math.max(left + 12, Math.min(rect.left, left + width - menuWidth - 12)),
        top: upwards ? rect.top - 8 - menuHeight : rect.bottom + 8, maxHeight: menuHeight, visibility: 'visible' });
    };
    place();
    const dismiss = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', place);
    // Internal list scrolling must not reposition the popup.
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    window.addEventListener('scroll', scroll, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, profiles.length]);
  useEffect(() => {
    if (open) document.getElementById(id + '-option-' + active)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  return <>
    <button ref={trigger} type="button" className="agent-select" role="combobox" aria-label="Choose an agent" aria-describedby={id + '-value'}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined}
      aria-activedescendant={open ? id + '-option-' + active : undefined} disabled={disabled || !profiles.length}
      onClick={() => open ? setOpen(false) : reveal()} onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!open) reveal();
          if (event.key === 'Home') setActive(0);
          else if (event.key === 'End') setActive(profiles.length - 1);
          else if (open) setActive(index => Math.max(0, Math.min(profiles.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); if (open) choose(active); else reveal();
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          if (!open) reveal();
          const now = Date.now();
          search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
          const match = profiles.findIndex(p => p.name.toLowerCase().startsWith(search.current.text));
          if (match >= 0) setActive(match);
        }
      }}>
      <Avatar profile={selected} size="small" /><span id={id + '-value'}>{selected?.name || 'Choose agent'}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} className="agent-picker" style={position} onPointerDown={event => event.preventDefault()}>
      <div className="agent-picker-heading"><span>Choose an agent</span><span>{profiles.length} available</span></div>
      <div id={id} role="listbox" aria-label="Your agents" className="agent-picker-list">
        {profiles.map((p, index) => <div key={p.id} id={id + '-option-' + index} role="option" aria-selected={p.id === value}
          className={'agent-picker-option' + (index === active ? ' is-focused' : '')}
          onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
          <Avatar profile={p} /><span className="agent-picker-identity"><strong>{p.name}</strong><span>{roleFor(p.id)}<i aria-hidden="true">·</i>{p.skills} skills</span></span>
          {p.id === value && <span className="agent-picker-check"><Check size={14} aria-hidden="true" /></span>}
        </div>)}
      </div>
      <div className="agent-picker-footer"><span className="agent-picker-dot" />Your Hermes team</div>
    </div>, document.body)}
  </>;
}
function Status({ status }: { status: string }) {
  return <span className={'status ' + status}>
    {running(status) ? <LoaderCircle className="spin" size={12} /> : status === 'completed' || status === 'done' ? <Check size={12} /> : <Circle size={9} />}
    {({ running: 'Working', waiting: 'Needs approval', completed: 'Completed', done: 'Done', todo: 'To do', failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted' } as Record<string, string>)[status] || status}
  </span>;
}
function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p>{children}</div>;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('input, button, select, textarea')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>{children}
  </div></div>;
}

export default function AgentOS() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>('workspace');
  const [profileId, setProfileId] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Profile | null>(null);
  const [taskModal, setTaskModal] = useState<Task | 'new' | null>(null);
  const [memory, setMemory] = useState<MemoryFile[]>([]);
  const [memoryFile, setMemoryFile] = useState('MEMORY.md');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [copied, setCopied] = useState<string | null>(null);
  const threadRef = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const loadSequence = useRef(0);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const snapshot = await api<Bootstrap>('/bootstrap');
    if (!alive.current) return;
    setData(snapshot);
    setProfileId(current => snapshot.profiles.some(p => p.id === current) ? current : (snapshot.profiles.find(p => p.active)?.id || snapshot.profiles[0]?.id || ''));
  }, []);
  const loadThread = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    const next = await api<Conversation>('/threads/' + id);
    if (threadRef.current === id && sequence === loadSequence.current && alive.current) setConversation(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    setDark(localStorage.getItem('agentos-theme') === 'dark');
    const savedProfile = localStorage.getItem('agentos-profile');
    if (savedProfile) setProfileId(savedProfile);
    void reload().catch(err => setError(err.message));
    const events = new EventSource('/api/events');
    let debounce: ReturnType<typeof setTimeout> | undefined;
    events.onopen = () => {
      setConnected(true);
      void reload().catch(() => {});
      if (threadRef.current) void loadThread(threadRef.current).catch(() => {});
    };
    events.onerror = () => setConnected(false);
    events.onmessage = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        void reload().catch(err => setError(err.message));
        if (threadRef.current) void loadThread(threadRef.current).catch(err => setError(err.message));
      }, 100);
    };
    const interval = setInterval(() => void reload().catch(() => {}), 15000);
    return () => { alive.current = false; events.close(); clearTimeout(debounce); clearInterval(interval); };
  }, [reload, loadThread]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('agentos-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => { if (profileId) localStorage.setItem('agentos-profile', profileId); }, [profileId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); setSearchOpen(true); }
      if (event.key === 'Escape') setMobileMenu(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (view !== 'memory' || !profileId) return;
    let cancelled = false;
    setMemoryLoading(true);
    setMemory([]);
    api<MemoryFile[]>('/profiles/' + profileId + '/memory').then(files => {
      if (!cancelled) { setMemory(files); setMemoryFile(files[0]?.name || 'MEMORY.md'); }
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setMemoryLoading(false); });
    return () => { cancelled = true; };
  }, [view, profileId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.at(-1)?.content, conversation?.runs[0]?.status]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 180) + 'px';
    }
  }, [draft]);

  const profile = data?.profiles.find(p => p.id === (conversation && threadId ? conversation.profile : profileId));
  const activeRun = conversation?.runs.find(run => running(run.status));
  const activity = conversation?.events.filter(event => ['tool', 'plan', 'approval', 'run_started', 'run_finished'].includes(event.type)) || [];
  const navigate = (next: View) => { setView(next); setMobileMenu(false); setError(''); };
  function startNew(id?: string) {
    threadRef.current = null; ++loadSequence.current;
    setThreadId(null); setConversation(null); setDraft(''); setError(''); setView('workspace'); setMobileMenu(false);
    if (id) setProfileId(id);
    setTimeout(() => textarea.current?.focus(), 50);
  }
  async function openThread(id: string) {
    threadRef.current = id; setThreadId(id); setConversation(null); setView('workspace'); setMobileMenu(false); setError('');
    try { await loadThread(id); } catch (err) { setError((err as Error).message); }
  }
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await reload(); if (threadRef.current) await loadThread(threadRef.current); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || busy || activeRun || !profile) return;
    const text = draft;
    await act(async () => {
      let id = threadId;
      if (!id) {
        const thread = await post<Thread>('/threads', { profile: profile.id });
        id = thread.id; threadRef.current = id; setThreadId(id);
      }
      await post('/threads/' + id + '/messages', { text });
      setDraft('');
    });
  }
  const suggest = (id: string, text: string) => { setProfileId(id); setDraft(text); textarea.current?.focus(); };
  const runTask = async (task: Task) => act(async () => {
    const result = await post<{ thread: Thread }>('/tasks/' + task.id + '/run');
    await openThread(result.thread.id);
  });
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000); }
    catch { setError('Your browser could not access the clipboard. Select and copy the text manually.'); }
  };
  const taskColumns = [{ id: 'todo', label: 'To do', icon: Circle }, { id: 'running', label: 'In progress', icon: LoaderCircle }, { id: 'done', label: 'Done', icon: CircleCheck }];
  const filteredRuns = data?.runs.filter(r => activityFilter === 'all' || (activityFilter === 'running' ? running(r.status) : r.status === activityFilter)) || [];

  const composer = <form className={'composer ' + (activeRun ? 'working' : '')} onSubmit={send}>
    <textarea ref={textarea} value={draft} onChange={event => setDraft(event.target.value)} aria-label="Message your agent"
      placeholder={profile ? 'Give ' + profile.name + ' a little direction…' : 'Select a Hermes agent to get started…'} rows={2}
      disabled={busy || !!activeRun || !profile}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
    <div className="composer-toolbar"><div className="composer-options">
      {!threadId && <AgentPicker profiles={data?.profiles || []} value={profileId} onChange={setProfileId} disabled={busy} />}
      {threadId && <span className="composer-agent"><Avatar profile={profile} size="small" />{profile?.name}</span>}
      <button type="button" className="composer-tool" onClick={() => setDetail(profile || null)} disabled={!profile}><Settings2 size={14} /><span>Agent details</span></button>
    </div>{activeRun ? <button type="button" className="send-button stop" aria-label="Stop agent" onClick={() => void act(() => post('/runs/' + activeRun.id + '/cancel'))}><Square size={14} fill="currentColor" /></button>
      : <button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || busy || !profile}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={20} />}</button>}</div>
  </form>;

  return <div className={'app-shell ' + (mobileMenu ? 'menu-open' : '')}>
    {mobileMenu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <aside className="sidebar">
      <button className="brand" onClick={() => startNew()} aria-label="AgentOS home"><Mark /><span>agent<span className="brand-os">os</span><span className="beta">BETA</span></span></button>
      <button className="new-chat" onClick={() => startNew()} aria-label="New conversation"><Plus size={17} /><span>New conversation</span><span className="shortcut" aria-hidden="true">↗</span></button>
      <div className="sidebar-scroll">
      <button className="sidebar-search" onClick={() => setSearchOpen(true)}><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={'nav-item ' + (view === item.id ? 'active' : '')} onClick={() => navigate(item.id)}><item.icon size={17} /><span>{item.label}</span>{item.id === 'agents' && <span className="nav-count">{data?.profiles.length || 0}</span>}{item.id === 'tasks' && !!data?.tasks.filter(t => t.status !== 'done').length && <span className="nav-count">{data.tasks.filter(t => t.status !== 'done').length}</span>}{item.id === 'activity' && !!data?.runtime.active && <span className="activity-dot" />}</button>)}</nav>
      <div className="sidebar-section-label"><span>YOUR TEAM</span><button className="icon-button" aria-label="View all agents" onClick={() => navigate('agents')}><MoreHorizontal size={16} /></button></div>
      <div className="sidebar-agents">{data?.profiles.filter(p => p.id !== 'default').map(p => <button key={p.id} className="sidebar-agent" onClick={() => startNew(p.id)}><Avatar profile={p} size="small" /><span>{p.name}</span><span className={'agent-presence ' + (data.runs.some(r => r.profile === p.id && running(r.status)) ? 'is-working' : '')} /></button>)}</div>
      <div className="sidebar-section-label history-label"><span>RECENT CONVERSATIONS</span><span>{data?.threads.length || 0}</span></div>
      <div className="history-list">{data?.threads.slice(0, 12).map(thread => <button key={thread.id} className={'history-item ' + (threadId === thread.id && view === 'workspace' ? 'selected' : '')} onClick={() => void openThread(thread.id)}><MessageSquare size={13} /><span>{thread.title}</span></button>)}
        {!data?.threads.length && <p className="history-empty">A fresh start.<br />Your conversations will live here.</p>}</div>
      </div>
      <div className="sidebar-bottom"><div className="runtime-card"><span className={'connection-dot ' + (connected ? 'online' : '')} /><div><strong>{connected ? 'Hermes connected' : data ? 'Reconnecting…' : 'Connecting…'}</strong><span>{data ? data.runtime.active + ' working · ' + data.profiles.length + ' profiles' : 'Your own agent runtime'}</span></div><ShieldCheck size={16} /></div>
        <button className={'nav-item settings-nav ' + (view === 'settings' ? 'active' : '')} onClick={() => navigate('settings')}><Settings2 size={17} /><span>Settings</span><ChevronRight size={14} /></button>
        <div className="owner"><span className="owner-avatar">A</span><div><strong>Personal workspace</strong><span>Local · yours to control</span></div><button className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? 'Use light theme' : 'Use dark theme'}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button></div>
      </div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-toggle" aria-label="Open navigation" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={19} /></button><span className="workspace-label"><FolderOpen size={15} />Personal workspace</span><ChevronRight size={13} /><strong>{view === 'workspace' ? conversation?.title || 'New conversation' : navigation.find(n => n.id === view)?.label || 'Settings'}</strong></div>
        <div className="topbar-actions"><span className="local-pill"><span />Local runtime</span>{view === 'workspace' && threadId && <button className={'icon-button ' + (showActivity ? 'is-active' : '')} aria-label="Toggle conversation activity" onClick={() => setShowActivity(!showActivity)}><PanelRight size={18} /></button>}<button className="icon-button theme-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
      {!data ? <div className="loading-screen"><Mark /><LoaderCircle className="spin" size={20} /><p>Gathering your agents…</p>{error && <button className="button" onClick={() => void reload().catch(err => setError(err.message))}>Try again</button>}</div> : <>
      {view === 'workspace' && !threadId && <div className="welcome-view">
        <div className="welcome-content"><div className="welcome-hero"><div className="welcome-copy"><div className="welcome-eyebrow"><span className="tiny-star">✳</span> A LITTLE DIRECTION. A LOT OF POSSIBILITY.</div>
          <h1>Big ideas.<br /><span>Meet your team.</span></h1><p className="welcome-description">Your Hermes agents, together in one place.<br />Think it. Delegate it. Make it happen.</p>
          <div className="workspace-signal"><span className={'connection-dot ' + (connected ? 'online' : '')} />{connected ? 'Connected to Hermes' : 'Reconnecting to Hermes'}<span className="signal-divider" />{data.runtime.active} working</div></div>
          <div className="presence-display"><AgentPresence /><div className="presence-caption" aria-live="polite"><span>{profile?.name || 'Your workspace'}</span><small>{profile ? roleFor(profile.id) + ' · ' + profile.skills + ' skills' : 'Select an agent to begin'}</small></div></div></div>
          <div className="team-heading"><span>YOUR TEAM</span><span>Choose who to work with</span></div>
          <div className="team-row">{data.profiles.map(p => <button key={p.id} aria-pressed={profileId === p.id} className={'team-member ' + (profileId === p.id ? 'chosen' : '')} onClick={() => setProfileId(p.id)}><Avatar profile={p} size="large" /><span>{p.name}</span><small>{roleFor(p.id)}</small></button>)}</div>
          {composer}<div className="composer-note"><ShieldCheck size={12} />Your agents. Your tools. Your existing Hermes setup.<span>↵ to send</span></div>
          <div className="suggestion-grid">{[
            { id: 'sigma', icon: Terminal, title: 'Build something', text: 'Turn an idea into working code', prompt: 'Help me turn an idea into a working project. First, ask me about the goal and requirements.' },
            { id: 'scout', icon: Search, title: 'Find the signal', text: 'Research a market or competitor', prompt: 'Help me research a market or competitor. Ask me what to investigate and what decisions the research should support.' },
            { id: 'fiddle', icon: Sparkles, title: 'Make it beautiful', text: 'Design a product that feels right', prompt: 'Help me design a product experience. First, ask me about the users, primary workflow, and design references.' },
            { id: 'ledger', icon: LayoutGrid, title: 'Work the numbers', text: 'Explore pricing and business models', prompt: 'Help me evaluate a pricing or business model. Ask me about the product, customers, and costs before making recommendations.' },
          ].filter(s => data.profiles.some(p => p.id === s.id)).map(s => <button key={s.id} className="suggestion-card" onClick={() => suggest(s.id, s.prompt)}><s.icon size={17} /><strong>{s.title}</strong><span>{s.text}</span><ArrowUp size={14} /></button>)}</div>
        </div><footer className="welcome-footer"><span><span className="connection-dot online" />{data.profiles.length} agents available</span><span>{data.stats.skills.toLocaleString()} skills across your team</span><span><Command size={12} /> K to find anything</span></footer>
      </div>}
      {view === 'workspace' && threadId && <div className={'conversation-layout ' + (showActivity ? 'with-activity' : '')}><section className="conversation-pane">
        <div className="conversation-heading"><Avatar profile={profile} /><div><strong>{profile?.name}</strong><span>{roleFor(profile?.id || '')} <span>·</span> {shortModel(profile?.model || '')}</span></div><button className="text-button" onClick={() => setDetail(profile || null)}>View agent<ChevronRight size={13} /></button></div>
        <div className="messages">{!conversation ? <div className="inline-loading"><LoaderCircle className="spin" size={20} />Opening conversation…</div> : conversation.messages.map(message => <article key={message.id} className={'message ' + message.role}><div className="message-avatar">{message.role === 'user' ? <span className="user-avatar">You</span> : <Avatar profile={profile} size="small" />}</div><div className="message-body"><div className="message-author">{message.role === 'user' ? 'You' : profile?.name}<span>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
          {message.content ? <div className="markdown"><Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown></div> : <div className="thinking"><span /><span /><span /><span>{activeRun?.status === 'waiting' ? 'Waiting for your approval' : activeRun ? 'Getting to work' : 'No response returned'}</span></div>}
          {!!message.content && message.role === 'assistant' && <button className="copy-button" aria-label="Copy response" onClick={() => void copy(message.id, message.content)}>{copied === message.id ? <Check size={13} /> : <Copy size={13} />}{copied === message.id ? 'Copied' : 'Copy'}</button>}
        </div></article>)}
          {conversation?.runs[0]?.error && <div className="run-error"><Circle size={14} />{conversation.runs[0].error}</div>}
          {data.approvals.filter(a => a.threadId === threadId).map(approval => <div className="approval-card" key={approval.id}><div><ShieldCheck size={19} /><strong>Your approval is needed</strong></div><p>{approval.toolCall.title || 'The agent wants to use a tool.'}</p>{approval.toolCall.rawInput != null && <pre>{JSON.stringify(approval.toolCall.rawInput, null, 2)}</pre>}<div className="approval-options">{approval.options.map(option => <button disabled={busy} className={'button ' + (option.kind.startsWith('allow') ? 'primary' : '')} key={option.optionId} onClick={() => void act(() => post('/approvals/' + approval.id, { optionId: option.optionId }))}>{option.name}</button>)}</div></div>)}
          <div ref={bottom} /></div>
        <div className="conversation-composer">{activeRun && <div className="working-label"><LoaderCircle size={13} className="spin" /><span>{activeRun.status === 'waiting' ? 'Needs your approval' : profile?.name + ' is working'}</span><button className="text-button" onClick={() => setShowActivity(true)}>Follow activity<ArrowRight size={12} /></button></div>}{composer}<div className="composer-note">Hermes can use its configured tools and memory.<span>Shift + ↵ for a new line</span></div></div>
      </section>{showActivity && <aside className="activity-panel"><div className="activity-panel-title"><h3>Behind the scenes</h3><button className="icon-button" aria-label="Close activity" onClick={() => setShowActivity(false)}><X size={15} /></button></div><p>Every step, as it happens.</p>{activity.length ? <div className="event-list">{activity.map(event => <EventItem key={event.id} event={event} />)}</div> : <Empty icon={<AudioLines size={22} />} title="Ready when you are" text="Tools and agent activity will appear here." />}</aside>}</div>}
      {view === 'agents' && <section className="page-content"><div className="page-heading"><div className="eyebrow">THE PEOPLE BEHIND THE PIXELS</div><h1>A team of possibilities.</h1><p>Different strengths. Shared purpose. Your existing Hermes profiles.</p><button className="button heading-button" disabled={busy} onClick={() => void act(() => post('/profiles/refresh'))}><RefreshCw size={14} />Refresh profiles</button></div>
        <div className="agent-grid">{data.profiles.map(p => <article className="agent-card" key={p.id}><div className="agent-card-top"><Avatar profile={p} size="large" /><span className="agent-role">{roleFor(p.id)}</span><button className="icon-button" aria-label={'View ' + p.name + ' details'} onClick={() => setDetail(p)}><MoreHorizontal size={18} /></button></div><h2>{p.name}</h2><p className="agent-description">{p.description}</p><div className="agent-capabilities"><span><Cpu size={12} />{shortModel(p.model)}</span><span><Sparkles size={12} />{p.skills} skills</span></div><div className="agent-card-bottom"><span><span className="connection-dot online" />Configured</span><button onClick={() => startNew(p.id)}>Start a conversation<ArrowRight size={14} /></button></div></article>)}</div>
        <div className="info-strip"><ShieldCheck size={17} /><p>AgentOS uses your Hermes profiles directly. Manage models, credentials, and skills in Hermes.</p></div>
      </section>}
      {view === 'tasks' && <section className="page-content"><div className="page-heading"><div className="eyebrow">FROM THOUGHT TO DONE</div><h1>Make room for progress.</h1><p>Give an agent a clear brief. Follow the work from start to finish.</p><button className="button primary heading-button" onClick={() => setTaskModal('new')}><Plus size={15} />New task</button></div>
        <div className="section-toolbar"><span>{data.tasks.length} {data.tasks.length === 1 ? 'task' : 'tasks'}</span><label className="filter-select"><Users size={14} /><select value={taskFilter} onChange={event => setTaskFilter(event.target.value)} aria-label="Filter tasks by agent"><option value="all">All agents</option>{data.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
        <div className="kanban">{taskColumns.map(column => { const cards = data.tasks.filter(t => t.status === column.id && (taskFilter === 'all' || t.profile === taskFilter)); return <div key={column.id} className={'kanban-column ' + column.id}><div className="kanban-heading"><column.icon size={14} /><h3>{column.label}</h3><span>{cards.length}</span>{column.id === 'todo' && <button className="icon-button" aria-label="Add task" onClick={() => setTaskModal('new')}><Plus size={15} /></button>}</div>
          {cards.map(task => <article key={task.id} className="task-card"><button className="task-title" onClick={() => setTaskModal(task)}>{task.title}</button>{task.description && <p>{task.description}</p>}<div className="task-meta"><Avatar profile={data.profiles.find(p => p.id === task.profile)} size="small" /><span>{data.profiles.find(p => p.id === task.profile)?.name}</span><small>{relativeTime(task.created_at)}</small></div><div className="task-actions">{task.status === 'running' || task.status === 'done' ? <button className="text-button" disabled={!task.thread_id} onClick={() => task.thread_id && void openThread(task.thread_id)}>View conversation<ArrowRight size={13} /></button> : <button className="text-button" disabled={busy} onClick={() => void runTask(task)}><Zap size={13} />Run with agent</button>}<Status status={task.status} /></div></article>)}
          {!cards.length && <div className="column-empty">{column.id === 'todo' ? 'An idea is a good place to start.' : column.id === 'running' ? 'A little quiet before the next big thing.' : 'Good work will find its way here.'}</div>}</div>; })}</div>
      </section>}
      {view === 'activity' && <section className="page-content"><div className="page-heading"><div className="eyebrow">A WINDOW INTO THE WORK</div><h1>Nothing behind the curtain.</h1><p>See what ran, what finished, and what needs your attention.</p></div><div className="stats-row">{[{ label: 'Working now', value: data.runtime.active, icon: AudioLines }, { label: 'Completed runs', value: data.stats.completed, icon: CheckCheck }, { label: 'Available agents', value: data.profiles.length, icon: Users }, { label: 'Hermes sessions', value: data.stats.sessions, icon: MessageSquare }].map(item => <div key={item.label} className="stat-card"><item.icon size={16} /><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>
        <div className="section-toolbar"><h2>Run history</h2><label className="filter-select"><select aria-label="Filter activity" value={activityFilter} onChange={event => setActivityFilter(event.target.value)}><option value="all">All runs</option><option value="running">Working</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label></div>
        {filteredRuns.length ? <div className="run-table">{filteredRuns.map(run => <button key={run.id} className="run-row" onClick={() => void openThread(run.thread_id)}><Avatar profile={data.profiles.find(p => p.id === run.profile)} /><div><strong>{data.threads.find(t => t.id === run.thread_id)?.title || 'Conversation'}</strong><span>{data.profiles.find(p => p.id === run.profile)?.name} · {relativeTime(run.started_at)}</span></div><Status status={run.status} /><span className="run-duration">{duration(run)}</span><ArrowRight size={15} /></button>)}</div> : <Empty icon={<AudioLines size={28} />} title="Your story is just starting." text="Start a conversation or run a task to see your agents in action."><button className="button" onClick={() => startNew()}>Start a conversation<ArrowRight size={14} /></button></Empty>}
      </section>}
      {view === 'memory' && <section className="page-content"><div className="page-heading"><div className="eyebrow">THE CONTEXT THAT STAYS</div><h1>A little more understood.</h1><p>Explore what your agents remember, and the identity that guides them.</p></div><div className="memory-layout"><aside className="memory-nav"><label className="field-label">Agent<select value={profileId} onChange={event => setProfileId(event.target.value)}>{data.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="memory-file-list">{memory.map(file => <button key={file.name} onClick={() => setMemoryFile(file.name)} className={memoryFile === file.name ? 'selected' : ''}><BookOpen size={15} />{file.name}<ChevronRight size={13} /></button>)}</div><p><ShieldCheck size={13} />Read from Hermes.<br />Updates stay with your agent.</p></aside><article className="memory-document">{memoryLoading ? <div className="inline-loading"><LoaderCircle className="spin" size={18} />Reading agent memory…</div> : memory.length ? <><div className="memory-document-header"><BookOpen size={16} /><strong>{memoryFile}</strong><span>Read only</span></div><div className="markdown"><Markdown remarkPlugins={[remarkGfm]}>{memory.find(f => f.name === memoryFile)?.content || 'This file is empty.'}</Markdown></div>{memory.find(f => f.name === memoryFile)?.truncated && <p className="muted">Showing the first 120,000 characters.</p>}</> : <Empty icon={<BookOpen size={25} />} title="Room to remember." text="This agent has no memory files yet. Hermes will maintain them as you work together." />}</article></div></section>}
      {view === 'settings' && <section className="page-content settings-content"><div className="page-heading"><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your workspace. Your way.</h1><p>A clear view of the setup powering your agents.</p></div><div className="settings-section"><h2>Appearance</h2><p>A comfortable place to think.</p><div className="theme-options"><button className={!dark ? 'selected' : ''} onClick={() => setDark(false)}><Sun size={20} />Light<Check size={14} /></button><button className={dark ? 'selected' : ''} onClick={() => setDark(true)}><Moon size={20} />Dark<Check size={14} /></button></div></div><div className="settings-section"><h2>Hermes connection</h2><p>AgentOS runs alongside your existing agents on this machine.</p><dl className="settings-list"><div><dt>Runtime</dt><dd>{data.runtime.name}<span className="status completed"><Check size={12} />Installed</span></dd></div><div><dt>Agent profiles</dt><dd>{data.profiles.length} discovered</dd></div><div><dt>Concurrent runs</dt><dd>Up to {data.runtime.concurrency}</dd></div><div><dt>Workspace</dt><dd className="mono">{data.runtime.workspace}</dd></div><div><dt>Hermes home</dt><dd className="mono">{data.runtime.root}</dd></div></dl></div><div className="settings-section"><h2>Tools & connections</h2><p>Configured MCP servers, grouped by agent. Credentials stay in Hermes.</p><div className="connection-list">{data.profiles.filter(p => p.connections.length).map(p => <div key={p.id}><Avatar profile={p} size="small" /><strong>{p.name}</strong><div>{p.connections.map(c => <span className={'connection-chip ' + (c.enabled ? '' : 'disabled')} key={c.name}>{c.name}<small>{c.enabled ? 'Configured' : 'Disabled'}</small></span>)}</div></div>)}{!data.profiles.some(p => p.connections.length) && <p className="muted">No MCP servers configured in your Hermes profiles.</p>}</div><a className="text-button docs-link" href="https://hermes-agent.nousresearch.com/docs/" target="_blank" rel="noreferrer">Manage your setup in Hermes<ExternalLink size={13} /></a></div><div className="settings-footer"><Mark small /><span>AgentOS 0.1.0</span><span>Built for your own agents.</span></div></section>}
      </>}
    </main>
    {searchOpen && <Modal title="Find your next thought" onClose={() => { setSearchOpen(false); setSearch(''); }}><div className="search-dialog"><div className="search-input"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search agents and conversations…" aria-label="Search agents and conversations" autoFocus /></div><div className="search-results"><div className="eyebrow">AGENTS</div>{data?.profiles.filter(p => (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase())).map(p => <button key={p.id} onClick={() => { setSearchOpen(false); setSearch(''); startNew(p.id); }}><Avatar profile={p} size="small" /><span>{p.name}<small>{roleFor(p.id)}</small></span><ArrowRight size={15} /></button>)}<div className="eyebrow">CONVERSATIONS</div>{data?.threads.filter(t => t.title.toLowerCase().includes(search.toLowerCase())).map(t => <button key={t.id} onClick={() => { setSearchOpen(false); setSearch(''); void openThread(t.id); }}><MessageSquare size={16} /><span>{t.title}</span><ArrowRight size={15} /></button>)}{!data?.threads.filter(t => t.title.toLowerCase().includes(search.toLowerCase())).length && <p className="muted">No matching conversations yet.</p>}</div></div></Modal>}
    {detail && <Modal title={detail.name} onClose={() => setDetail(null)}><div className="agent-detail"><Avatar profile={detail} size="large" /><span className="agent-role">{roleFor(detail.id)}</span><p>{detail.description}</p><dl><div><dt>Model</dt><dd>{detail.model}</dd></div><div><dt>Provider</dt><dd>{detail.provider}</dd></div><div><dt>Skills</dt><dd>{detail.skills}</dd></div><div><dt>Existing sessions</dt><dd>{detail.sessions}</dd></div></dl><h3>MCP connections</h3><div className="agent-capabilities">{detail.connections.length ? detail.connections.map(c => <span key={c.name}>{c.name} · {c.enabled ? 'Configured' : 'Disabled'}</span>) : <p className="muted">No configured MCP connections.</p>}</div><button className="button primary full-width" onClick={() => { startNew(detail.id); setDetail(null); }}>Talk to {detail.name}<ArrowRight size={15} /></button></div></Modal>}
    {taskModal && data && <TaskDialog task={taskModal} profiles={data.profiles} defaultProfile={profileId} onClose={() => setTaskModal(null)} onSave={async values => { await act(async () => { if (taskModal === 'new') await post('/tasks', values); else await api('/tasks/' + taskModal.id, { method: 'PATCH', body: JSON.stringify(values) }); setTaskModal(null); }); }} onDelete={taskModal === 'new' ? undefined : () => void act(async () => { await api('/tasks/' + taskModal.id, { method: 'DELETE' }); setTaskModal(null); })} busy={busy} />}
  </div>;
}

function duration(run: Run) {
  const seconds = Math.max(0, Math.floor(((run.ended_at ? new Date(run.ended_at).getTime() : Date.now()) - new Date(run.started_at).getTime()) / 1000));
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's';
}
function EventItem({ event }: { event: ActivityEvent }) {
  const payload = event.payload;
  const kind = event.type;
  const title = kind === 'tool' ? String(payload.title || payload.toolCallId || 'Tool activity') : kind === 'approval' ? 'Approval requested' : kind === 'plan' ? 'Plan updated' : kind === 'run_started' ? 'Agent started' : 'Run ' + String(payload.status || 'finished');
  return <div className={'event-item ' + kind}><span className="event-dot">{kind === 'tool' ? <Terminal size={12} /> : kind === 'approval' ? <ShieldCheck size={12} /> : kind === 'run_finished' ? <Check size={12} /> : <Zap size={12} />}</span><div><strong>{title}</strong><small>{new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}{payload.status != null ? ' · ' + String(payload.status) : ''}</small>{kind === 'tool' && (payload.rawInput != null || payload.content != null) && <details><summary>View details<ChevronDown size={11} /></summary><pre>{JSON.stringify(payload.rawInput || payload.content, null, 2)}</pre></details>}{kind === 'plan' && Array.isArray(payload.entries) && <ul>{payload.entries.map((entry: { content: string; status: string }, index: number) => <li key={index}>{entry.status === 'completed' ? '✓' : '○'} {entry.content}</li>)}</ul>}</div></div>;
}
function TaskDialog({ task, profiles, defaultProfile, onClose, onSave, onDelete, busy }: {
  task: Task | 'new'; profiles: Profile[]; defaultProfile: string; onClose: () => void;
  onSave: (values: { title: string; description: string; profile: string; status?: string }) => Promise<void>;
  onDelete?: () => void; busy: boolean;
}) {
  const [title, setTitle] = useState(task === 'new' ? '' : task.title);
  const [description, setDescription] = useState(task === 'new' ? '' : task.description);
  const [profile, setProfile] = useState(task === 'new' ? defaultProfile : task.profile);
  const disabled = busy || (task !== 'new' && task.status === 'running');
  return <Modal title={task === 'new' ? 'A new possibility' : 'Task details'} onClose={onClose}><form className="task-form" onSubmit={event => { event.preventDefault(); void onSave({ title, description, profile }); }}><label className="field-label">What needs to happen?<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={120} placeholder="Give this task a clear title" disabled={disabled} /></label><label className="field-label">The brief<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Goals, context, and what a good result looks like…" rows={5} maxLength={12000} disabled={disabled} /></label><label className="field-label">Who's best for this?<select value={profile} onChange={event => setProfile(event.target.value)} disabled={disabled} required>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {roleFor(p.id)}</option>)}</select></label>{task !== 'new' && task.status === 'running' && <p className="muted">This task is running. Stop its run before editing.</p>}<div className="modal-footer">{onDelete && <button type="button" className="icon-button danger" aria-label="Delete task" onClick={onDelete} disabled={disabled}><Trash2 size={17} /></button>}{task !== 'new' && !disabled && <button type="button" className="button" onClick={() => void onSave({ title, description, profile, status: task.status === 'done' ? 'todo' : 'done' })}>{task.status === 'done' ? 'Reopen task' : 'Mark complete'}</button>}<button type="submit" className="button primary" disabled={disabled || !title.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{task === 'new' ? 'Create task' : 'Save changes'}</button></div></form></Modal>;
}
