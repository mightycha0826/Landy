import { redirect } from '@sveltejs/kit';

/** 예전 주소(/chat) — 이제 대화마다 /chat/[id] 를 쓴다. 대화 목록으로 보낸다 (/notices · /letters/[id] 와 같은 방식). */
export function load() {
	redirect(307, '/');
}
