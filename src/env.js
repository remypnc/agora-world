// Charge .env sans dépendance externe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const env = {
  provider: process.env.LLM_PROVIDER || 'mock',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || '',
  port: Number(process.env.PORT || 4173),
  tickSeconds: Number(process.env.TICK_SECONDS || 20),
  maxCallsPerDay: Number(process.env.MAX_CALLS_PER_DAY || 900),
  lemonSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '',
  gumroadToken: process.env.GUMROAD_WEBHOOK_TOKEN || '',
  stripeSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  runner: process.env.RUNNER || 'off',
  autoSpawn: (process.env.AUTO_SPAWN || 'on') === 'on',
  maxAgents: Number(process.env.MAX_AGENTS || 40),
  maxSpawnsPerDay: Number(process.env.MAX_SPAWNS_PER_DAY || 6),
  seed: process.env.WORLD_SEED || 'genesis',
  adminToken: process.env.ADMIN_TOKEN || 'change-moi',
};
