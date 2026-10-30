/**
 * 테마 색상 — 포인트 디자인 시스템의 "조합" (설정 화면에서 고른다).
 * 조합은 두 색뿐: 첫 번째 색(primary)은 주 버튼 · 켜진 스위치 · 고른 것 · 지금 탭에, 두 번째 색(point)은 새 것 · 곧 끝남 같은 한 곳에만.
 * 나머지는 모두 회색(app.css). 원래 색이 바탕에서 묻히면 대비가 맞을 때까지 라이트는 어둡게, 다크는 밝게 민다.
 * 기본 조합(인스타)만 넓은 면(주 버튼 · 내 말풍선 · 로고)에 옅은 그라데이션 — 분홍 → 자주, 세 점이 서로 가깝다. 두 번째 색은 분홍의 보색 청록 (app.css --primary-fill).
 * 이 기기에만 저장한다 (localStorage). 예전 색(그라데이션)을 저장해 둔 기기는 기본 조합으로 돌아간다.
 */
import { contrast, pushContrast } from './contrast';
type ThemeColor = { id: string; label: string; primary: string; point: string };

// 기본(첫 번째) 인스타 값은 app.css 에 미리 계산해 두었다. 나머지는 채도 높은 두 색을 맞붙인 단색 조합
export const THEME_COLORS: ThemeColor[] = [
	{ id: 'insta', label: '인스타', primary: '#d6246e', point: '#00c2a0' },
	{ id: 'volt', label: '일렉트릭 블루와 형광 주황', primary: '#2a3bff', point: '#ff5a00' },
	{ id: 'acid', label: '마젠타와 라임', primary: '#ff0a78', point: '#b6f000' },
	{ id: 'siren', label: '다홍과 시안', primary: '#ff3b1f', point: '#00d1ff' },
	{ id: 'rave', label: '바이올렛과 형광 노랑', primary: '#7a1fff', point: '#ffd500' }
];
const DEFAULT = THEME_COLORS[0].id;
const KEY = 'theme-combo-v1';

/** 색 동그라미 — 두 색을 반씩 (기본 인스타는 그라데이션 그대로) */
export const fillOf = (c: ThemeColor) =>
	c.id === DEFAULT ? 'linear-gradient(115deg, #e5402a, #d6246e 50%, #8134af)' : `linear-gradient(135deg, ${c.primary} 50%, ${c.point} 50%)`;

export const THEME_COLOR = $state({ id: DEFAULT });

// app.css 의 회색 (라이트 / 다크)
const L = { bg: '#ffffff', row: '#f3f3f3' };
const D = { bg: '#1e1e1e', surface: '#262626', row: '#2e2e2e' };

/** primary 면 — 흰 글자 4.5:1. 다크는 그 한도까지 밝게 */
const lighten = (hex: string, r: number) =>
	'#' + hex.slice(1).match(/../g)!.map((v) => Math.round(parseInt(v, 16) + (255 - parseInt(v, 16)) * r).toString(16).padStart(2, '0')).join('');
function primaryFill(hex: string, dark: boolean) {
	const base = pushContrast(hex, '#ffffff', 4.5, '#000000');
	if (!dark) return base;
	let c = base;
	for (let step = 1; step <= 100 && contrast(lighten(base, step / 100), '#ffffff') >= 4.5; step++) c = lighten(base, step / 100);
	return c;
}

// 토큰 이름 — app.css 가 라이트는 --c-<이름>-l, 다크는 --c-<이름>-d 를 읽는다 (CSP 때문에 <style> 대신 html 의 style 속성에 넣는다)
const NAMES = ['primary', 'primary-mark', 'primary-text', 'primary-icon', 'point', 'point-mark', 'point-icon', 'point-text'];

function tokens(c: ThemeColor, dark: boolean): string[] {
	const up = dark ? '#ffffff' : '#000000';
	const bg = dark ? D.bg : L.bg;
	const row = dark ? D.row : L.row;
	const surface = dark ? D.surface : L.bg;
	return [
		primaryFill(c.primary, dark),
		pushContrast(c.primary, bg, 3, up),
		pushContrast(c.primary, surface, 4.5, up),
		pushContrast(c.primary, row, 3, up),
		c.point,
		pushContrast(c.point, surface, 3, up),
		pushContrast(c.point, row, 3, up),
		pushContrast(c.point, surface, 4.5, up)
	];
}

function apply(id: string) {
	const root = document.documentElement.style;
	const c = THEME_COLORS.find((x) => x.id === id);
	const light = c && c.id !== DEFAULT ? tokens(c, false) : null;
	const dark = c && c.id !== DEFAULT ? tokens(c, true) : null;
	// 기본 조합은 app.css 의 값을 그대로 쓴다
	NAMES.forEach((n, i) => {
		if (light && dark) {
			root.setProperty(`--c-${n}-l`, light[i]);
			root.setProperty(`--c-${n}-d`, dark[i]);
		} else {
			root.removeProperty(`--c-${n}-l`);
			root.removeProperty(`--c-${n}-d`);
		}
	});
	// 넓은 면의 그라데이션 세 점 — 단색 조합은 셋 다 같은 primary
	for (const k of ['a', 'b', 'c']) {
		if (light) root.setProperty(`--c-stop-${k}`, light[0]);
		else root.removeProperty(`--c-stop-${k}`);
	}
}

/** 앱을 켤 때 한 번 — 저장해 둔 조합을 입힌다 */
export function loadThemeColor() {
	let id = DEFAULT;
	try {
		id = localStorage.getItem(KEY) ?? DEFAULT;
	} catch {
		/* 저장소를 못 쓰는 환경 — 기본 조합 */
	}
	if (!THEME_COLORS.some((c) => c.id === id)) id = DEFAULT;
	THEME_COLOR.id = id;
	apply(id);
}

export function setThemeColor(id: string) {
	if (!THEME_COLORS.some((c) => c.id === id)) return;
	THEME_COLOR.id = id;
	apply(id);
	try {
		if (id === DEFAULT) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, id);
	} catch {
		/* 저장은 못 해도 지금 화면에는 입힌다 */
	}
}
