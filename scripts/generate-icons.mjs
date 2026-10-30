import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * PWA 아이콘 생성 — branding/icon-source.* 를 헤드리스 Chrome 으로 줄여 PNG 로 만든다.
 * 외부 의존성(sharp 등) 없이 동작.
 *
 *   node scripts/generate-icons.mjs
 *
 * 원본은 짙은 회색(#1e1e1e) 바탕 위의 로고 (정사각형이 아니어도 된다 — object-fit: cover 로 가운데를 기준삼아 정사각형으로 자른다).
 * iOS·안드로이드가 각자 모양으로 모서리를 깎는다. 마스커블(안드로이드 적응형)은 지름 80% 원 밖이 잘릴 수 있어서
 * 로고를 68% 로 줄이고 둘레를 같은 짙은 회색 바탕으로 채운다 (render 의 scale).
 *
 * ⚠️ Windows 헤드리스 Chrome 은 DPI 스케일 때문에 --window-size 보다 크게 그려져
 *    잘릴 수 있으므로 --force-device-scale-factor=1 을 반드시 준다.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const STATIC = join(root, 'static');
const BRANDING = join(root, 'branding');

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const sourceName = readdirSync(BRANDING).find((f) => f.startsWith('icon-source.') && MIME[extname(f).toLowerCase()]);
if (!sourceName) {
	console.error('branding/icon-source.(png|webp|jpg) 를 찾지 못했습니다.');
	process.exit(1);
}
const SOURCE = join(BRANDING, sourceName);
const mime = MIME[extname(sourceName).toLowerCase()];

const CHROME = [
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => existsSync(p));

if (!CHROME) {
	console.error('Chrome/Edge 를 찾지 못했습니다. 아이콘 생성을 건너뜁니다.');
	process.exit(1);
}

const dataUrl = `data:${mime};base64,${readFileSync(SOURCE).toString('base64')}`;

/** @param {number} size @param {number} scale 로고 크기 (1 = 원본 그대로) */
const html = (size, scale) => `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#1e1e1e;overflow:hidden}
    .i{width:${size}px;height:${size}px;overflow:hidden;background:#1e1e1e}
    img{display:block;width:100%;height:100%;object-fit:cover;transform:scale(${scale})}
  </style><div class="i"><img src="${dataUrl}"></div>`;

const tmp = mkdtempSync(join(tmpdir(), 'landy-icons-'));

/** @param {string} name @param {number} size */
function render(name, size, scale = 1) {
	const page = join(tmp, `${name}.html`);
	const out = join(tmp, `${name}.png`);
	writeFileSync(page, html(size, scale), 'utf8');
	execFileSync(
		CHROME,
		[
			'--headless',
			'--disable-gpu',
			'--hide-scrollbars',
			'--force-device-scale-factor=1',
			'--virtual-time-budget=2000',
			`--window-size=${size},${size}`,
			`--screenshot=${out}`,
			pathToFileURL(page).href
		],
		{ stdio: 'ignore' }
	);
	copyFileSync(out, join(STATIC, `${name}.png`));
	console.log(`  ${name}.png  ${size}x${size}`);
}

console.log('아이콘 생성 중…');
render('icon-192', 192);
render('icon-512', 512);
render('icon-maskable-512', 512, 0.68);
render('apple-touch-icon', 180);
render('favicon-32', 32);
console.log('완료 — static/ 에 저장했습니다.');
