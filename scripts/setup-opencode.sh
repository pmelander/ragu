#!/usr/bin/env bash
# Register the ragU MCP server with OpenCode.
#
# What this script does:
#   1. Writes ~/.config/opencode/ragu-root.txt so the MCP server can find
#      the ragU repo even when RAGU_PATH is not in the environment.
#   2. Adds (or updates) the "ragu" entry in
#      ~/.config/opencode/opencode.json.
#
# Run from the repo root:
#   chmod +x scripts/setup-opencode.sh
#   ./scripts/setup-opencode.sh
set -euo pipefail

RAGU_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
MCP_SCRIPT="$RAGU_ROOT/mcp/ragu-mcp.js"
OPENCODE_JSON="$CONFIG_DIR/opencode.json"

mkdir -p "$CONFIG_DIR"

# ── 1. ragu-root.txt ─────────────────────────────────────────────────────────
# Lets the MCP server find the ragU repo when RAGU_PATH is not exported.
printf '%s\n' "$RAGU_ROOT" > "$CONFIG_DIR/ragu-root.txt"
echo "Wrote: $CONFIG_DIR/ragu-root.txt"

# ── 2. Patch opencode.json ───────────────────────────────────────────────────
# Use Node (always available alongside OpenCode) to safely merge JSON.
PATCHER="$(cat <<'JSEOF'
const fs   = require('fs');
const path = require('path');

const jsonPath  = process.argv[2];
const mcpScript = process.argv[3];

let cfg = {};
if (fs.existsSync(jsonPath)) {
  try { cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch { /* corrupt — start fresh */ }
}

cfg['$schema'] = cfg['$schema'] || 'https://opencode.ai/config.json';
cfg.mcp = cfg.mcp || {};
cfg.mcp.ragu = {
  type: 'local',
  command: ['node', mcpScript],
  enabled: true
};

fs.writeFileSync(jsonPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log('ok');
JSEOF
)"

if command -v node &>/dev/null; then
  RESULT=$(node -e "$PATCHER" "$OPENCODE_JSON" "$MCP_SCRIPT")
elif command -v bun &>/dev/null; then
  RESULT=$(bun -e "$PATCHER" "$OPENCODE_JSON" "$MCP_SCRIPT")
else
  RESULT="skip"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$RESULT" == "ok" ]]; then
  echo "Updated: $OPENCODE_JSON"
  echo "  mcp.ragu → node $MCP_SCRIPT"
else
  echo "Could not auto-patch $OPENCODE_JSON (node/bun not found on PATH)."
  echo "Add this block to $OPENCODE_JSON manually:"
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
echo "Optional — add to your project AGENTS.md or ~/.config/opencode/AGENTS.md:"
echo ""
echo "  ## RAG knowledge base"
echo "  A local ragU retrieval server is available via MCP tools"
echo "  (rag_query, rag_upload, rag_list, rag_status, rag_delete_collection)."
echo "  Before answering questions about [your domain], call rag_query."
echo "  Use rag_list to discover available collections."
