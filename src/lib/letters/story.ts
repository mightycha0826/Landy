/**
 * 받은 편지 → 인스타그램 스토리 그림 (Phase 45) — 편지 화면 "편지로 답장 쓰기" 옆 인스타 버튼.
 *
 * 1080 × 1920 캔버스에 브랜드 그라디언트 바탕 + 편지지 한 장(LetterSheet 와 같은 종이: 줄 · 두 줄 여백선 · 마스킹 테이프 ·
 * 학교 로고 물자국 · 뒤에 한 장 더). 본문은 서식(굵게 · 기울임 · 밑줄 · 취소선 · 형광펜 · 글자색 · 크기 · 줄 맞춤)까지 그대로,
 * 글씨는 설정의 편지지 글씨(손글씨 / 반듯한 글씨)를 따른다. 긴 편지는 글씨를 줄여 맞추고, 그래도 넘치면 끝을 "…" 로 자른다.
 * 인스타 화면 위아래(진행 막대 · 답장 칸)에 가리지 않게 편지지는 가운데 1240px 안에 두고 그 아래에 브랜드.
 *
 * 공유는 Web Share(파일) — 폰 공유 창에서 인스타그램 › 스토리. 파일 공유가 안 되는 곳(데스크톱 등)은 그림을 저장한다.
 * 그림은 이 기기에서만 만든다 — 서버 요청 없음 (G13).
 */
import { COLOR_LIGHT as COLOR, HIGHLIGHT, toLines, type Align, type LetterFmt } from './rich';
import { LOGO_PATH } from '../ui/schoolLogo';

const STORY_W = 1080;
const STORY_H = 1920;

/** 편지지 — 화면의 편지지(폭 약 358px)를 S 배로 키운 모양 */
const PX = 96;
const PW = STORY_W - PX * 2;
const S = PW / 358;
const TOP = 260;
const BOTTOM = 1500;
const MIN_PH = 980;
const PAD = { t: 26 * S, r: 20 * S, b: 18 * S, l: 30 * S };
const MIN_FONT = 30; // 이보다 작으면 스토리에서 읽히지 않는다 — 넘치는 만큼은 "…"

/** 종이는 늘 밝은 미색 (다크 모드여도) — 브랜드 바탕 위에서 편지로 보이게. 값은 app.css :root 의 편지지 색 */
const PAPER = '#fffaf0';
const INK = '#2b2620';
const EDGE = '#efe4cf';
// 줄 · 여백선 · 테이프는 편지지(.letter-paper)처럼 테마 색(--primary #d6246e), 바탕은 앱의 그라디언트(--primary-fill)
const RULE = 'rgba(147, 59, 69, 0.2)';
const MARGIN = 'rgba(214, 36, 110, 0.38)';
const BRAND = ['#d33b27', '#d6246e', '#8134af'];
const TAPE = ['#d6246e', '#d6246e', '#d6246e'];
const SIZE_MUL: Record<string, number> = { sm: 0.85, lg: 1.25, xl: 1.6 };

type StoryLetter = {
	/** To. — 화면의 편지지와 같게 */
	to: string;
	/** From. — 부르는 쪽이 익명 이름표로 넘긴다 (이름으로 온 답장이어도 상대 이름은 싣지 않는다) */
	from: string;
	/** "2026년 9월 27일" */
	date: string;
	body: string;
	fmt?: LetterFmt | null;
};

type Piece = { text: string; w: number; font: string; px: number; keys: string[] };
type VLine = { align: Align; pieces: Piece[]; w: number };

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
const graphemes = (s: string) => (segmenter ? [...segmenter.segment(s)].map((g) => g.segment) : Array.from(s));

function fontOf(keys: string[], px: number, family: string) {
	const z = keys.find((k) => k.startsWith('z:'));
	const size = Math.round(px * (z ? (SIZE_MUL[z.slice(2)] ?? 1) : 1));
	return { size, font: `${keys.includes('i') ? 'italic ' : ''}${keys.includes('b') ? 700 : 400} ${size}px ${family}` };
}

/**
 * 본문을 줄로 — 한국어도 낱말(띄어쓰기) 단위로 넘기고(keep-all), 한 낱말이 한 줄보다 길 때만 글자 단위로 자른다.
 * 서식 경계가 낱말 가운데 있어도 한 낱말로 붙여 다룬다.
 */
