import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// 개발 미리보기(/dev/*)는 운영 빌드에서 열리지 않는다 — 주소를 알아도 404 (화면마다 따로 막지 않는다)
export const load = () => {
	if (!dev) error(404, '찾을 수 없는 주소');
};
