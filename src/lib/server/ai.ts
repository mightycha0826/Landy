import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { callModels, type ModelSpec } from './aiFold';

/**
 * Cloudflare Workers AI 호출 (검열봇 · 대화 봇 공용). 서버 전용.
 *
 * 무료 몫: 하루 10,000 Neuron, UTC 00:00(한국 오전 9시)에 초기화, 무료 플랜에서 넘으면 오류.
 * 모델: Gemma 4 26B A4B — Cloudflare 가 Gemma 3 12B(2026-05 폐기 공지, 이 계정은 5018 "not allowed")의 대체로 권하는 모델.
 *   그 모델도 막혀 있으면 두 번째 권장 대체인 GLM 4.7 Flash(다국어)로 넘어간다. 한 번 되는 모델을 찾으면 그걸 계속 쓴다.
 *   Gemma 4 는 생각하기(reasoning)를 끄고 부른다 — 켜면 답 글자 수(max_tokens)를 생각에 써 버린다.
 * AI_MODEL 환경변수를 주면 그 모델을 맨 앞에 둔다.
 * Cloudflare 는 Workers AI 로 보낸 내용을 모델 학습·서비스 개선에 쓰지 않는다고 명시한다.
 *
 * 개발 서버에서 AI_FAKE=1 이면 진짜 모델 대신 정해진 답을 돌려준다 (화면 테스트용):
 *   검열 — 글에 "[flag:분류]" 가 있으면 그 분류로 걸림 / 대화 봇 — "봇 답: <마지막 말>"
 */
const MODELS: ModelSpec[] = [
	{ id: '@cf/google/gemma-4-26b-a4b-it', extra: { chat_template_kwargs: { enable_thinking: false } } },
	{ id: '@cf/zai-org/glm-4.7-flash' }
];
const models = () => {
	const pick = env.AI_MODEL?.trim();
	return pick ? [{ id: pick }, ...MODELS.filter((m) => m.id !== pick)] : MODELS;
};
/** 이 Worker 에서 마지막으로 된 모델 — 안 되는 모델을 매번 먼저 부르지 않게 */
let working: string | null = null;
const AI_MODEL = () => working ?? models()[0].id;

import type { AiBinding, AiMessage } from './aiFold';
/** AiBinding = wrangler.jsonc 의 "ai" 바인딩 (platform.env.AI) */
export type { AiBinding, AiMessage };

export class AiUnavailable extends Error {}

export async function runAi(
	ai: AiBinding | undefined,
	messages: AiMessage[],
	opts: { maxTokens: number; temperature?: number; fake: (msgs: AiMessage[]) => string }
): Promise<string> {
	if (dev && env.AI_FAKE === '1') return opts.fake(messages);
	if (!ai) throw new AiUnavailable('no_binding');
	const r = await callModels(ai, messages, models(), working, {
		max_tokens: opts.maxTokens,
		temperature: opts.temperature ?? 0.2
	});
	// 무료 몫을 다 썼거나(무료 플랜) 모델 오류 — 호출한 쪽이 "나중에"로 처리한다
	if (!r.ok) throw new AiUnavailable(r.errors.join(' / '));
	working = r.model;
	const out = r.out;
	const text =
		typeof out === 'string'
			? out
			: typeof (out as { response?: unknown })?.response === 'string'
				? (out as { response: string }).response
				: ((out as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '');
	if (!text.trim()) throw new AiUnavailable('empty');
	return text.trim();
}

/**
 * 운영 설정의 "AI 연결 확인" — 짧은 질문 하나로 연결 · 모델 · 무료 몫을 본다. 실패하면 Cloudflare 가 준 오류를 그대로.
 * (학생 화면에는 이유를 보이지 않고, 여기서만 보여 준다)
 */
export async function checkAi(ai: AiBinding | undefined) {
	const t0 = Date.now();
	const base = { binding: !!ai };
	try {
		const reply = await runAi(
			ai,
			[
				{ role: 'system', content: '한국어로 아주 짧게 답한다.' },
				{ role: 'user', content: '연결 확인이에요. "안녕"이라고만 답해 주세요.' }
			],
			{ maxTokens: 20, temperature: 0, fake: () => '안녕 (가짜 AI)' }
		);
		return { ...base, model: AI_MODEL(), ok: true as const, ms: Date.now() - t0, reply: reply.slice(0, 80) };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ...base, model: models().map((m) => m.id).join(' → '), ok: false as const, ms: Date.now() - t0, error: msg.slice(0, 900) };
	}
}