function layout(ctx: CanvasRenderingContext2D, body: string, fmt: LetterFmt | null | undefined, px: number, family: string, maxW: number): VLine[] {
	const out: VLine[] = [];
	for (const line of toLines(body, fmt)) {
		// 낱말(space = 띄어쓰기 묶음)마다 조각들
		const words: { pieces: Piece[]; space: boolean }[] = [];
		for (const run of line.runs) {
			const { size, font } = fontOf(run.keys, px, family);
			ctx.font = font;
			for (const m of run.text.matchAll(/\s+|\S+/gu)) {
				const space = /^\s/u.test(m[0]);
				const piece: Piece = { text: m[0], w: ctx.measureText(m[0]).width, font, px: size, keys: run.keys };
				const last = words.at(-1);
				if (last && last.space === space && !space) last.pieces.push(piece);
				else words.push({ pieces: [piece], space });
			}
		}
		let cur: VLine = { align: line.align, pieces: [], w: 0 };
		let first = true; // 이 글줄의 첫 줄 — 넘겨서 생긴 줄은 앞 띄어쓰기를 버린다 (들여쓰기는 첫 줄만)
		const push = () => {
			while (cur.pieces.length && /^\s+$/u.test(cur.pieces.at(-1)!.text)) cur.w -= cur.pieces.pop()!.w; // 줄 끝 띄어쓰기는 매달린다
			out.push(cur);
			cur = { align: line.align, pieces: [], w: 0 };
			first = false;
		};
		const add = (p: Piece) => {
			cur.pieces.push(p);
			cur.w += p.w;
		};
		for (const word of words) {
			const ww = word.pieces.reduce((a, p) => a + p.w, 0);
			if (word.space) {
				if (cur.w + ww > maxW) push();
				else if (cur.pieces.length || first) add(word.pieces[0]);
				continue;
			}
			if (cur.w + ww <= maxW) {
				word.pieces.forEach(add);
				continue;
			}
			if (ww <= maxW) {
				push();
				word.pieces.forEach(add);
				continue;
			}
			// 한 줄보다 긴 낱말 — 글자 단위로
			for (const p of word.pieces) {
				ctx.font = p.font;
				for (const g of graphemes(p.text)) {
					const gw = ctx.measureText(g).width;
					if (cur.w + gw > maxW && cur.pieces.length) push();
					add({ ...p, text: g, w: gw });
				}
			}
		}
		push();
	}
	return out;
}

/** 넘치는 편지 — maxLines 줄까지 남기고 마지막 줄 끝에 "…" */
function clip(ctx: CanvasRenderingContext2D, lines: VLine[], maxLines: number, maxW: number) {
	if (lines.length <= maxLines) return lines;
	const kept = lines.slice(0, maxLines);
	const last = kept.at(-1)!;
	const base = last.pieces.at(-1) ?? lines[maxLines].pieces[0];
	if (base) ctx.font = base.font;
	const ell: Piece = { text: '…', w: ctx.measureText('…').width, font: ctx.font, px: base?.px ?? MIN_FONT, keys: [] };
	while (last.pieces.length && last.w + ell.w > maxW) {
		const p = last.pieces.pop()!;
		last.w -= p.w;
		const gs = graphemes(p.text);
		if (gs.length > 1) {
			gs.pop();
			ctx.font = p.font;
			const text = gs.join('');
			const w = ctx.measureText(text).width;
			last.pieces.push({ ...p, text, w });
			last.w += w;
		}
	}
	last.pieces.push(ell);
	last.w += ell.w;
	return kept;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
	else ctx.rect(x, y, w, h);
}

/** 쓸 글꼴 조각(글자 범위별 분할 파일)을 받아 둔다 — 캔버스는 기다려 주지 않는다. 오래 걸리면 있는 글꼴로 */
async function loadFonts(specs: [string, string][]) {
	if (!document.fonts?.load) return;
	const all = Promise.all(specs.map(([font, text]) => document.fonts.load(font, text).catch(() => [])));
	await Promise.race([all, new Promise((r) => setTimeout(r, 2500))]);
}

