#!/usr/bin/env node
// Standalone login helper — runs with plain Node.js (no bun needed).
// Saves Playwright session cookies so the bun chat agent can use them.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const SESSION_PATH = join(DATA_DIR, 'session.json');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log('\n  Opening browser for manual login...');
console.log('  1. Log into your Goodreads account in the browser window.');
console.log('  2. Once logged in, come back here and press Enter.\n');

const browser = await chromium.launch({
  headless: false,
  executablePath: existsSync(EDGE_PATH) ? EDGE_PATH : undefined,
  args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

const page = await context.newPage();
await page.goto('https://www.goodreads.com/user/sign_in');
await page.bringToFront();

console.log('  Goodreads login page opened. Log in, then press Enter here.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) =>
  rl.question('  Press Enter when done logging in → ', () => {
    rl.close();
    resolve();
  }),
);

mkdirSync(DATA_DIR, { recursive: true });
await context.storageState({ path: SESSION_PATH });
console.log(`\n  Session saved to ${SESSION_PATH}`);
console.log('  You can now run: npm run lesson13:browser\n');

await browser.close();
