import { fail } from '@sveltejs/kit';
import { adminRpc, supabaseAdmin } from '$lib/server/supabaseAdmin';
import { checkAi } from '$lib/server/ai';
import { allowed, friendly, guard } from '$lib/server/adminAuth';
import { integerFields } from '$lib/server/adminForms';
import { AI_INTEGER_FIELDS, INTEGER_FIELDS, maintenanceInput, type AiUsage, type AppSettings } from '$lib/server/adminSettings';
import type { Actions, PageServerLoad } from './$types';

export type { AiUsage, AppSettings } from '$lib/server/adminSettings';

export const load: PageServerLoad = async ({ locals, url }) => {
	guard(locals, url); // 서비스 열고 닫기 또는 운영 설정 권한 (Phase 51 표)
	const [s, usage, terms, students] = await Promise.all([
		adminRpc<AppSettings>('admin_get_settings'),
		// Phase 19 함수 — DB 에 아직 없으면 null (화면이 "패치 필요"를 띄운다)
		adminRpc<AiUsage>('admin_ai_usage').catch(() => null),
		adminRpc<string[]>('admin_banned_terms').catch(() => null),
		// 가입한 학생 수 (Phase 44 — 익명편지 잠금 기준과 견준다). 표가 아직 없으면 null
		supabaseAdmin()
			.from('signup_stats')
			.select('students')
			.maybeSingle()
			.then(({ data }) => (data as { students: number } | null)?.students ?? null, () => null)
	]);
	return { s, usage, terms, students };
};

/** 모든 설정 액션은 같은 RPC와 DB 오류 정책을 쓴다. */
async function updateSettings(locals: App.Locals, patch: Record<string, unknown>, checkRange = false) {
	try {
		await adminRpc('admin_update_settings', { p_patch: patch, p_staff: locals.staff!.id });
	} catch (e) {
		// 폼 검증과 DB check 제약이 어긋난 경우도 입력 오류로 안내한다.
		if (checkRange && String((e as Error)?.message).includes('check')) return fail(400, { error: '허용 범위를 벗어난 값이 있어요' });
		return friendly(e);
	}
	return null;
}

