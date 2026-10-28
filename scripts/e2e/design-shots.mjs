import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 디자인 미리보기 스크린샷 (design/point) — 라이트 · 다크로 주요 화면을 찍어 OUT/design-* 에 남긴다
const PORT = 5186;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: CHROME });
try {
	for (const scheme of ['light', 'dark']) {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
		for (const path of ['/welcome', '/login', '/dev/chat', '/dev/letters', '/dev/achievements']) {
			await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
			await page.waitForTimeout(1200);
			const file = `${OUT}/design-${scheme}-${path.replaceAll('/', '_').slice(1)}.png`;
			await page.screenshot({ path: file });
			console.log(file);
		}
		await page.close();
	}
} finally {
	await browser.close();
	stopProcess(vite);
}
