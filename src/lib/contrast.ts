export function luminance(hex: string) {
	const rgb = hex.replace('#', '').match(/../g)!.map((v) => parseInt(v, 16) / 255);
	return rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
		.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a: string, b: string) {
	const x = luminance(a), y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** 장식 색은 유지하고 글씨가 올라가는 면만 WCAG 일반 텍스트 기준보다 약간 여유 있게 조정한다. */
export function readableColor(hex: string, background: string, lighten = false) {
	const rgb = hex.replace('#', '').match(/../g)!.map((v) => parseInt(v, 16));
	for (let step = 0; step <= 100; step++) {
		const ratio = step / 100;
		const color = '#' + rgb.map((v) => Math.round(lighten ? v + (255 - v) * ratio : v * (1 - ratio)).toString(16).padStart(2, '0')).join('');
		if (contrast(color, background) >= 4.7) return color;
	}
	return lighten ? '#ffffff' : '#000000';
}
/** 바탕 위 대비가 min 이 될 때까지 target(검정 · 흰색) 쪽으로 민다 — 포인트 디자인 시스템의 "대비는 자동" */
export function pushContrast(hex: string, background: string, min: number, target: '#000000' | '#ffffff') {
	const a = hex.replace('#', '').match(/../g)!.map((v) => parseInt(v, 16));
	const t = target === '#ffffff' ? 255 : 0;
	for (let step = 0; step <= 100; step++) {
		const color = '#' + a.map((v) => Math.round(v + (t - v) * (step / 100)).toString(16).padStart(2, '0')).join('');
		if (contrast(color, background) >= min) return color;
	}
	return target;
}
