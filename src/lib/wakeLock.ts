/**
 * 화면 꺼짐 막기 (Screen Wake Lock) — 상대를 찾는 동안만.
 *
 * 찾기는 앱이 보이는 동안에만 서버에 묻는다(PollSeeker). 폰을 들고 기다리다 화면이 저절로 꺼지면
 * 서버 풀(seek_ttl_sec)에서 빠져 매칭 기회를 잃으므로, 찾는 동안에는 화면이 꺼지지 않게 해 둔다.
 * 다른 앱으로 가면 브라우저가 잠금을 풀고, 돌아오면 다시 건다. 지원하지 않는 브라우저에서는 아무 일도 하지 않는다.
 */
export const canHoldScreen = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/** 화면을 켜 둔다. 돌려받은 함수를 부르면 푼다. */
export function holdScreenOn(): () => void {
	if (!canHoldScreen()) return () => {};
	let sentinel: WakeLockSentinel | null = null;
	let asking = false;
	let stopped = false;
	const acquire = async () => {
		if (stopped || asking || sentinel || document.visibilityState !== 'visible') return;
		asking = true;
		try {
			const s = await navigator.wakeLock.request('screen');
			if (stopped) {
				void s.release().catch(() => {});
				return;
			}
			sentinel = s;
			s.addEventListener('release', () => {
				if (sentinel === s) sentinel = null;
			});
		} catch {
			/* 배터리 절약 모드 · 권한 정책 — 화면이 꺼질 수 있을 뿐 찾기는 그대로 */
		} finally {
			asking = false;
		}
	};
	const onVis = () => void acquire();
	document.addEventListener('visibilitychange', onVis);
	void acquire();
	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', onVis);
		void sentinel?.release().catch(() => {});
		sentinel = null;
	};
}
