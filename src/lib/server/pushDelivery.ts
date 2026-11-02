import { isPushEndpoint, sendPush, type PushSub } from './webpush';

export type PushNote = {
	kind: 'chat' | 'reaction' | 'letter' | 'notice' | 'crowd';
	title: string; body: string; room_id?: string; id?: number; at?: string; url?: string; tag?: string;
	subs: PushSub[]; job?: string; lease?: string;
};
type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type Vapid = Parameters<typeof sendPush>[2];

/** HTTP와 예약 작업이 같은 발송·결과 기록 경로를 사용한다. */
export async function sendDelivery(p: PushNote, rpc: Rpc, vapid: Vapid | null, allowTest = false) {
	const subs = p.subs.filter((s) => (allowTest || isPushEndpoint(s.endpoint)) && !s.mute?.includes(p.kind));
	const finish = async (sent: number, failed: number, skip = false) => {
		if (p.job && p.lease) await rpc('push_complete', { p_job: p.job, p_lease: p.lease, p_sent: sent, p_failed: failed, p_skip: skip });
	};
	if (!vapid || !subs.length) {
		await finish(0, !vapid ? subs.length : 0, !!vapid);
		return { skip: !vapid ? 'not_configured' : 'no_device' };
	}
	const note = JSON.stringify({ kind: p.kind, title: p.title, body: p.body, room: p.room_id, id: p.id, at: p.at, url: p.url, tag: p.tag });
	const results = await Promise.allSettled(subs.map((s) => sendPush(s, note, vapid)));
	const sent = results.filter((r) => r.status === 'fulfilled' && r.value.status < 300).length;
	const gone = subs.filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<{ gone: boolean }>).value.gone);
	// 발송 기록을 먼저 저장한다. 구독 정리 실패가 발송 재시도를 만들지 않는다.
	await finish(sent, subs.length - sent);
	if (gone.length) await rpc('push_prune', { p_endpoints: gone.map((s) => s.endpoint) });
	return { sent };
}
