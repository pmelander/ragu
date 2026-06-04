#!/usr/bin/env bash
# Register the ragU MCP server with OpenCode and install project-support tooling.
#
# What this script does:
#   1. Writes ~/.config/opencode/ragu-root.txt so the MCP server and plugin
#      can find the ragU repo even when RAGU_PATH is not in the environment.
#   2. Adds (or updates) the "ragu" entry in the OpenCode config file
#      (opencode.jsonc if it exists, otherwise opencode.json).
#   3. Copies the ragU project plugin to
#      ~/.config/opencode/plugins/ragu-project.js
#      (auto-indexes new projects on first OpenCode startup).
#   4. Copies the /ragu-index custom command to
#      ~/.config/opencode/commands/ragu-index.md
#      (manually re-triggers indexing from the TUI).
#
# Run from the repo root:
#   chmod +x scripts/setup-opencode.sh
#   ./scripts/setup-opencode.sh
set -euo pipefail

RAGU_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
MCP_SCRIPT="$RAGU_ROOT/mcp/ragu-mcp.js"
PLUGIN_SRC="$RAGU_ROOT/mcp/ragu-project-plugin.js"
COMMAND_SRC="$RAGU_ROOT/mcp/ragu-index.md"

mkdir -p "$CONFIG_DIR"

# ── 1. ragu-root.txt ─────────────────────────────────────────────────────────
# Lets the MCP server and plugin find the ragU repo when RAGU_PATH is not set.
printf '%s\n' "$RAGU_ROOT" > "$CONFIG_DIR/ragu-root.txt"
echo "Wrote: $CONFIG_DIR/ragu-root.txt"

# ── 2. Patch OpenCode config ─────────────────────────────────────────────────
# Prefer opencode.jsonc if it already exists (OpenCode creates it by default),
# fall back to opencode.json.
if [ -f "$CONFIG_DIR/opencode.jsonc" ]; then
  OPENCODE_CONFIG="$CONFIG_DIR/opencode.jsonc"
else
  OPENCODE_CONFIG="$CONFIG_DIR/opencode.json"
fi

# Write the patcher to a temp file so process.argv indices are consistent
# (node -e shifts argv by 1 compared to node script.js, which caused a bug
# where the patcher overwrote the MCP script with the config JSON).
PATCHER_FILE="$(mktemp /tmp/ragu-patcher.XXXXXX.cjs)"
trap 'rm -f "$PATCHER_FILE"' EXIT

cat > "$PATCHER_FILE" << 'JSEOF'
'use strict';
const fs = require('fs');

const configPath = process.argv[2];
const mcpScript  = process.argv[3];

if (!configPath || !mcpScript) {
  process.stderr.write('Usage: node patcher.cjs <config-path> <mcp-script-path>\n');
  process.exit(1);
}

let cfg = {};
if (fs.existsSync(configPath)) {
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { /* corrupt or empty — start fresh */ }
}

cfg['$schema'] = cfg['$schema'] || 'https://opencode.ai/config.json';
cfg.mcp        = cfg.mcp        || {};
cfg.mcp.ragu   = { type: 'local', command: ['node', mcpScript], enabled: true };

fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
process.stdout.write('ok\n');
JSEOF

RESULT="skip"
if command -v node &>/dev/null; then
  RESULT=$(node "$PATCHER_FILE" "$OPENCODE_CONFIG" "$MCP_SCRIPT")
elif command -v bun &>/dev/null; then
  RESULT=$(bun "$PATCHER_FILE" "$OPENCODE_CONFIG" "$MCP_SCRIPT")
fi

# ── 3. Install project plugin ─────────────────────────────────────────────────
PLUGINS_DIR="$CONFIG_DIR/plugins"
mkdir -p "$PLUGINS_DIR"
cp "$PLUGIN_SRC" "$PLUGINS_DIR/ragu-project.js"
echo "Wrote: $PLUGINS_DIR/ragu-project.js"

# ── 4. Install /ragu-index command ────────────────────────────────────────────
COMMANDS_DIR="$CONFIG_DIR/commands"
mkdir -p "$COMMANDS_DIR"
cp "$COMMAND_SRC" "$COMMANDS_DIR/ragu-index.md"
echo "Wrote: $COMMANDS_DIR/ragu-index.md"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$RESULT" == "ok" ]]; then
  echo "Updated: $OPENCODE_CONFIG"
  echo "  mcp.ragu → node $MCP_SCRIPT"
else
  echo "Could not auto-patch $OPENCODE_CONFIG (node/bun not found on PATH)."
  echo "Add this block to $OPENCODE_CONFIG manually:"
  echo ""
  echo '  {'
  echo '    "$schema": "https://opencode.ai/config.json",'
  echo '    "mcp": {'
  echo '      "ragu": {'
  echo '        "type": "local",'
  echo "        \"command\": [\"node\", \"$MCP_SCRIPT\"],"
  echo '        "enabled": true'
  echo '      }'
  echo '    }'
  echo '  }'
fi

echo ""
echo "Done. Restart OpenCode to activate the ragu MCP server."
echo ""
echo "Project support:"
echo "  • On first startup in any project, OpenCode will create .opencode/ragu.json"
echo "    and auto-index the paths listed there (docs/, README.md, AGENTS.md …)."
echo "  • Edit .opencode/ragu.json to control which paths and collection are used."
echo "  • Run /ragu-index in the TUI at any time to re-trigger indexing."
echo ""
echo "Optional — add to your project AGENTS.md or ~/.config/opencode/AGENTS.md:"
echo ""
echo "  ## RAG knowledge base"
echo "  A local ragU retrieval server is available via MCP tools"
echo "  (rag_query, rag_upload, rag_list, rag_status, rag_delete_collection)."
echo "  Before answering questions about [your domain], call rag_query."
echo "  Use rag_list to discover available collections."
