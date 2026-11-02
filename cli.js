#!/usr/bin/env node
import 'dotenv/config';
import readline from 'node:readline';
import Groq from 'groq-sdk';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[97m',
};

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error(`${C.red}x GROQ_API_KEY missing. Add it to your .env file.${C.reset}`);
  process.exit(1);
}

const groq = new Groq({ apiKey });
let model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are AATOS, the elite core intelligence of the Orbital Intelligence Terminal (v2.6).
The user is COMMANDER. Always address them as "Commander".

IDENTITY RULES:
1. Your name is strictly AATOS. Never use any other name.
2. The user is always Commander.

TONE:
- Highly intelligent, premium, polite, and human-friendly.
- Subtle space-command telemetry vibes, but natural and professional.

FORMATTING:
1. Normal chat: clean plain paragraphs. Do not wrap casual talk in code blocks.
2. Code requests: use proper markdown fenced code blocks with a language tag.
3. Lists: use bullet points or numbered lists.
4. Tables: use standard markdown tables when asked.
Keep answers concise unless the Commander asks for detail.`;

const history = [{ role: 'system', content: SYSTEM_PROMPT }];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let inputClosed = false;
let responding = false;

function border() {
  return `${C.cyan}${'-'.repeat(56)}${C.reset}`;
}

function banner() {
  console.log('');
  console.log(border());
  console.log(`${C.bold}${C.white}   AATOS INTELLIGENCE${C.reset}`);
  console.log(`${C.dim}   Orbital Intelligence Terminal  -  v2.6${C.reset}`);
  console.log(border());
  console.log(`   ${C.green}*${C.reset} Node online    ${C.dim}model:${C.reset} ${C.cyan}${model}${C.reset}`);
  console.log(`   ${C.dim}Type /help for commands  -  /exit to quit${C.reset}`);
  console.log('');
}

function help() {
  console.log('');
  console.log(`   ${C.bold}Commands${C.reset}`);
  console.log(`   ${C.cyan}/help${C.reset}          show this help`);
  console.log(`   ${C.cyan}/clear${C.reset}         clear the screen`);
  console.log(`   ${C.cyan}/model${C.reset}         show current model`);
  console.log(`   ${C.cyan}/model <name>${C.reset}  switch Groq model`);
  console.log(`   ${C.cyan}/reset${C.reset}         clear conversation memory`);
  console.log(`   ${C.cyan}/exit${C.reset}          quit AATOS`);
  console.log('');
}

function startSpinner() {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  process.stdout.write(`${C.dim}${frames[0]} thinking...${C.reset}`);
  return setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${C.dim}${frames[i]} thinking...${C.reset}`);
  }, 80);
}

function stopSpinner(timer) {
  clearInterval(timer);
  process.stdout.write('\r\x1b[2K');
}

function trimMessages() {
  const system = history[0];
  const rest = history.slice(1).slice(-20);
  return [system, ...rest];
}

async function respond(userText) {
  responding = true;
  history.push({ role: 'user', content: userText });
  process.stdout.write(`\n${C.magenta}*${C.reset} ${C.bold}${C.white}AATOS${C.reset}\n`);

  const timer = startSpinner();
  let started = false;
  let full = '';

  try {
    const stream = await groq.chat.completions.create({
      model,
      messages: trimMessages(),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      if (!started) {
        stopSpinner(timer);
        started = true;
      }
      full += delta;
      process.stdout.write(delta);
    }

    if (!started) stopSpinner(timer);
  } catch (err) {
    stopSpinner(timer);
    const msg = err?.message || String(err);
    console.log(`${C.red}x ${msg}${C.reset}`);
  }

  if (full) history.push({ role: 'assistant', content: full });
  responding = false;
  console.log('\n');
}

function farewell() {
  console.log(`\n   ${C.dim}AATOS going offline. Goodbye, Commander.${C.reset}\n`);
  rl.close();
  process.exit(0);
}

function handleCommand(line) {
  const parts = line.slice(1).trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();

  switch (cmd) {
    case 'help':
      help();
      break;
    case 'clear':
      process.stdout.write('\x1b[2J\x1b[H');
      banner();
      break;
    case 'model':
      if (parts[0]) {
        model = parts[0];
        console.log(`   ${C.green}model set to${C.reset} ${C.cyan}${model}${C.reset}`);
      } else {
        console.log(`   ${C.green}current model:${C.reset} ${C.cyan}${model}${C.reset}`);
      }
      break;
    case 'reset':
      history.length = 1;
      console.log(`   ${C.green}conversation memory cleared${C.reset}`);
      break;
    case 'exit':
    case 'quit':
      farewell();
      return;
    default:
      console.log(`   ${C.yellow}unknown command /${cmd}${C.reset} ${C.dim}- try /help${C.reset}`);
  }

  promptUser();
}

function promptUser() {
  if (inputClosed) return process.exit(0);
  rl.question(`${C.cyan}+-${C.reset} ${C.bold}${C.white}Commander${C.reset} ${C.cyan}>${C.reset} `, (input) => {
    const text = input.trim();
    if (!text) return promptUser();
    if (text.startsWith('/')) return handleCommand(text);
    respond(text).then(promptUser).catch((e) => {
      console.log(`${C.red}x ${e?.message || e}${C.reset}`);
      promptUser();
    });
  });
}

rl.on('SIGINT', () => farewell());
rl.on('close', () => {
  inputClosed = true;
  if (!responding) process.exit(0);
});

banner();
promptUser();
