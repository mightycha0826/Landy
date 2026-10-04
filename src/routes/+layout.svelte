<script lang="ts">
	// 서체 (Phase 38) — 본문 · 화면 글자는 원티드 산스(가변 굵기, 글자 범위별로 나눈 파일이라 화면에 쓰인 글자 묶음만 받는다),
	//   로고 · 큰 제목은 파셜산스(Phase 56, app.css 의 @font-face). 모두 자체 호스팅 (CSP font-src 'self' 그대로)
	import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
	import '../app.css';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { hasSupabase } from '$lib/supabase';
	import { S, UI, init, retryAccount, startClock, toasts } from '$lib/state.svelte';
	import Maintenance from '$lib/ui/Maintenance.svelte';
	import OfflineBar from '$lib/ui/OfflineBar.svelte';
	import { loadThemeColor } from '$lib/themeColor.svelte';
	import { loadTheme } from '$lib/theme.svelte';
	import { loadPrefs } from '$lib/prefs.svelte';
	import { listenServiceWorker } from '$lib/push';
	import { notifyInApp } from '$lib/inapp.svelte';
	import InAppBanner from '$lib/ui/InAppBanner.svelte';
	import BadgeSheet from '$lib/ui/BadgeSheet.svelte';
	import { closeBadge } from '$lib/badgeSheet.svelte';
	import { afterNavigate, beforeNavigate, onNavigate } from '$app/navigation';
	import { markNavigating, navigateFromOverlay } from '$lib/overlay.svelte';
	import { MOTION, navigationMotion, reducedMotion } from '$lib/motion';
	import { holdKnock, knockFresh, viaMailbox } from '$lib/letters/mailbox.svelte';
	import { dismissKeyboard, dismissOnTap, trackKeyboard } from '$lib/keyboard.svelte';

	let { children } = $props();
	let updateReady = $state(false);
	let waitingWorker: ServiceWorker | null = null;
	function updateApp() {
		if (!waitingWorker) return;
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
		waitingWorker.postMessage({ type: 'activate-update' });
	}

	// 테마 색상 · 화면 모드 · 이 기기 설정(글자 크기 등, Phase 43) — 첫 화면을 그리기 전에 입힌다 (운영자 화면은 서버에서도 그려지므로 브라우저에서만)
	if (browser) {
		loadThemeColor();
		loadTheme();
		loadPrefs();
	}

	const isPublic = $derived(page.url.pathname.startsWith('/legal/'));
	const isPreview = $derived(import.meta.env.DEV && page.url.pathname.startsWith('/dev/'));
	const isAdmin = $derived(page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/'));

	// 운영자 화면에서는 학생 앱을 부팅하지 않는다 — 접속 신호(heartbeat)·알림 구독이
	// 이 브라우저의 학생 계정으로 나가면 실시간 현황에 운영진이 "접속 중"으로 잘못 뜬다
	$effect(() => {
		if (isPreview) startClock();
		if (!isAdmin && !isPublic && !isPreview) void init();
	});

	// 겹친 창(시트 등)이 열린 채 다른 화면으로 가면 — 사라지는 창이 history.back() 으로 그 이동을 취소하지 않게 (lib/overlay.svelte.ts)
	beforeNavigate((nav) => {
		if (nav.from?.url.pathname === '/letters' && nav.to?.url.pathname.startsWith('/letters/m/') && knockFresh()) holdKnock(nav.complete);
		if (nav.type !== 'popstate' && nav.type !== 'leave') markNavigating(true);
		// 다른 화면으로 가면 입력은 끝 — 아이폰은 입력칸이 사라져도 키보드가 남는다 (lib/keyboard.svelte.ts)
		if (nav.type !== 'leave') dismissKeyboard();
	});
	afterNavigate(() => {
		markNavigating(false);
		closeBadge(); // 남의 메달 자세히(BadgeSheet)는 화면을 옮기면 닫는다
	});

	// iOS WebKit 은 문서에 touchstart 리스너가 있어야 :active 를 그린다 — 빈 리스너 하나로 모든 누름 반응을 켠다 (UX G2)
	$effect(() => {
		const noop = () => {};
		document.addEventListener('touchstart', noop, { passive: true });
		return () => document.removeEventListener('touchstart', noop);
	});

	// 휴대폰 키보드 (Phase 41) — 보이는 영역 · 키보드 높이를 <html> 에 적어 두고 화면들이 그 값에 맞춘다 (lib/keyboard.svelte.ts)
	$effect(() => {
		if (isAdmin) return;
		return trackKeyboard();
	});
	// 입력 중에 버튼 · 링크 · 고르기 항목을 누르면 키보드를 내린다 (Phase 46) — 운영자 화면도
	$effect(() => dismissOnTap());

	// PWA 설치 프롬프트를 잡아둔다 (Android/Chrome)
	$effect(() => {
		const onPrompt = (e: Event) => {
			e.preventDefault();
			UI.installEvt = e as BeforeInstallPromptEvent;
		};
		window.addEventListener('beforeinstallprompt', onPrompt);

		if (import.meta.env.PROD && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').then((registration) => {
				const check = () => { waitingWorker = registration.waiting; updateReady = !!waitingWorker; };
				check();
				registration.addEventListener('updatefound', () => {
					registration.installing?.addEventListener('statechange', check);
				});
			}).catch(() => {});
			// 설치한 앱(홈 화면 앱)으로 떠 있으면 서비스워커에 알린다 — 알림을 누르면 브라우저 탭 말고 이 앱으로 열게
			if (window.matchMedia('(display-mode: standalone)').matches) {
				navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'standalone' })).catch(() => {});
			}
		}
		return () => window.removeEventListener('beforeinstallprompt', onPrompt);
	});

	// ── 서비스워커 (Phase 35) — 앱이 떠 있을 때 온 푸시는 앱 안 알림으로, 알림을 누르면 새로고침 없이 그 화면으로 ──
	$effect(() => {
		if (isAdmin) return;
		return listenServiceWorker({
			push: (n) => {
				if (!S.session) return;
				notifyInApp(
					{ key: n.tag, title: n.title, body: n.body, url: viaMailbox(n.url), kind: n.kind === 'other' ? 'notice' : n.kind },
					`${n.tag}|${n.body.slice(0, 60)}`
				);
			},
			open: (url) => void navigateFromOverlay(viaMailbox(url))
		});
	});

	// ── 화면 넘김 (Phase 35) — 새 화면이 뜰 때 이전 화면이 부드럽게 겹쳐 사라진다 (View Transitions, 지원 브라우저만).
	//    데이터를 받는 동안에도 이전 화면이 남아 있다가 넘어가서, 빈 화면이 번쩍이지 않는다.
	let activeTransition: ViewTransition | undefined;
	let motionRevision = 0;
	onNavigate((nav) => {
		activeTransition?.skipTransition();
		const revision = ++motionRevision;
		delete document.documentElement.dataset.nav;
		if (reducedMotion() || isAdmin) return;
		const from = nav.from?.url.pathname ?? '';
		const to = nav.to?.url.pathname ?? '';
		if (from === to) return;
		// 우체통에서 편지를 꺼낼 때(Phase 79)는 넘김 없이 — 편지 화면이 같은 자리의 같은 우체통으로 이어 받는다
		if (from === '/letters' && to.startsWith('/letters/m/') && knockFresh()) return;
		// Older browsers still get an arrival, without remounting pages or touching scroll restoration.
		if (!document.startViewTransition) return () => {
			if (reducedMotion() || revision !== motionRevision) return;
			document.querySelector('.page, .chat')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.enter, easing: 'ease-out' });
		};
		const dir = navigationMotion(from, to, nav.type === 'popstate' ? nav.delta : undefined);
		document.documentElement.dataset.nav = dir;
		return new Promise<void>((resolve) => {
			const vt = document.startViewTransition(async () => {
				resolve();
				await nav.complete.catch(() => {}); // 다른 곳으로 곧바로 옮겨 가 이 이동이 취소돼도 오류로 남기지 않는다
			});
			activeTransition = vt;
			vt.ready.catch(() => {});
			void vt.finished.catch(() => {}).finally(() => {
				if (revision !== motionRevision) return;
				activeTransition = undefined;
				delete document.documentElement.dataset.nav;
			});
		});
	});

	// ── 라우팅 가드 ───────────────────────────────────────────────
	// !S.booted 동안에는 판단을 보류하고 스플래시를 띄운다 (리다이렉트 플리커 방지)
	$effect(() => {
		if (!S.booted) return;

		const path = page.url.pathname;
		if (path.startsWith('/legal/')) return;
		if (path.startsWith('/admin')) return; // 운영자 대시보드는 자체 가드를 쓴다
		if (import.meta.env.DEV && path.startsWith('/dev')) return; // 개발용 미리보기는 로그인 불필요

		// 1) 브라우저에서 열면 설치 안내만 보여준다
		if (!UI.standalone) {
			if (path !== '/install') void goto('/install', { replaceState: true });
			return;
		}
		if (path === '/install') {
			void goto('/', { replaceState: true });
			return;
		}

		// 2) 로그인
		const onLogin = path === '/login';
		if (!S.session) {
			if (!onLogin) void goto('/login', { replaceState: true });
			return;
		}
		if (onLogin) {
			void goto(UI.afterLogin ?? '/', { replaceState: true });
			return;
		}
		UI.afterLogin = null;
		if (S.profileLoading || S.bootError) return;

		// 3) 온보딩 (성별·선호를 정해야 매칭이 가능하다) · 이름 (명단에 없으면 적어야 편지를 쓸 수 있다, Phase 23)
		const onOnboarding = path === '/onboarding';
		if (S.profile && (!S.profile.onboarded || S.me === null)) {
			if (!onOnboarding) void goto('/onboarding', { replaceState: true });
		} else if (onOnboarding && S.profile?.onboarded) {
			void goto('/', { replaceState: true });
		}
	});
