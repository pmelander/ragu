/**
 * ragU Project Plugin for OpenCode
 *
 * Fires on `server.connected`. For each project:
 *   1. Looks for .opencode/ragu.json in the project root.
 *   2. If absent (first run), creates a default config and auto-indexes
 *      whatever documented paths (docs/, README.md, AGENTS.md …) exist.
 *   3. On subsequent starts the config already exists → nothing happens;
 *      the user runs /ragu-index to re-index manually.
 *
 * Config schema (.opencode/ragu.json):
 *   {
 *     "collection": "my-project",   // ragU collection name (default: folder name)
 *     "paths": ["docs", "README.md"] // relative paths to index (files or dirs)
 *   }
 *
 * Installed by: ./scripts/setup-opencode.sh
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { spawn } from 'child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.RAGU_PORT || '3001', 10);
const BASE_URL    = `http://localhost:${PORT}`;
const CONFIG_DIR  = '.opencode';
const CONFIG_FILE = 'ragu.json';

/** Paths checked (in order) to build the default include list. */
const DEFAULT_CANDIDATE_PATHS = [
  'docs',
  'documentation',
  'doc',
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Absolute path to ~/.config/opencode/ragu-root.txt written by setup-opencode.sh */
function readRaguRoot() {
  try {
    const cfgBase = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const file    = path.join(cfgBase, 'opencode', 'ragu-root.txt');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  } catch {
    return null;
  }
}

async function isRaguUp() {
  try {
    const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForRagu(timeoutMs = 15_000, pollMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRaguUp()) return true;
    await sleep(pollMs);
  }
  return false;
}

function spawnRagu(raguRoot) {
  const opts = {
    cwd: raguRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, RAGU_PATH: raguRoot },
  };
  const child = spawn('bun', ['run', 'dev'], opts);
  child.on('error', () => {
    const npm = spawn('npm', ['run', 'dev'], opts);
    npm.on('error', () => {});
    npm.unref();
  });
  child.unref();
}

async function uploadPath(absPath, collection) {
  const r = await fetch(`${BASE_URL}/api/upload`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ filePath: absPath, collection }),
    signal:  AbortSignal.timeout(120_000),
  });
  return r.json();
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const RaguProjectPlugin = async ({ directory }) => {
  return {
    // Events (server.connected, session.created, etc.) must go through the
    // generic `event` handler — specific event names as direct keys are only
    // valid for hook middleware (tool.execute.before, shell.env, …).
    event: async ({ event }) => {
      if (event.type !== 'session.created') return;

      // Skip non-directory or missing project roots
      if (!directory || !fs.existsSync(directory)) return;

      const configDir  = path.join(directory, CONFIG_DIR);
      const configPath = path.join(configDir, CONFIG_FILE);

      // ── 1. Read or create config ──────────────────────────────────────────
      let isFirstRun = false;
      let config;

      if (!fs.existsSync(configPath)) {
        // Discover which candidate paths actually exist in this project
        const foundPaths = DEFAULT_CANDIDATE_PATHS.filter(p =>
          fs.existsSync(path.join(directory, p))
        );

        config = {
          collection: path.basename(directory),
          paths: foundPaths,   // empty → user should add paths and run /ragu-index
        };

        try {
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
          isFirstRun = true;
        } catch {
          return; // filesystem not writable — skip silently
        }
      } else {
        try {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch {
          return; // corrupt config — skip silently
        }
      }

      // Only auto-index on the very first run (config was just created)
      if (!isFirstRun) return;

      // Nothing to index if paths list is empty
      const paths = Array.isArray(config.paths) ? config.paths : [];
      if (paths.length === 0) return;

      // ── 2. Ensure ragU is running ─────────────────────────────────────────
      if (!(await isRaguUp())) {
        const raguRoot = readRaguRoot();
        if (!raguRoot) return; // ragU not installed — skip

        spawnRagu(raguRoot);

        const up = await waitForRagu(15_000);
        if (!up) return; // ragU didn't start in time — /ragu-index can be used later
      }

      // ── 3. Index configured paths ─────────────────────────────────────────
      const collection = typeof config.collection === 'string' && config.collection.trim()
        ? config.collection.trim()
        : path.basename(directory);

      for (const p of paths) {
        const absPath = path.isAbsolute(p) ? p : path.join(directory, p);
        if (!fs.existsSync(absPath)) continue;
        try {
          await uploadPath(absPath, collection);
        } catch {
          // Non-fatal — move on to remaining paths
        }
      }
    },
  };
};
