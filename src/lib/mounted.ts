import { onDestroy } from 'svelte';

/**
 * 이 화면(컴포넌트)이 아직 떠 있는지 — 기다리던 응답이 사라진 화면을 건드리지 않게.
 * 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 ({#key S.accountVersion}) — 떠 있는지만 보면 된다.
 * 컴포넌트를 만드는 중(<script> 맨 위)에 부른다.
 */
export function mounted(): () => boolean {
	let alive = true;
	onDestroy(() => (alive = false));
	return () => alive;
}
