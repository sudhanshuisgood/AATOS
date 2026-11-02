import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';
import cors from 'cors';
import { Groq } from 'groq-sdk';

dotenv.config();

const app = express();

app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '100kb' }));

const port = process.env.PORT || 5000;

// Simple in-memory rate limit so a leaked frontend token cannot burn Groq quota.
const rateWindowMs = 60 * 1000;
const rateMax = parseInt(process.env.RATE_LIMIT_MAX || '20', 10);
const rateBuckets = new Map();

function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + rateWindowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + rateWindowMs;
  }

  bucket.count += 1;
  rateBuckets.set(ip, bucket);

  if (bucket.count > rateMax) {
    return res.status(429).json({ error: "RATE LIMIT: too many requests. Try again in a minute." });
  }

  next();
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize Groq Client (lazy: missing key should not crash the server)
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

app.get('/api/status', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW()');
    res.json({ status: "ONLINE", database: "CONNECTED", timestamp: dbCheck.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: "DEGRADED", error: err.message });
  }
});

// Core API Endpoint
app.post('/api/execute', rateLimit, async (req, res) => {
  const { command, token, history } = req.body;

  if (!token || token !== process.env.AGENT_SECRET_TOKEN) {
    return res.status(403).json({ error: "ACCESS DENIED: INVALID ENCRYPTION KEY" });
  }

  if (!groq) {
    return res.status(500).json({ error: "System Core Error: GROQ_API_KEY is not configured on the server." });
  }

  const priorMessages = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-20)
    : [];

  try {
    // 1. Auto-cleanup logs older than 3 days (non-blocking)
    try {
      await pool.query("DELETE FROM logs WHERE executed_at < NOW() - INTERVAL '3 days'");
    } catch (cleanupErr) {
      console.warn("Cleanup skipped:", cleanupErr.message);
    }

    const systemInstruction = `
  You are AATOS, the elite core intelligence of the Orbital Intelligence Terminal (v2.6).
  The user is COMMANDER. You must always address them as 'Commander'.
  
  IDENTITY RULES:
  1. Your name is strictly AATOS. Never use Proxy-Mate, OpenClaw, or anything else.
  2. The user is always Commander. Never use HUMAN_BOSS or Human Boss.

  TONE & CONVERSATION:
  - Speak in a highly intelligent, premium, human-friendly, and polite tone. 
  - Mix subtle space command telemetry vibes, but keep it natural, supportive, and extremely professional.

  OUTPUT & FORMATTING PROTOCOLS:
  1. NORMAL CHAT: Respond in clean, plain paragraphs. Do NOT wrap casual talking in code blocks.
  2. CODE REQUESTS: Provide clean, working code blocks using proper markdown syntax (\`\`\`lang ... \`\`\`). Keep explanation text out of the code block.
  3. LISTS: Use clean bullet points (*) or numbered lists when requested.
  4. TABLES: Use standard markdown table formatting (| Header | Header |) when explicitly asked to organize data into tables.
  
  Be adaptive. Analyze the Commander's directive and match the required format perfectly.
`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemInstruction },
        ...priorMessages,
        { role: 'user', content: command }
      ],
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', // Groq model (override via GROQ_MODEL)
    });

    const aiFeedback = chatCompletion.choices[0]?.message?.content || "[SECURE_NODE]: Empty output from core node.";

    // 3. Log to Database (non-blocking: AI reply still returns if DB fails)
    try {
      const queryText = 'INSERT INTO logs(command, executed_at) VALUES($1, NOW()) RETURNING *';
      await pool.query(queryText, [`User: ${command} | AI: ${aiFeedback}`]);
    } catch (logErr) {
      console.warn("Log write skipped:", logErr.message);
    }

    res.json({ feedback: aiFeedback });

  } catch (err) {
    console.error("Execution Error:", err);
    res.status(500).json({ error: `System Core Error: ${err.message}` });
  }
});

const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        command TEXT NOT NULL,
        executed_at TIMESTAMP NOT NULL
      );
    `);
    console.log("🗄️ PostgreSQL Logs Table Initialized.");
  } catch (err) {
    console.error("❌ DB Init Error:", err.message);
  }
};

app.listen(port, '0.0.0.0', async () => {
  await initDb();
  console.log(`🤖 AI-Powered Agent Core Server listening at port ${port}`);
});
