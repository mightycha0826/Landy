import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
const SP = OUT, PORT = 5194;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const browser = await chromium.launch({ executablePath: CHROME });
try {
	const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
	const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
	await page.goto(`http://localhost:${PORT}/dev/chat?s=chat`);
	await page.locator('.intro').waitFor(); await page.waitForTimeout(800);
	await page.locator('.list').evaluate((e) => e.scrollTo(0, 0)); await page.waitForTimeout(300);
	await page.screenshot({ path: `${SP}/intro-chat.png` });
	const intro = page.locator('.intro');
	check('맨 위에 상대 소개 카드', (await page.locator('.list > *').first().getAttribute('class'))?.includes('intro'));
	check('상대의 익명 이름', (await intro.locator('h2').innerText()) === '새벽수달');
	const line = intro.locator(':scope > p'); // 카드 안 공개 범위 안내(PrivacySummary)의 문단은 빼고 카드의 둘째 줄만
	check('둘째 줄: MBTI · 관심사 2개', (await line.innerText()) === 'INFP · 밴드 · 기타', await line.innerText());
	check('큰 아바타 + 접속 점', (await intro.locator('.av').boundingBox()).width === 88 && (await intro.locator('.av .dot').count()) === 1);
	const ib = await intro.boundingBox(), fb = await page.locator('.list .sys').first().boundingBox();
	check('카드가 첫 안내 문구보다 위', ib.y + ib.height <= fb.y + 1);
	check('가운데 정렬', Math.abs(ib.x + ib.width / 2 - 195) < 4, JSON.stringify(ib));
	await intro.getByRole('button', { name: '프로필 보기' }).click(); await page.waitForTimeout(300);
	check('프로필 보기 → 프로필 시트', (await page.locator('.sheet .profile').count()) === 1 && (await page.locator('.sheet .profile .bio').innerText()).includes('밴드'));
	await page.getByRole('button', { name: '닫기' }).click();
	await page.locator('.sheet').waitFor({state:'detached'});
	await page.waitForTimeout(250);

	await page.goto(`http://localhost:${PORT}/dev/chat?s=pending`);
	await page.locator('.intro').waitFor(); await page.waitForTimeout(600);
	await page.screenshot({ path: `${SP}/intro-pending.png` });
	check('입장 대기(메시지 없음)에도 카드', (await page.locator('.intro h2').innerText()).length > 0 && (await page.locator('.bubble').count()) === 0);
	check('페이지 오류 없음', errs.length === 0, errs.join(' / '));
	await page.context().close();
	const publicContext = await browser.newContext({viewport:{width:390,height:800}});
	const legalPage = await publicContext.newPage();
	for (const doc of ['terms','privacy','policy']) {
		await legalPage.goto(`http://localhost:${PORT}/legal/${doc}`);
		await legalPage.locator('article h1').waitFor();
		check(`설치·로그인 없이 ${doc} 문서 열림`, new URL(legalPage.url()).pathname === `/legal/${doc}` && await legalPage.locator('article h2').count() > 0);
	}
	const viewport = await legalPage.locator('meta[name=viewport]').getAttribute('content');
	check('브라우저 확대 허용', !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/.test(viewport));
	await publicContext.close();
} finally { await browser.close(); stopProcess(vite);  }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