export async function storyImage(l: StoryLetter): Promise<File> {
	const root = document.documentElement;
	const css = getComputedStyle(root);
	const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
	const sans = v('--sans', 'sans-serif');
	const plain = root.dataset.letterFont === 'plain';
	const hand = plain ? sans : v('--hand', sans);
	const logo = v('--logo', sans); // 로고 글자 (Phase 83 — 롯데리아 촵땡겨체)
	// 줄 간격 : 글씨 = 설정(글자 크기)의 비율 그대로
	const fs = parseFloat(v('--letter-fs', '24')) || 24;
	const ratio = (parseFloat(v('--rule-h', '34')) || 34) / fs;

	const nameFont = plain ? `700 ${Math.round(19 * S)}px ${sans}` : `400 ${Math.round(26 * S)}px ${hand}`;
	const namePx = Math.round((plain ? 19 : 26) * S);
	const dateFont = `600 ${Math.round(12 * S)}px ${sans}`;
	const brandFont = `400 84px ${logo}`; // 짧은 이름(Landy)이라 크게 (Phase 58)
	const subFont = `700 30px ${sans}`;
	const startPx = Math.round(fs * S * 1.25); // 짧은 편지는 화면보다 크게 — 스토리에서 한눈에
	await loadFonts([
		[nameFont, `To.From.${l.to}${l.from}`],
		[dateFont, l.date],
		[`400 ${startPx}px ${hand}`, l.body],
		[`700 ${startPx}px ${hand}`, l.body],
		[brandFont, 'Landy'],
		[subFont, '익명편지']
	]);

	const canvas = document.createElement('canvas');
	canvas.width = STORY_W;
	canvas.height = STORY_H;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas');

	// ── 바탕: 브랜드 그라디언트 (왼쪽 아래 주황 → 오른쪽 위 핑크) + 빛 두 점 ──
	const bg = ctx.createLinearGradient(0, STORY_H, STORY_W, 0);
	bg.addColorStop(0, BRAND[0]);
	bg.addColorStop(0.5, BRAND[1]);
	bg.addColorStop(1, BRAND[2]);
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, STORY_W, STORY_H);
	for (const [x, y, r, c] of [
		[120, 160, 900, 'rgba(255, 255, 255, 0.22)'],
		[1000, 1800, 1000, 'rgba(160, 20, 70, 0.22)']
	] as const) {
		const g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, c);
		g.addColorStop(1, 'rgba(255, 255, 255, 0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, STORY_W, STORY_H);
	}

	// ── 본문 줄 나누기 — 들어갈 때까지 글씨를 줄인다 ──
	const textW = PW - PAD.l - PAD.r;
	const headH = namePx * 1.2 + 10 * S;
	const fromH = 16 * S + namePx * 1.2;
	const maxBody = BOTTOM - TOP - PAD.t - headH - fromH - PAD.b;
	let px = startPx;
	let ruleH = Math.round(px * ratio);
	let lines = layout(ctx, l.body, l.fmt, px, hand, textW);
	while (lines.length * ruleH > maxBody && px > MIN_FONT) {
		px = Math.max(MIN_FONT, px - 2);
		ruleH = Math.round(px * ratio);
		lines = layout(ctx, l.body, l.fmt, px, hand, textW);
	}
	lines = clip(ctx, lines, Math.floor(maxBody / ruleH), textW);

	const PH = Math.max(MIN_PH, PAD.t + headH + lines.length * ruleH + fromH + PAD.b);
	const py = Math.round(TOP + (BOTTOM - TOP - PH) / 2);

	// ── 뒤에 겹친 한 장 ──
	ctx.save();
	ctx.translate(PX + PW / 2, py + PH / 2);
	ctx.rotate((1.6 * Math.PI) / 180);
	ctx.shadowColor = 'rgba(80, 20, 30, 0.25)';
	ctx.shadowBlur = 30;
	ctx.shadowOffsetY = 8;
	ctx.globalAlpha = 0.9;
	ctx.fillStyle = PAPER;
	roundRect(ctx, -PW / 2 + 10, -PH / 2 + 16, PW, PH, 14);
	ctx.fill();
	ctx.restore();

	// ── 편지지 ──
	ctx.save();
	ctx.shadowColor = 'rgba(70, 15, 30, 0.38)';
	ctx.shadowBlur = 70;
	ctx.shadowOffsetY = 30;
	ctx.fillStyle = PAPER;
	roundRect(ctx, PX, py, PW, PH, 10);
	ctx.fill();
	ctx.restore();
	ctx.save();
	roundRect(ctx, PX, py, PW, PH, 10);
	ctx.clip();
	// 가장자리가 살짝 바랜 빛 (app.css .letter-paper 의 radial-gradient 140% 100% at 50% 35%)
	ctx.save();
	ctx.translate(PX + PW / 2, py + PH * 0.35);
	ctx.scale(PW * 1.4, PH);
	const edge = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
	edge.addColorStop(0.55, 'rgba(239, 228, 207, 0)');
	edge.addColorStop(1, 'rgba(239, 228, 207, 0.7)');
	ctx.fillStyle = edge;
	ctx.fillRect(-1, -1, 2, 2);
	ctx.restore();
	// 학교 로고 물자국 (오른쪽 아래)
	const logoW = 76 * S;
	ctx.save();
	ctx.translate(PX + PW - 22 * S - logoW, py + PH - 64 * S - logoW * (232 / 200));
	ctx.scale(logoW / 200, logoW / 200);
	ctx.fillStyle = 'rgba(138, 111, 85, 0.07)';
	ctx.fill(new Path2D(LOGO_PATH));
	ctx.restore();
	// 두 줄 여백선
	ctx.fillStyle = MARGIN;
	ctx.fillRect(PX + 20 * S, py, S, PH);
	ctx.fillRect(PX + 23.5 * S, py, S, PH);
	// 본문 칸의 줄 — 편지지 끝에서 끝까지, 한 줄 칸의 맨 아래
	const bodyTop = py + PAD.t + headH;
	const bodyH = PH - PAD.t - headH - fromH - PAD.b;
	ctx.fillStyle = RULE;
	for (let y = bodyTop + ruleH; y <= bodyTop + bodyH + 0.5; y += ruleH) ctx.fillRect(PX, y - 2, PW, 2);
	ctx.restore();

	// 종이 테두리
	ctx.strokeStyle = EDGE;
	ctx.lineWidth = 2;
	roundRect(ctx, PX, py, PW, PH, 10);
	ctx.stroke();

	// ── 마스킹 테이프 — 반투명 테마 색 · 사선 무늬 · 양 끝은 손으로 뜯은 톱니 (app.css .letter-paper::before 의 clip-path 그대로) ──
	ctx.save();
	ctx.translate(PX + PW / 2, py);
	ctx.rotate((-2.5 * Math.PI) / 180);
	const tw = 104 * S;
	const th = 24 * S;
	const tx = -tw / 2;
	const ty = -9 * S;
	const TEETH = [[0, 8], [4, 0], [8, 10], [12, 0], [88, 0], [92, 12], [96, 0], [100, 10], [100, 92], [96, 100], [92, 88], [88, 100], [12, 100], [8, 90], [4, 100], [0, 90]];
	ctx.beginPath();
	TEETH.forEach(([x, y]) => ctx.lineTo(tx + (tw * x) / 100, ty + (th * y) / 100));
	ctx.closePath();
	ctx.globalAlpha = 0.78;
	ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
	ctx.shadowBlur = 6;
	ctx.shadowOffsetY = 2;
	const tape = ctx.createLinearGradient(tx, 0, tx + tw, 0);
	tape.addColorStop(0, TAPE[0]);
	tape.addColorStop(0.55, TAPE[1]);
	tape.addColorStop(1, TAPE[2]);
	ctx.fillStyle = tape;
	ctx.fill();
	ctx.shadowColor = 'transparent';
	ctx.clip();
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
	ctx.lineWidth = 5 * S;
	for (let x = tx - th; x < tx + tw + th; x += 10 * S * Math.SQRT2) {
		ctx.beginPath();
		ctx.moveTo(x, ty + th);
		ctx.lineTo(x + th, ty);
		ctx.stroke();
	}
	ctx.restore();

	// ── 글씨 ──
	ctx.textBaseline = 'alphabetic';
	const left = PX + PAD.l;
	const right = PX + PW - PAD.r;
	const nameTop = py + PAD.t;
	// To. (왼쪽) · 날짜 (오른쪽)
	ctx.fillStyle = INK;
	ctx.font = nameFont;
	const nameBase = nameTop + namePx * 0.95;
	ctx.fillText(`To. ${l.to}`, left, nameBase, textW * 0.62); // 너무 길면 옆으로 눌러 담는다
	ctx.font = dateFont;
	ctx.globalAlpha = 0.55;
	ctx.textAlign = 'right';
	ctx.fillText(l.date, right, nameBase);
	ctx.textAlign = 'left';
	ctx.globalAlpha = 1;

	// 본문 — 글줄이 줄 칸 가운데 (화면의 line-height 처럼)
	ctx.font = `400 ${px}px ${hand}`;
	const m = ctx.measureText('가나Ag');
	const asc = m.fontBoundingBoxAscent || px * 0.8;
	const desc = m.fontBoundingBoxDescent || px * 0.2;
	lines.forEach((line, i) => {
		const top = bodyTop + i * ruleH;
		const base = top + (ruleH - (asc + desc)) / 2 + asc;
		let x = line.align === 'center' ? left + (textW - line.w) / 2 : line.align === 'right' ? right - line.w : left;
		for (const p of line.pieces) {
			const k = p.px / px;
			const hl = p.keys.find((key) => key.startsWith('h:'));
			if (hl) {
				ctx.fillStyle = HIGHLIGHT[hl.slice(2) as keyof typeof HIGHLIGHT] ?? 'transparent';
				ctx.fillRect(x, base - asc * k, p.w, (asc + desc) * k);
			}
			const c = p.keys.find((key) => key.startsWith('c:'));
			ctx.fillStyle = c ? (COLOR[c.slice(2) as keyof typeof COLOR] ?? INK) : INK;
			ctx.font = p.font;
			ctx.fillText(p.text, x, base);
			const thick = Math.max(2, p.px * 0.06);
			if (p.keys.includes('u')) ctx.fillRect(x, base + p.px * 0.1, p.w, thick);
			if (p.keys.includes('s')) ctx.fillRect(x, base - p.px * 0.28, p.w, thick);
			x += p.w;
		}
	});

	// From. (오른쪽 아래)
	ctx.fillStyle = INK;
	ctx.font = nameFont;
	ctx.textAlign = 'right';
	ctx.fillText(`From. ${l.from}`, right, py + PH - PAD.b - namePx * 0.25, textW);

	// ── 편지지 아래 브랜드 ──
	const brandY = py + PH + 100;
	ctx.textAlign = 'center';
	ctx.fillStyle = '#ffffff';
	ctx.shadowColor = 'rgba(120, 20, 50, 0.25)';
	ctx.shadowBlur = 16;
	ctx.font = brandFont;
	ctx.fillText('Landy', STORY_W / 2, brandY);
	ctx.font = subFont;
	ctx.globalAlpha = 0.9;
	ctx.fillText('익명편지', STORY_W / 2, brandY + 56);
	ctx.globalAlpha = 1;
	ctx.shadowColor = 'transparent';

	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
	if (!blob) throw new Error('toBlob');
	return new File([blob], 'landy-letter.png', { type: 'image/png' });
}

type ShareResult = 'shared' | 'saved' | 'cancelled' | 'again';

/**
 * 폰 공유 창으로 그림 보내기 — 인스타그램을 고르면 스토리 · 피드 · DM 중에서.
 * 'again': 그림을 그리는 사이 누른 손길(사용자 활성화)이 식어 공유 창이 막혔다 — 다시 누르면 만든 그림으로 바로 열린다.
 * 파일 공유가 없는 곳은 그림을 내려받는다 ('saved').
 */
export async function shareImage(file: File): Promise<ShareResult> {
	const data = { files: [file] };
	if (navigator.canShare?.(data)) {
		try {
			await navigator.share(data);
			return 'shared';
		} catch (e) {
			const name = (e as DOMException | null)?.name;
			if (name === 'AbortError') return 'cancelled';
			if (name === 'NotAllowedError') return 'again';
			throw e;
		}
	}
	const url = URL.createObjectURL(file);
	const a = document.createElement('a');
	a.href = url;
	a.download = file.name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
	return 'saved';
}