</script>

{#if isAdmin || isPublic || isPreview}
	<!-- 운영자 화면: 서버에서 그려지고 자체 가드(hooks.server.ts)를 쓴다. 학생용 부팅·설치 게이트 없음. -->
	{@render children()}
{:else if !hasSupabase}
	<div class="page setup">
		<h1 class="title">설정이 필요해요</h1>
		<p class="muted">
			프로젝트 루트에 <code>.env</code> 파일을 만들고
			<code>PUBLIC_SUPABASE_URL</code> 과 <code>PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> 를 넣어 주세요.
			<code>.env.example</code> 을 복사하면 됩니다.
		</p>
	</div>
{:else if S.bootError && UI.standalone}
	<div class="page setup" role="alert">
		<h1 class="title">잠시 연결이 끊겼어요</h1>
		<p>{S.bootError}</p>
		<button class="btn" onclick={() => void retryAccount()} disabled={S.profileLoading}>다시 시도</button>
	</div>
{:else if S.maint && S.session}
	<!-- 서버 점검 (Phase 52) — 앱 전체를 가린다. 끝나면 다음 박동(1분)이나 앱으로 돌아올 때 저절로 풀린다 -->
	<Maintenance msg={S.maint.msg} until={S.maint.until} />
{:else if !S.booted || (S.session && S.profileLoading)}
	<!-- 부팅 중 · 로그인 직후 계정을 불러오는 중 (홈이 잠깐 보였다가 온보딩으로 튀지 않게) -->
	<div class="splash">
		<img class="appicon" src="/icon-192.png" alt="" width="72" height="72" />
		<span class="wordmark">Landy</span>
	</div>
{:else}
	{#key S.accountVersion}
		{@render children()}
	{/key}
{/if}

{#if !isAdmin}
	{#if updateReady}<div class="update-note" role="status">새 버전이 준비됐어요 <button onclick={updateApp}>업데이트</button></div>{/if}
	<OfflineBar />
	<InAppBanner />
	<!-- 대화 상대 메달 자세히 (Phase 44) — 프로필 시트 위에도 뜨게 맨 위에 하나 -->
	<BadgeSheet />
{/if}

<!-- 화면 아래 알림 — 한 장만, 새 알림이 오면 그 자리에서 바뀐다 (Phase 35) -->
<div class="toasts" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast" class:out={t.out}>{t.text}</div>
	{/each}
</div>

<style>
	.update-note { position: fixed; top: var(--safe-top); inset-inline: 12px; z-index: 100; padding: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
	.update-note button { margin-left: 12px; min-height: 44px; font-weight: 700; color: var(--accent); }
	.setup {
		justify-content: center;
		gap: 12px;
	}
	.setup code {
		font-size: 13px;
		background: var(--field);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.setup p {
		color: var(--text-2);
		line-height: 1.7;
		margin: 0;
	}
</style>
