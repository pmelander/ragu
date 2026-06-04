#!/usr/bin/env node

/**
 * Example: Query Raggy (retrieval only — returns context + sources for your LLM).
 *
 * Usage:
 *   node examples/query.js "Your question?" [collection-name]
 *   node examples/query.js --interactive [collection]
 */

const axios = require('axios');
const readline = require('readline');

const RAGGY_URL = process.env.RAGGY_URL || 'http://localhost:3001';

async function queryDocuments(question, collection = 'default') {
  console.log(`🤔 Question: "${question}"`);
  console.log(`📚 Collection: ${collection}`);
  console.log('⏳ Retrieving chunks...\n');

  try {
    const response = await axios.post(
      `${RAGGY_URL}/api/query`,
      {
        question,
        collection,
        limit: 5
      },
      {
        timeout: 120000
      }
    );

    const body = response.data;
    if (!body.success || !body.data) {
      console.error('❌ Query failed:', body.error || 'Unknown error');
      process.exit(1);
    }

    const { context, sources, processingTime } = body.data;

    console.log('📎 Context (feed this to an LLM or read directly):');
    console.log('─'.repeat(50));
    console.log(context);
    console.log('─'.repeat(50));

    if (sources && sources.length > 0) {
      console.log(`\n📄 Sources (${sources.length}):`);
      sources.forEach((source, i) => {
        const page = source.metadata?.page ?? '?';
        const scorePct = (source.score * 100).toFixed(1);
        const preview = (source.content || '').substring(0, 120).replace(/\s+/g, ' ');
        console.log(`${i + 1}. ${source.metadata?.source || 'unknown'} · page ${page} · score ${scorePct}%`);
        console.log(`   "${preview}..."`);
      });
    }

    console.log(`\n⚡ Processing time: ${processingTime}ms`);
  } catch (error) {
    const msg = error.response?.data?.error || error.message;
    console.error('❌ Query failed:', msg);
    process.exit(1);
  }
}

async function interactiveMode(collection = 'default') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🤖 Raggy retrieval (interactive)');
  console.log(`📚 Collection: ${collection}`);
  console.log('Type questions (or "exit" to quit):\n');

  const askQuestion = () => {
    rl.question('❓ Question: ', async (question) => {
      if (question.toLowerCase() === 'exit') {
        console.log('👋 Goodbye!');
        rl.close();
        return;
      }

      if (question.trim()) {
        await queryDocuments(question.trim(), collection);
      }

      console.log('\n' + '='.repeat(60) + '\n');
      askQuestion();
    });
  };

  askQuestion();
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage:');
  console.log('  node examples/query.js "your question here" [collection]');
  console.log('  node examples/query.js --interactive [collection]');
  console.log('');
  console.log('Raggy returns retrieved context, not a generated answer.');
  process.exit(1);
}

if (args[0] === '--interactive') {
  interactiveMode(args[1] || 'default');
} else {
  queryDocuments(args[0], args[1] || 'default');
}
