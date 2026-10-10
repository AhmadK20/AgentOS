import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import YAML from 'yaml';

export const hermesRoot = resolve(process.env.HERMES_ROOT || join(homedir(), '.hermes'));
const colors = ['#ed7040', '#d86ca5', '#55a89d', '#6c8fbc', '#b59b5f', '#a892bf'];
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

async function config(path) {
  try { return YAML.parse(await readFile(path, 'utf8')) || {}; } catch { return {}; }
}
async function skillCount(path) {
  try { return (await readdir(path, { recursive: true })).filter(name => name.endsWith('SKILL.md')).length; }
  catch { return 0; }
}
function sessionCount(path) {
  let db;
  try {
    db = new DatabaseSync(join(path, 'state.db'), { readOnly: true });
    return Number(db.prepare('SELECT count(*) AS count FROM sessions').get().count);
  } catch { return 0; } finally { db?.close(); }
}

export async function discoverProfiles(root = hermesRoot) {
  let children = [];
  try { children = await readdir(join(root, 'profiles'), { withFileTypes: true }); } catch { /* fresh installation */ }
  const candidates = [{ id: 'default', path: root }, ...children
    .filter(item => item.isDirectory() && safeId.test(item.name) && item.name !== 'default')
    .map(item => ({ id: item.name, path: join(root, 'profiles', item.name) }))];
  let active = 'default';
  try { active = (await readFile(join(root, 'active_profile'), 'utf8')).trim(); } catch { /* no sticky profile */ }
  const profiles = [];
  for (const [index, item] of candidates.entries()) {
    try { await stat(join(item.path, 'config.yaml')); } catch { continue; }
    const [settings, metadata, count] = await Promise.all([
      config(join(item.path, 'config.yaml')), config(join(item.path, 'profile.yaml')), skillCount(join(item.path, 'skills')),
    ]);
    const ui = metadata.ui_meta?.['hermes-bots'] || {};
    const rawModel = settings.model;
    const model = typeof rawModel === 'string' ? rawModel : rawModel?.default || rawModel?.model || 'Hermes default';
    const servers = Object.entries(settings.mcp_servers || {}).map(([name, value]) => ({
      name, enabled: value?.enabled !== false,
    }));
    profiles.push({
      id: item.id, name: String(ui.title || (item.id === 'default' ? 'Hermes' : item.id.replace(/(^|-)([a-z])/g, (_, dash, c) => `${dash ? ' ' : ''}${c.toUpperCase()}`))),
      description: String(metadata.description || 'Your personal Hermes agent, with its existing tools and memory.'),
      model: String(model), provider: String(rawModel?.provider || 'Configured in Hermes'),
      color: colors[index % colors.length], skills: count, sessions: sessionCount(item.path),
      active: active === item.id, connections: servers,
    });
  }
  return profiles;
}

export async function profileDirectory(id, root = hermesRoot) {
  if (id !== 'default' && !safeId.test(id)) throw new Error('Invalid Hermes profile');
  const base = await realpath(root);
  const directory = await realpath(id === 'default' ? root : join(root, 'profiles', id));
  const rel = relative(base, directory);
  if (rel.startsWith('..') || resolve(base, rel) !== directory) throw new Error('Profile is outside Hermes home');
  await stat(join(directory, 'config.yaml'));
  return directory;
}

export async function readMemory(id, root = hermesRoot) {
  const dir = await profileDirectory(id, root);
  const files = [];
  for (const name of ['MEMORY.md', 'USER.md', 'SOUL.md']) {
    const path = name === 'SOUL.md' ? join(dir, name) : join(dir, 'memories', name);
    try {
      const actual = await realpath(path);
      const rel = relative(dir, actual);
      if (rel.startsWith('..')) continue;
      const contents = await readFile(actual, 'utf8');
      files.push({ name, content: contents.slice(0, 120000), truncated: contents.length > 120000 });
    } catch { /* optional memory file */ }
  }
  return files;
}
