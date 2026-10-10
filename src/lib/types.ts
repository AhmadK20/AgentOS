export type View = 'workspace' | 'agents' | 'tasks' | 'activity' | 'memory' | 'settings';
export interface Profile {
  id: string; name: string; description: string; color: string; model: string;
  provider: string; skills: number; sessions: number; active: boolean;
  connections: { name: string; enabled: boolean }[];
}
export interface Thread { id: string; profile: string; title: string; created_at: string; updated_at: string; session_id: string | null }
export interface Message { id: string; role: string; content: string; created_at: string }
export interface Run {
  id: string; thread_id: string; profile: string; status: string;
  started_at: string; ended_at: string | null; error: string | null;
}
export interface Task {
  id: string; title: string; description: string; profile: string;
  status: string; thread_id: string | null; created_at: string;
}
export interface ActivityEvent {
  id: number; type: string; run_id: string; thread_id: string; created_at: string;
  payload: Record<string, unknown>;
}
export interface Approval {
  id: string; threadId: string; runId: string;
  toolCall: { title?: string; rawInput?: unknown; content?: unknown };
  options: { optionId: string; name: string; kind: string }[];
}
export interface Bootstrap {
  profiles: Profile[]; threads: Thread[]; tasks: Task[]; runs: Run[]; approvals: Approval[];
  runtime: { name: string; workspace: string; root: string; concurrency: number; active: number };
  stats: { profiles: number; skills: number; sessions: number; completed: number };
}
export interface Conversation extends Thread { messages: Message[]; events: ActivityEvent[]; runs: Run[] }
export interface MemoryFile { name: string; content: string; truncated: boolean }
