/**
 * 기기의 "동작 줄이기"(prefers-reduced-motion) 또는 설정 › 화면의 "움직임 줄이기"(<html data-motion="reduce">, Phase 43) 를 따른다.
 * CSS 애니메이션은 app.css 에서 한꺼번에 끄고, 여기는 JS 스크롤 · 전환용 — scrollTo({ behavior }) 는 CSS 로 못 막는다.
 */
export const reducedMotion = () =>
	(typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') ||
	(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');

/** Shared with the CSS tokens in app.css. Exits finish before entrances settle. */
export const MOTION = { press: 80, quick: 120, enter: 220, exit: 160, settle: 360, sheet: 440, sheetExit: 280 } as const;
export const motionDuration = (duration: number) => reducedMotion() ? 0 : duration;

// Damped spring: a small overshoot followed by one quiet settle, with exact endpoints.
const damping = 0.82;
const frequency = 12;
const damped = frequency * Math.sqrt(1 - damping * damping);
const response = (t: number) => 1 - Math.exp(-damping * frequency * t) *
	(Math.cos(damped * t) + damping * frequency / damped * Math.sin(damped * t));
export const settle = (t: number) => response(t) / response(1);
export const arrive = (t: number) => 1 - (1 - t) ** 3;
export const depart = (t: number) => t * t;

const tabs = ['/letters', '/', '/me'];
export type NavigationMotion = 'push' | 'pop' | 'tab-left' | 'tab-right' | 'fade';
export function navigationMotion(from: string, to: string, delta?: number): NavigationMotion {
	const a = tabs.indexOf(from), b = tabs.indexOf(to);
	if (a >= 0 && b >= 0) return b > a ? 'tab-right' : b < a ? 'tab-left' : 'fade';
	if (delta !== undefined && delta !== 0) return delta < 0 ? 'pop' : 'push';
	if (a >= 0 || to.startsWith(from + '/')) return 'push';
	if (b >= 0 || from.startsWith(to + '/')) return 'pop';
	return 'fade';
}

/** Monotonic resistance, even when a finger travels beyond the screen. */
export const rubberBand = (distance: number, limit: number) => limit * (1 - Math.exp(-Math.max(0, distance) / (limit * 2)));