export const actions: Actions = {
	/**
	 * 서버 점검 (Phase 52) — 켜면 학생 앱 전체가 점검 화면(1분 안에, 앱을 열면 바로). 새 대화 · 편지도 DB 가 막는다.
	 * 문구(300자) · 끝나는 시각(선택, 한국 시간 datetime-local). 서비스 열고 닫기 또는 운영 설정 권한
	 */
	maint: async ({ request, locals }) => {
		if (!allowed(locals, 'service') && !allowed(locals, 'settings')) return fail(403, { error: '서버 점검을 켜고 끌 권한이 없어요' });
		const input = maintenanceInput(await request.formData());
		if ('error' in input) return fail(400, { error: input.error });
		const result = await updateSettings(locals, input.patch);
		if (result) return result;
		if (input.startsAt) return { done: `점검 예약됨 · ${input.startsAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}부터` };
		return { done: input.on ? '점검 시작 · 1분 안에 모든 학생에게 점검 화면' : '점검 끝 · 1분 안에 다시 열려요' };
	},

	/** 킬 스위치 — 한 번 눌러서 바로 */
	toggle: async ({ request, locals }) => {
		const open = (await request.formData()).get('open') === 'true';
		return await updateSettings(locals, { is_open: open }) ?? { done: open ? '서비스 열림' : '서비스 닫힘. 진행 중인 대화는 유지됩니다' };
	},

	save: async ({ request, locals }) => {
		if (!allowed(locals, 'settings')) return fail(403, { error: '개발자 · 관리자만 바꿀 수 있어요' });
		const f = await request.formData();
		const input = integerFields(f, INTEGER_FIELDS);
		if ('error' in input) return fail(400, { error: input.error });
		const patch = { notice: String(f.get('notice') ?? '').slice(0, 300), ...input.values };
		return await updateSettings(locals, patch, true) ?? { done: '저장 완료' };
	},

	/** 익명편지 잠금 (Phase 44, 관리자만) — 켜 두면 가입한 학생이 기준 인원이 될 때까지 편지 쓰기 · 찾기가 막힌다 */
	letters: async ({ request, locals }) => {
		if (!allowed(locals, 'settings')) return fail(403, { error: '개발자 · 관리자만 바꿀 수 있어요' });
		const f = await request.formData();
		const min = Number(f.get('letters_gate_min'));
		if (!Number.isInteger(min) || min < 1 || min > 10000) return fail(400, { error: '열리는 인원은 1~10000 사이의 정수여야 해요' });
		const gate = f.get('letters_gate') === 'on';
		return await updateSettings(locals, { letters_gate: gate, letters_gate_min: min }) ?? { done: gate ? `익명편지 잠금 켬 · 가입 ${min}명에 열림` : '익명편지 잠금 끔 · 지금 바로 열림' };
	},

	/** 동아리 뱃지 출시 (Phase 91, 관리자만) — 꺼져 있으면 학생 화면에서 동아리 뱃지를 숨긴다 */
	clubs: async ({ request, locals }) => {
		if (!allowed(locals, 'settings')) return fail(403, { error: '개발자 · 관리자만 바꿀 수 있어요' });
		const on = (await request.formData()).get('club_badges') === 'on';
		return await updateSettings(locals, { club_badges: on }) ?? { done: on ? '동아리 뱃지 출시 · 학생 앱을 다시 열면 보여요' : '동아리 뱃지 숨김' };
	},

	/** 검열봇 · AI 대화 상대 (관리자만) */
	ai: async ({ request, locals }) => {
		if (!allowed(locals, 'settings')) return fail(403, { error: '개발자 · 관리자만 바꿀 수 있어요' });
		const f = await request.formData();
		const input = integerFields(f, AI_INTEGER_FIELDS);
		if ('error' in input) return fail(400, { error: input.error });
		const patch: Record<string, unknown> = {
			ai_moderation: f.get('ai_moderation') === 'on',
			ai_chat: f.get('ai_chat') === 'on',
			...input.values
		};
		return await updateSettings(locals, patch, true) ?? { done: 'AI 설정 저장 완료' };
	},

	/** AI 연결 확인 — 짧은 질문 하나를 보내서 되는지, 안 되면 Cloudflare 가 준 오류를 그대로 보여 준다 (관리자만) */
	aiCheck: async ({ locals, platform }) => {
		if (!allowed(locals, 'settings')) return fail(403, { error: '개발자 · 관리자만 확인할 수 있어요' });
		return { aiCheck: await checkAi(platform?.env?.AI) };
	},

	/** 금칙어 — 한 줄에 하나 (정규식). 통째로 바꾼다 */
	terms: async ({ request, locals }) => {
		if (!allowed(locals, 'settings')) return fail(403, { error: '개발자 · 관리자만 바꿀 수 있어요' });
		const lines = String((await request.formData()).get('terms') ?? '')
			.split('\n')
			.map((t) => t.trim())
			.filter(Boolean);
		try {
			await adminRpc('admin_set_banned_terms', { p_terms: lines, p_staff: locals.staff!.id });
		} catch (e) {
			const m = String((e as Error)?.message ?? '');
			const bad = m.match(/bad_pattern:(.*)$/)?.[1];
			if (bad) return fail(400, { error: `"${bad.trim()}" 는 올바른 패턴이 아니에요 (괄호 짝 등을 확인해 주세요)` });
			if (m.includes('too_many_terms')) return fail(400, { error: '금칙어는 300개까지 넣을 수 있어요' });
			return friendly(e);
		}
		return { done: `금칙어 ${lines.length}개 저장 완료` };
	}
};
