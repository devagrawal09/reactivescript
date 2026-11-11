// Drives a running demo in headless Chromium: posts each sample, waits for the page to show it, clicks, and prints what
// the page shows. `CHROMIUM=/path/to/chrome node --experimental-strip-types scripts/smoke.ts [URL]`.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { optionsOf } from './post-samples.ts';

const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright') as typeof import('playwright');
const url = process.argv[2] ?? 'http://127.0.0.1:4180';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
const logs: string[] = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForSelector('.live.on');
const text = async (sel: string) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const post = async (file: string) => {
  const r = await fetch(url + '/eval?' + optionsOf(file), { method: 'POST', body: readFileSync(new URL('../samples/' + file, import.meta.url), 'utf8') });
  const e = await r.json() as { id: number };
  await page.waitForFunction(id => document.querySelector('.result')?.textContent?.includes('#' + id + ' ·'), e.id);
};
const show = async (label: string) => console.log(label.padEnd(28), '|', await text('.result .markup, .result .value, .result .errors'));

await post('01-counter.rx'); await show('counter');
await page.locator('.markup button').click(); await page.waitForTimeout(50); await show('counter after +1');
await post('02-local-state.rx'); await page.locator('.markup button').click(); await page.locator('.markup button').click(); await show('local state, 2 clicks');
await post('01-counter.rx'); await show('counter again (count kept)');
await post('03-todos.rx'); await page.locator('.markup li').first().click(); await page.locator('.markup button').click(); await show('todos: toggle 1, add');
console.log('bindings panel'.padEnd(28), '|', await text('.bindings ul'));
await post('04-async-user.rx'); await show('async user (pending)'); await page.waitForSelector('.markup p'); await show('async user (loaded)');
await page.locator('.markup button').click(); await page.waitForTimeout(100); await show('async user after next');
await page.waitForTimeout(900); await show('async user settled');
await post('05-label.string.rx'); await show('value eval');
await post('06-counter.tsx'); await page.locator('.markup button').click(); await page.waitForTimeout(50); await show('tsx counter');
await post('07-refused-operator.rx'); await show('refused operator');
await post('08-refused-write.rx'); await show('refused write');
await page.getByText('◀ back').click(); await page.getByText('◀ back').click(); await page.waitForTimeout(50); await show('history: back twice');
console.log('history'.padEnd(28), '|', (await page.locator('.history li').count()) + ' entries');
await page.screenshot({ path: process.env.SHOT ?? 'smoke.png', fullPage: true });
console.log(logs.length ? 'console:\n' + logs.join('\n') : 'console: clean');
await browser.close();
