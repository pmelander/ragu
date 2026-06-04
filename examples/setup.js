#!/usr/bin/env bun

/**
 * Raggy setup helper: Bun, .env, data dirs, optional TypeScript build.
 * Embeddings run via Xenova in Raggy (.env); no Ollama required for the server.
 */

const { execSync } = require('child_process');
const fs = require('fs');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkCommand(command, description) {
  try {
    execSync(command, { stdio: 'pipe' });
    log(colors.green, `✅ ${description}`);
    return true;
  } catch {
    log(colors.red, `❌ ${description}`);
    return false;
  }
}

function runCommand(command, description) {
  log(colors.blue, `🔄 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    log(colors.green, `✅ ${description} completed`);
    return true;
  } catch (error) {
    log(colors.red, `❌ ${description} failed: ${error.message}`);
    return false;
  }
}

async function main() {
  log(colors.cyan, '🚀 Raggy setup');
  log(colors.cyan, '='.repeat(50));

  log(colors.yellow, '\n📋 Prerequisites...');
  const bunOk = checkCommand('bun --version', 'Bun 1.1+');
  if (!bunOk) {
    log(colors.red, 'Install Bun from https://bun.sh');
    process.exit(1);
  }

  log(colors.yellow, '\n📦 Dependencies...');
  if (!runCommand('bun install', 'bun install')) {
    process.exit(1);
  }

  log(colors.yellow, '\n⚙️ Environment...');
  if (!fs.existsSync('.env')) {
    fs.copyFileSync('.env.example', '.env');
    log(colors.green, '✅ Created .env from .env.example (edit EMBEDDING_MODEL if needed)');
  } else {
    log(colors.blue, 'ℹ️ .env already exists');
  }

  const dirs = ['data/documents', 'data/lancedb', 'data/lexical', 'data/cache', 'logs'];
  log(colors.yellow, '\n📁 Data directories...');
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(colors.green, `✅ ${dir}`);
    }
  });

  log(colors.yellow, '\n🔨 TypeScript build...');
  if (!runCommand('bun run build', 'tsc')) {
    process.exit(1);
  }

  log(colors.blue, '\nℹ️ Raggy uses local embeddings (Xenova) per .env — not Ollama.');
  log(colors.blue, '   Use Ollama or another LLM only where you compose answers (e.g. OpenCode chat).');

  log(colors.yellow, '\n🧪 Quick server check...');
  try {
    execSync('timeout 12s bun run dev', { stdio: 'pipe' });
    log(colors.green, '✅ Dev server starts');
  } catch {
    log(colors.yellow, '⚠️ Server check inconclusive (timeout is normal)');
  }

  log(colors.green, '\n🎉 Done.');
  log(colors.cyan, '\nNext:');
  log(colors.reset, '  bun run dev');
  log(colors.reset, '  node examples/upload-pdf.js ./doc.pdf mycollection');
  log(colors.reset, '  node examples/query.js "Your question?" mycollection');
  log(colors.reset, '  OpenCode: ./scripts/setup-opencode.sh → see README.md');
}

main().catch((error) => {
  log(colors.red, `❌ Setup failed: ${error.message}`);
  process.exit(1);
});
