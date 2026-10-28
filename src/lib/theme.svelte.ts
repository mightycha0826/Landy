/**
 * 화면 모드 — 기기 설정 따르기 / 라이트 / 다크 (설정 화면에서 고른다).
 * 이 기기에만 저장한다 (localStorage). <html data-theme> 로 app.css 의 색을 바꾼다.
 * 첫 화면이 잠깐 반대 색으로 번쩍이지 않게 app.html 의 짧은 스크립트가 같은 키를 먼저 읽어 입힌다.
 */
type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
	{ id: 'system', label: '기기 설정 따르기' },
	{ id: 'light', label: '라이트 모드' },
	{ id: 'dark', label: '다크 모드' }
];
const KEY = 'theme-v1'; // app.html 과 같은 키
const BAR = { light: '#ffffff', dark: '#1e1e1e' }; // app.css 의 --bg

export const THEME = $state({ mode: 'system' as ThemeMode });

function apply(mode: ThemeMode) {
	const root = document.documentElement;
	if (mode === 'system') delete root.dataset.theme;
	else root.dataset.theme = mode;
	// 안드로이드 상단 바 색 — 고른 모드가 있으면 시스템 설정과 상관없이 그 색으로
	for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
		const sys = m.media.includes('dark') ? BAR.dark : BAR.light;
		m.content = mode === 'system' ? sys : BAR[mode];
	}
	// 브라우저에 알리는 모드 (app.html · app.css 와 같이, Phase 43) — 입력칸 · 키보드 · 스크롤 막대 색, 브라우저가 억지로 뒤집지 않게
	const cs = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
	if (cs) cs.content = mode === 'system' ? 'light dark' : `only ${mode}`;
}

/** 앱을 켤 때 한 번 */
export function loadTheme() {
	let mode: ThemeMode = 'system';
	try {
		const v = localStorage.getItem(KEY);
		if (v === 'light' || v === 'dark') mode = v;
	} catch {
		/* 저장소를 못 쓰는 환경 — 기기 설정 */
	}
	THEME.mode = mode;
	apply(mode);
}

export function setTheme(mode: ThemeMode) {
	if (!THEME_MODES.some((t) => t.id === mode)) return;
	THEME.mode = mode;
	apply(mode);
	try {
		if (mode === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, mode);
	} catch {
		/* 저장은 못 해도 지금 화면에는 입힌다 */
	}
}
