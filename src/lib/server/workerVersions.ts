import { env } from '$env/dynamic/private';

/**
 * 업데이트 반영 (Phase 94) — main 에 푸시하면 Cloudflare Workers Builds 가 새 버전을 올려만 둔다(`npx wrangler versions upload`).
 * 관리자가 운영 화면에서 "업데이트"를 누르면 여기서 Cloudflare API 로 그 버전을 100% 배포한다 — 그때 학생 화면이 바뀐다.
 * 필요한 Cloudflare 비밀값: CF_API_TOKEN (Workers Scripts: Edit) · CF_ACCOUNT_ID. Worker 이름은 wrangler.jsonc 의 name.
 */
const SCRIPT = 'cnsatinder';

export type WorkerVersion = { id: string; number: number; created_on: string; message: string };
export type ReleaseState = { configured: false } | { configured: true; current: WorkerVersion | null; pending: WorkerVersion[] };

type RawVersion = { id: string; number: number; metadata?: { created_on?: string }; annotations?: Record<string, string> };

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
	const base = env.CF_API_BASE || 'https://api.cloudflare.com/client/v4'; // 화면 테스트만 가짜 주소로 바꾼다
	const res = await fetch(`${base}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${SCRIPT}${path}`, {
		...init,
		headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' }
	});
	const body = (await res.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message?: string }[] } | null;
	if (!res.ok || !body?.success) throw new Error(`cloudflare ${res.status}: ${body?.errors?.map((e) => e.message).join(', ') || '응답 없음'}`);
	return body.result as T;
}

const shape = (v: RawVersion): WorkerVersion => ({
	id: v.id,
	number: v.number,
	created_on: v.metadata?.created_on ?? '',
	message: v.annotations?.['workers/message'] ?? ''
});

/** 지금 배포된 버전 + 그보다 새로 올라온(아직 학생에게 안 보이는) 버전들 — 새것부터 */
export async function releaseState(): Promise<ReleaseState> {
	if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false };
	const [{ items }, { deployments }] = await Promise.all([
		cf<{ items: RawVersion[] }>('/versions'),
		cf<{ deployments: { versions: { version_id: string; percentage: number }[] }[] }>('/deployments')
	]);
	const versions = items.map(shape).sort((a, b) => b.number - a.number);
	// 맨 앞 배포가 지금 것. 나눠 배포 중이면 가장 많이 받는 버전을 지금 것으로 본다
	const liveId = deployments[0]?.versions.slice().sort((a, b) => b.percentage - a.percentage)[0]?.version_id;
	const current = versions.find((v) => v.id === liveId) ?? null;
	return { configured: true, current, pending: versions.filter((v) => v.number > (current?.number ?? -1)) };
}

/** 이 버전을 학생 모두에게 (100%) */
export async function deployVersion(id: string, message: string) {
	await cf('/deployments', {
		method: 'POST',
		body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: id, percentage: 100 }], annotations: { 'workers/message': message.slice(0, 100) } })
	});
}
