/**
 * 화면이 보이는 동안만 ms 마다 fn 을 부르고, 백그라운드에서 돌아오면 곧바로 한 번 부른다.
 * 대화 목록·편지 피드·편지 상세·운영자 실시간 현황이 같은 방식으로 새로 읽는다.
 * 돌려주는 함수를 부르면 멈춘다 ($effect 의 정리 함수로 그대로 돌려주면 된다).
 * 앱을 잠깐 오갈 때마다 모든 화면이 한꺼번에 새로 읽지 않게, 방금(15초 안에) 읽었으면 복귀 때는 건너뛴다.
 */
const FOREGROUND_GAP_MS = 15_000;
export function whileVisible(fn: () => void, ms: number): () => void {
	const visible = () => document.visibilityState === 'visible';
	let last = 0;
	const run = () => {
		if (!visible()) return;
		last = Date.now();
		fn();
	};
	const timer = setInterval(run, ms);
	const onVis = () => {
		if (Date.now() - last >= Math.min(ms, FOREGROUND_GAP_MS)) run();
	};
	document.addEventListener('visibilitychange', onVis);
	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVis);
	};
}
