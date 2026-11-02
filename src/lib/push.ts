import { env } from '$env/dynamic/public';
import { supabase } from './supabase';

/**
 * 새 메시지 푸시 알림 — 브라우저 쪽.
 *
 *  · 권한은 반드시 사용자가 버튼을 눌렀을 때 묻는다 (iOS 는 그 외에는 아예 묻지 못한다)
 *  · iOS 는 홈 화면에 설치한 앱(16.4 이상)에서만 푸시가 된다 — 이 앱은 설치해야만 동작하므로 맞는다
 *  · 로그인할 때마다 이 기기 구독을 서버에 다시 저장한다 (구독이 바뀌었거나 계정을 바꿔 로그인했을 때)
 *  · 로그아웃하면 이 기기 구독을 지운다 — 다음 사람이 앞사람 알림을 받지 않게
 */

export type PushState = 'unsupported' | 'default' | 'denied' | 'granted';

export function pushState(): PushState {
	if (
		typeof window === 'undefined' ||
		!('serviceWorker' in navigator) ||
		!('PushManager' in window) ||
		!('Notification' in window) ||
		!env.PUBLIC_VAPID_KEY
	)
		return 'unsupported';
	return Notification.permission as PushState;
}

function keyBytes(b64u: string) {
	const t = b64u.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function registration() {
	// 서비스워커는 배포 빌드에서만 등록된다 — 개발 중에는 ready 가 영원히 안 끝나므로 기다리지 않는다
	return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** 권한이 있으면 이 기기 구독을 만들고(없으면) 서버에 저장한다. */
export async function syncPush(): Promise<boolean> {
	if (pushState() !== 'granted') return false;
	const reg = await registration();
	if (!reg) return false;
	const key = keyBytes(env.PUBLIC_VAPID_KEY!);

	let sub = await reg.pushManager.getSubscription();
	// 서버 키가 바뀌었으면 옛 구독으로는 보낼 수 없다 → 새로 구독
	const old = sub?.options.applicationServerKey;
	if (sub && old && !sameBytes(new Uint8Array(old), key)) {
		await sub.unsubscribe();
		sub = null;
	}
	sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

	const j = sub.toJSON();
	const { error } = await supabase.rpc('save_push_subscription', {
		p_endpoint: j.endpoint,
		p_p256dh: j.keys?.p256dh,
		p_auth: j.keys?.auth
	});
	// 끈 알림 종류가 있으면 이 구독에도 (새로 구독했거나 지난번 저장이 실패했을 수 있다). 다 켜 둔 기기는 요청하지 않는다
	const mute = pushMuted();
	if (!error && mute.length) await supabase.rpc('set_push_mute', { p_endpoint: j.endpoint, p_mute: mute });
	return !error;
}

// ── 알림 종류별로 끄기 (Phase 43, 설정 › 알림) ──
// 이 기기에 적어 두고(화면이 바로 그린다) 서버 구독에도 보낸다 — 거르는 것은 서버(lib/server/pushSend.ts). 운영진 공지는 끌 수 없다.
export type PushKind = 'chat' | 'reaction' | 'letter' | 'crowd';
export const PUSH_KINDS: { id: PushKind; label: string }[] = [
	{ id: 'chat', label: '대화 메시지' },
	{ id: 'reaction', label: '공감' },
	{ id: 'letter', label: '편지' },
	{ id: 'crowd', label: '많은 사람이 접속했을 때' } // Phase 92
];
const MUTE_KEY = 'push-mute-v1';

export function pushMuted(): PushKind[] {
	try {
		const v: unknown = JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]');
		return Array.isArray(v) ? PUSH_KINDS.map((k) => k.id).filter((k) => v.includes(k)) : [];
	} catch {
		return [];
	}
}

/** 한 종류를 켜고 끈다 — 서버에 저장되면 끈 목록을 돌려준다 */
export async function setPushKind(kind: PushKind, on: boolean): Promise<PushKind[]> {
	const next = PUSH_KINDS.map((k) => k.id).filter((k) => (k === kind ? !on : pushMuted().includes(k)));
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription();
	if (sub) {
		const { error } = await supabase.rpc('set_push_mute', { p_endpoint: sub.endpoint, p_mute: next });
		if (error) throw error;
	}
	try {
		if (next.length) localStorage.setItem(MUTE_KEY, JSON.stringify(next));
		else localStorage.removeItem(MUTE_KEY);
	} catch {
		/* 저장소를 못 쓰는 환경 — 서버에는 저장됐다 */
	}
	return next;
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** "알림 받기" 버튼에서만 부른다 (사용자 동작 안에서 권한을 물어야 한다). */
export async function enablePush(): Promise<PushState> {
	if (pushState() === 'unsupported') return 'unsupported';
	const perm = (await Notification.requestPermission()) as PushState;
	if (perm === 'granted') await syncPush().catch(() => false);
	return perm;
}

/** 알림 끄기 · 로그아웃 — 서버에서 지우고 브라우저 구독도 해제 */
export async function disablePush() {
	if (pushState() === 'unsupported') return;
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription();
	if (!sub) return;
	await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
	await sub.unsubscribe().catch(() => {});
}

/** 이 기기가 지금 알림을 받게 되어 있는지 */
export async function pushEnabled() {
	if (pushState() !== 'granted') return false;
	const reg = await registration();
	return !!(await reg?.pushManager.getSubscription());
}

/**
 * 메시지를 보낸 직후 — 상대에게 알림을 보내 달라고 서버에 알린다. 기다리지 않는다.
 * 보낼지 말지(상대가 앱을 보고 있는지 등)는 서버가 정한다.
 */
export function notifySent(messageId: number) {
	requestPush({ message_id: messageId });
}

/**
 * 채팅 메시지에 공감을 단 직후. 상대 메시지에 처음 단 공감만, 상대가 앱을 안 보고 있을 때만 서버가 보낸다.
 */
export function notifyReaction(messageId: number) {
	requestPush({ reaction_message_id: messageId });
}

/** 이름 편지를 보내거나 답장한 직후. 받는 쪽이 앱을 안 보고 있을 때만 서버가 보낸다 (보낸 사람은 "익명"으로만). */
export function notifyDm(msgId: number) {
	requestPush({ dm_msg_id: msgId });
}

function requestPush(body: Record<string, number>) {
	void (async () => {
		const { data } = await supabase.auth.getSession();
		const token = data.session?.access_token;
		if (!token) return;
		await fetch('/api/push', {
			method: 'POST',
			keepalive: true, // 보내자마자 앱을 닫아도 요청은 나간다
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify(body)
		});
	})().catch(() => {});
}

/**
 * 떠 있는 알림 닫기 (Phase 35) — 그 대화 · 편지를 앱에서 보면 알림 센터에 남은 옛 알림을 지운다.
 * tag = 방 id / 'dm-<편지 id>' / 'pn-' 로 시작하는 개인 공지. prefix 면 그걸로 시작하는 것 전부.
 */
export async function clearNotifications(tag: string, prefix = false) {
	try {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		const reg = await navigator.serviceWorker.getRegistration();
		const list = await reg?.getNotifications(prefix ? undefined : { tag });
		for (const n of list ?? []) if (!prefix || n.tag.startsWith(tag)) n.close();
	} catch {
		/* 알림을 못 읽는 환경 */
	}
}

type SwNote = { kind: 'chat' | 'reaction' | 'letter' | 'notice' | 'crowd' | 'other'; title: string; body: string; url: string; tag: string };

/**
 * 서비스워커가 보내는 말 (Phase 35)
 *   push — 앱이 화면에 떠 있을 때 온 푸시 → 앱 안 알림으로 (애플 기기는 시스템 알림도 떴으니 바로 닫는다)
 *   open — 알림을 눌렀다 → 새로고침 없이 그 화면으로 (대답해야 서비스워커가 다시 열지 않는다)
 */
export function listenServiceWorker(on: { push: (n: SwNote) => void; open: (url: string) => void }) {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
	const handler = (e: MessageEvent) => {
		const d = e.data as { type?: string; note?: SwNote; shown?: boolean; url?: string } | null;
		if (d?.type === 'push' && d.note) {
			if (d.shown) void clearNotifications(d.note.tag);
			on.push(d.note);
		} else if (d?.type === 'open' && typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//')) {
			e.ports[0]?.postMessage('ok');
			on.open(d.url);
		}
	};
	navigator.serviceWorker.addEventListener('message', handler);
	return () => navigator.serviceWorker.removeEventListener('message', handler);
}
