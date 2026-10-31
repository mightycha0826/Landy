/** Landy 2026-10-31 campaign. Exact brand asset, editable HTML, connected covers. */
import { readFile, writeFile, rename, mkdir, mkdtemp, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs/marketing/instagram/renewal-2026-10-31');
const source = join(out, 'source');
const scratch = await mkdtemp(join(tmpdir(), 'landy-instagram-renewal-'));
await mkdir(source, { recursive: true });
const logoBytes = await readFile(join(root, 'branding/icon-source.png'));
const logo = `data:image/png;base64,${logoBytes.toString('base64')}`;
const wanted = (await readFile(join(root, 'node_modules/wanted-sans/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2'))).toString('base64');
const pen = (await readFile(join(root, 'node_modules/@fontsource/nanum-pen-script/files/nanum-pen-script-korean-400-normal.woff2'))).toString('base64');
const colors = { ink: '#1e1e1e', paper: '#fff8ef', pink: '#ffb9d8', hot: '#f52f8b', peach: '#ffd4a6' };
const mark = (cls = '') => `<img class="mark ${cls}" src="${logo}" alt="Landy 새 로고">`;
const star = (cls = '') => `<svg class="star ${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0Q54 45 100 50Q54 54 50 100Q46 54 0 50Q46 45 50 0Z" fill="currentColor"/></svg>`;
const bubble = (side, text) => `<div class="bubble ${side}"><svg class="bubble-shape" aria-hidden="true"><path/></svg><span>${text}</span></div>`;
const chat = (cls = '', first = '안녕,<br>무슨 노래 들어?', second = '나도 그 노래 좋아!') => `<div class="chat-art ${cls}" aria-hidden="true">${bubble('one', first)}${bubble('two', second)}</div>`;
const envelope = (cls = '', open = false) => `<svg class="envelope ${cls}" viewBox="0 0 720 520" aria-hidden="true"><defs><linearGradient id="paper" x2=".8" y2="1"><stop stop-color="#fffaf1"/><stop offset="1" stop-color="#ffdbb9"/></linearGradient><linearGradient id="seal" x2=".8" y2="1"><stop stop-color="#ff9ed8"/><stop offset="1" stop-color="#f52f8b"/></linearGradient></defs>${open ? '<path d="M42 190L360 4L678 190" fill="#ef9bbc" stroke="#1e1e1e" stroke-width="4"/><rect x="120" y="45" width="480" height="345" rx="8" fill="#fff8ef"/><path d="M177 115H540M177 158H492M177 201H524" stroke="#e7c5b7" stroke-width="5"/>' : ''}<rect x="42" y="190" width="636" height="300" rx="24" fill="url(#paper)" stroke="#1e1e1e" stroke-width="4"/><path d="M46 474L279 292M674 474L441 292" fill="none" stroke="#dca58d" stroke-width="3"/><path d="M43 204L360 379L677 204" fill="#ffe8d2" stroke="#1e1e1e" stroke-width="4" stroke-linejoin="round"/><circle cx="360" cy="365" r="48" fill="url(#seal)"/><path d="M340 363L354 377L381 350" fill="none" stroke="#fff8ef" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ribbon = (cls = '') => `<svg class="ribbon ${cls}" viewBox="0 0 1080 430" aria-hidden="true"><defs><linearGradient id="r" x2="1" y2=".5"><stop stop-color="#ffd4a6"/><stop offset=".5" stop-color="#ff99d4"/><stop offset="1" stop-color="#f52f8b"/></linearGradient></defs><path d="M-120 270C120 90 220 410 480 235S850 120 1210 295" fill="none" stroke="url(#r)" stroke-width="56" stroke-linecap="round"/></svg>`;
const timeline = `<div class="timeline" aria-hidden="true"><span>첫 대화</span><i></i><span>서로 동의</span><i></i><span>조금 더</span></div>`;
const connection = `<svg class="connection" viewBox="0 0 900 500" aria-hidden="true"><defs><linearGradient id="c"><stop stop-color="#f52f8b"/><stop offset="1" stop-color="#ffba8c"/></linearGradient></defs><path d="M95 320C220 320 180 95 450 95S680 360 810 220M95 320C235 535 575 460 810 220" fill="none" stroke="url(#c)" stroke-width="9"/><g fill="#fff8ef" stroke="#1e1e1e" stroke-width="4"><circle cx="95" cy="320" r="62"/><circle cx="450" cy="95" r="62"/><circle cx="810" cy="220" r="62"/></g><g fill="#f52f8b"><circle cx="95" cy="305" r="16"/><circle cx="450" cy="80" r="16"/><circle cx="810" cy="205" r="16"/><path d="M65 350Q95 309 125 350M420 125Q450 84 480 125M780 250Q810 209 840 250"/></g></svg>`;

const css = `
@font-face{font-family:Wanted;src:url(data:font/woff2;base64,${wanted});font-weight:100 1000;font-display:block}
@font-face{font-family:Pen;src:url(data:font/woff2;base64,${pen});font-weight:400;font-display:block}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Wanted,'Malgun Gothic',sans-serif;color:${colors.ink};background:${colors.paper};-webkit-print-color-adjust:exact;print-color-adjust:exact}h1,p{margin:0}svg{display:block}img{display:block} .slide{position:relative;width:1080px;height:1440px;overflow:hidden;isolation:isolate;break-after:page;background:${colors.paper}}.slide:last-child{break-after:auto}.slide.dark{background:${colors.ink};color:${colors.paper}}.slide.pink{background:${colors.pink}}.slide.peach{background:${colors.peach}}
.mast{position:absolute;left:88px;right:88px;top:66px;display:flex;justify-content:space-between;align-items:center;font-size:26px;font-weight:600;letter-spacing:-.3px;z-index:4}.mast b{font-size:36px;font-weight:820;letter-spacing:-1.7px}.mast .series{opacity:.7}.rule{position:absolute;left:88px;right:88px;top:127px;height:1px;background:currentColor;opacity:.25}.headline{position:absolute;left:88px;right:78px;top:198px;font-size:106px;font-weight:820;line-height:1.16;letter-spacing:-5.8px;z-index:3}.headline em{font-style:normal;color:${colors.hot}}.pink .headline em,.pink .handnote{color:#b81761}.dark .headline em{color:${colors.pink}}.headline.large{font-size:126px;letter-spacing:-7px}.headline.small{font-size:96px}.copy{position:absolute;left:88px;right:88px;bottom:122px;font-size:41px;line-height:1.53;letter-spacing:-1.2px;font-weight:500;z-index:3}.copy strong{font-weight:760}.footer{position:absolute;left:88px;right:88px;bottom:55px;display:flex;justify-content:space-between;align-items:center;font-size:23px;font-weight:600;letter-spacing:.1px;opacity:.63;z-index:4}.footer .next{font-size:28px;opacity:1}.visual{position:absolute;left:88px;right:88px;top:570px;height:535px}.mark{width:100%;height:100%;object-fit:contain}.star{position:absolute;width:66px;height:66px;color:${colors.hot}}.dark .star{color:${colors.peach}}.connection{position:absolute;left:0;top:10px;width:904px;height:502px}.chat-art{position:absolute;width:860px;height:500px;left:20px;top:0}.bubble{position:absolute;padding:45px 52px;border:3px solid ${colors.ink};border-radius:42px;font-size:49px;line-height:1.3;letter-spacing:-1.8px;font-weight:680};border-bottom:3px solid ${colors.ink};transform:skewY(-22deg) rotate(34deg);border-radius:0 0 9px 0}.bubble.one{left:0;top:16px;background:${colors.paper};transform:rotate(-5deg)}.bubble.two{right:10px;top:265px;background:${colors.pink};transform:rotate(4deg)}.chat-dot{position:absolute;right:15px;top:60px;color:${colors.hot};font-size:150px;line-height:1;letter-spacing:6px}.dark .bubble{color:${colors.ink}}.envelope{position:absolute;width:730px;height:527px;left:88px;top:-45px;transform:rotate(-8deg)}.envelope.open{top:-15px;transform:rotate(5deg)}.ribbon{position:absolute;left:-88px;top:0;width:1080px;height:430px}.timeline{position:absolute;left:0;right:0;top:145px;display:flex;align-items:center;gap:22px;font-size:43px;font-weight:720;letter-spacing:-2px}.timeline span{flex-shrink:0}.timeline i{height:3px;background:currentColor;flex:1;position:relative}.timeline i:after{content:'';position:absolute;right:0;top:-6px;width:14px;height:14px;border-top:3px solid;border-right:3px solid;transform:rotate(45deg)}.handnote{position:absolute;font-family:Pen;font-size:68px;letter-spacing:-1px;line-height:1.2;font-weight:400;transform:rotate(-7deg);color:${colors.hot};left:270px;top:265px}.big-plus{position:absolute;left:0;right:0;top:100px;text-align:center;font-size:155px;font-weight:700;letter-spacing:-10px}.big-plus small{font-size:68px;vertical-align:middle;letter-spacing:-3px}.detail-lines{position:absolute;left:0;right:0;top:60px}.detail-line{display:flex;gap:34px;align-items:baseline;border-bottom:2px solid #1e1e1e26;padding:26px 0;font-size:51px;line-height:1.35;letter-spacing:-2px;font-weight:670}.detail-line span{font-size:29px;color:${colors.hot};letter-spacing:0}.closing .headline{font-size:105px}.closing .visual{top:610px;height:530px}.closing .mark{position:absolute;width:540px;height:540px;left:180px;top:-20px}.closing .star{left:35px;top:125px;width:65px}.closing .star.second{left:auto;right:0;top:320px;width:40px}.closing .copy{font-size:39px}.duo{display:flex;gap:28px;position:absolute;top:14px;left:0;right:0;height:455px}.duo article{position:relative;flex:1;border-top:3px solid;padding-top:27px}.duo h2{font-size:47px;letter-spacing:-2px;margin:0}.duo p{font-size:31px;line-height:1.5;letter-spacing:-1px;margin:14px 0 0}.duo .mini-chat{position:absolute;left:10px;top:230px;width:345px;height:158px;border:3px solid;border-radius:34px;background:${colors.pink};display:grid;place-items:center;font-size:65px;font-weight:700;transform:rotate(-5deg)}.duo .envelope{left:-17px;top:135px;width:420px;height:303px;transform:rotate(7deg)}.pen-letter{position:absolute;left:120px;top:10px;width:620px;height:450px;background:${colors.paper};padding:65px;transform:rotate(-6deg);box-shadow:16px 18px 0 #1e1e1e10}.pen-letter p{font-family:Pen;font-size:69px;line-height:1.25;color:${colors.ink}}.pen-letter small{display:block;font-family:Wanted;font-size:28px;text-align:right;margin-top:35px;color:#8c4f65}.hints{position:absolute;left:0;right:0;top:70px;display:flex;gap:24px;align-items:center}.hint{flex:1;height:240px;border:3px solid;border-radius:160px;display:grid;place-items:center;font-size:45px;letter-spacing:-2px;font-weight:720;transform:rotate(-9deg)}.hint:nth-child(2){background:${colors.ink};color:${colors.pink};transform:translateY(70px) rotate(7deg)}.hint:nth-child(3){background:${colors.pink};transform:rotate(-3deg)}
.overview{position:relative;width:3240px;height:1440px;background:${colors.ink};color:${colors.paper};overflow:hidden;isolation:isolate}.pano-art{position:absolute;inset:0;width:3240px;height:1440px;z-index:0}.tile{position:absolute;top:0;width:1080px;height:1440px}.tile .headline{font-size:119px;top:220px;line-height:1.17;letter-spacing:-6px}.tile .headline .brand-word{font-size:179px;font-weight:820;letter-spacing:-10px;line-height:1.1}.tile .subtitle{position:absolute;left:88px;top:535px;font-size:35px;letter-spacing:-1px;font-weight:450;line-height:1.5;color:#d6ccc6}.tile .footer{opacity:1;color:#d6ccc6;bottom:61px;font-size:26px}.tile .footer strong{color:${colors.pink};font-weight:650}.cover-chat{top:710px;left:105px;transform:rotate(-8deg);width:780px}.cover-chat .bubble{font-size:43px;padding:32px 43px}.cover-chat .bubble.one{top:0;left:20px}.cover-chat .bubble.two{top:195px;right:20px}.cover-chat .chat-dot{display:none}.cover-envelope{left:1260px;top:665px;width:720px;transform:rotate(8deg)}.pano-logo{position:absolute;left:2320px;top:645px;width:720px;height:720px;z-index:2;mix-blend-mode:lighten}.cover-star{left:919px;top:676px;width:58px;height:58px;color:${colors.peach}}.cover-star.second{left:2044px;top:730px;width:36px;height:36px;color:${colors.pink}}.overview .bubble{color:#1e1e1e}.overview .tile:nth-of-type(3) .subtitle{top:610px}.overview .mast{font-size:25px}.overview .rule{opacity:.24}.cover img{width:1080px;height:1440px}
.headline{top:155px}.copy,.closing .copy{font-size:48px;line-height:1.45;bottom:115px}.visual{top:530px}.closing .visual{top:590px}.tile .headline{top:190px}.duo article{border:0}.duo h2{font-size:56px}.duo .mini-chat{top:160px}.duo .envelope{top:65px}
.bubble{border:0;background:none!important;isolation:isolate}.bubble span{position:relative;z-index:1}.bubble-shape{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.bubble-shape path{fill:var(--bubble-fill);stroke:${colors.ink};stroke-width:3;stroke-linejoin:round}.bubble.one{--bubble-fill:${colors.paper}}.bubble.two{--bubble-fill:${colors.pink}}
@page{size:1080px 1440px;margin:0}@media screen{body{background:#d9d2cb}.slide{margin:24px auto}.overview{margin:0}}@media print{.slide{margin:0}}
`;

const pano = `<div class="overview"><svg class="pano-art" viewBox="0 0 3240 1440" aria-hidden="true"><defs><linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ffd4a6"/><stop offset=".37" stop-color="#ffabda"/><stop offset=".68" stop-color="#f52f8b"/><stop offset="1" stop-color="#ffc5a1"/></linearGradient></defs><path d="M-180 1140C260 1390 510 1100 880 1130S1440 1435 1820 1200S2230 1000 2500 1190S3020 1350 3420 1020" fill="none" stroke="url(#trail)" stroke-width="77"/><path d="M-180 1140C260 1390 510 1100 880 1130S1440 1435 1820 1200S2230 1000 2500 1190S3020 1350 3420 1020" fill="none" stroke="#fff8ef" stroke-width="2" transform="translate(0,-60)" opacity=".27"/></svg>${[
  '우리학교,<br>더 가까이.',
  '이름보다<br>이야기 먼저.',
  '첫마디는,<br><span class="brand-word">Landy.</span>'
].map((title, i) => `<div class="tile" style="left:${i * 1080}px"><h1 class="headline">${title}</h1></div>`).join('')}${chat('cover-chat')}${envelope('cover-envelope')}${mark('pano-logo')}${star('cover-star')}${star('cover-star second')}</div>`;

const posts = [
  { folder: '01-우리학교', file: '01-Landy-Introduction', label: '우리학교 · Landy 소개', caption: '같은 학교에, 아직 모르는 친구가 있다.\n\n매일 지나치는 복도에서도, 새로운 이야기는 시작될 수 있으니까.\n충남삼성고 학생을 위한 익명 대화 앱, Landy.\n\n새로운 친구와는 랜덤채팅으로,\n마음을 전하고 싶은 친구에게는 익명편지로.\n\n홈 화면에 추가하고 학교 이메일로 인증해 시작해.\n내일 마주칠 친구와, 오늘 먼저.\n\n#Landy #랜디 #충남삼성고 #CNSA #우리학교', slides: [
    { tone: '', title: '같은 복도,<br><em>다른 이야기.</em>', art: connection, copy: '충남삼성고 친구들과<br>익명으로 시작하는 새로운 대화.' },
    { tone: 'pink', title: '이름을 몰라도,<br>말은 <em>통하니까.</em>', art: chat(), copy: '학교 이메일로 인증하고,<br>이름보다 이야기로 가까워져.' },
    { tone: '', title: '우연히 만나고.<br><em>마음을 전하고.</em>', art: `<div class="duo"><article><h2>랜덤채팅</h2><div class="mini-chat">안녕!</div></article><article><h2>익명편지</h2>${envelope()}</article></div>`, copy: '새 친구와는 채팅으로.<br>전하고 싶은 마음은 편지로.' },
    { tone: 'dark', closing: true, title: '내일 마주칠<br>친구와,<br><em>오늘 먼저.</em>', art: mark() + star() + star('second'), copy: 'Landy를 홈 화면에 추가하고<br>학교 이메일로 시작해.' }
  ] },
  { folder: '02-익명친구', file: '02-Landy-Random-Chat', label: '익명친구 · 랜덤채팅', caption: '이름보다, 이야기 먼저.\n\n무슨 노래 듣는지, 오늘 하루는 어땠는지.\n우리학교 누군가와 익명으로 첫 대화를 시작해봐.\n\n짧게 시작한 대화가 아쉽다면, 둘 다 원할 때 연장하고.\n서로 동의하며 힌트를 알아가고.\n잘 통한다면 함께 채팅을 고정해 이야기를 이어가.\n\n오늘은 어떤 친구와 말이 통할까?\n\n#Landy #랜디 #충남삼성고 #랜덤채팅 #익명친구', slides: [
    { tone: '', title: '이름은 나중에.<br><em>첫마디는 지금.</em>', art: chat(), copy: '우리학교 누군가와<br>가벼운 첫마디부터.' },
    { tone: 'pink', title: '“조금 더<br><em>얘기할래?</em>”', art: chat('', '더 얘기할래?', '좋아, 조금 더!'), copy: '짧게 시작하고,<br>둘 다 원할 때만 연장해.' },
    { tone: '', title: '한 번에 말고,<br><em>조금씩 가까이.</em>', art: '<div class="hints"><div class="hint">첫 대화</div><div class="hint">힌트</div><div class="hint">새로운 사이</div></div>', copy: '서로 동의하며,<br>힌트를 하나씩 알아가.' },
    { tone: 'dark', closing: true, title: '잘 통했다면,<br><em>다음 이야기도.</em>', art: mark() + star() + star('second'), copy: '서로 동의해 채팅을 고정하면,<br>시간 제한 없이 이어갈 수 있어.' }
  ] },
  { folder: '03-Landy', file: '03-Landy-Anonymous-Letters', label: 'Landy · 익명편지', caption: '전하고 싶었던 한마디가 있다면.\n\n그때 고마웠다는 말, 오늘도 응원한다는 말.\n입 밖으로 꺼내기 어려웠던 마음을 익명편지에 담아봐.\n\n이름으로 받을 친구를 찾고,\n내 이름 대신 나만의 서명을 남기고,\n봉투를 열고 답장을 주고받는 작은 재미까지.\n\n오늘은 누구에게 보내볼까?\n\n#Landy #랜디 #충남삼성고 #익명편지 #전하고싶은말', slides: [
    { tone: 'peach', title: '고마웠다는 말,<br><em>아직 못 했다면.</em>', art: envelope('open', true), copy: '이름으로 친구를 찾아,<br>못다 한 마음을 익명편지로.' },
    { tone: 'pink', title: '내 이름 대신,<br><em>내 마음으로.</em>', art: '<div class="pen-letter"><p>그때 도와줘서 고마워.<br>덕분에 힘이 났어!</p></div>', copy: '내 실명은 숨기고,<br>나만의 서명을 남겨봐.' },
    { tone: '', title: '한 통이,<br><em>대화가 되도록.</em>', art: envelope('open', true), copy: '편지를 열고 답장을 보내봐.' },
    { tone: 'dark', closing: true, title: '전하고 싶었던<br><em>그 한마디.</em>', art: mark() + star() + star('second'), copy: '고마움도, 응원도.<br>오늘은 누구에게 보내볼까?' }
  ] }
];
const cleanCopy = text => text.replace(/[,.]/g, '');
// Strip punctuation from visible copy only; preserve CSS, SVG decimals and data URLs.
const cleanMarkup = markup => markup.replace(/>([^<]+)</g, (_, text) => `>${cleanCopy(text)}<`);
const html = (title, body, extra = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${css}${extra}</style></head><body>${cleanMarkup(body)}</body></html>`;
const slide = s => `<section class="slide ${s.tone}${s.closing ? ' closing' : ''}"><h1 class="headline">${s.title}</h1><div class="visual">${s.art}</div><p class="copy">${s.copy}</p></section>`;

let executablePath = process.env.LANDY_PDF_BROWSER;
if (!executablePath) for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) { try { await access(p); executablePath = p; break; } catch {} }
if (!executablePath) throw new Error('Set LANDY_PDF_BROWSER to a local browser.');
const browser = await chromium.launch({ executablePath, headless: true });
async function view(name, content, width = 1080) {
  const path = join(scratch, name + '.html');
  await writeFile(path, content);
  const page = await browser.newPage({ viewport: { width, height: 1440 }, deviceScaleFactor: 1 });
  await page.route(/^https?:/, r => r.abort());
  await page.goto(pathToFileURL(path).href);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    for (const bubble of document.querySelectorAll('.bubble')) {
      const w = bubble.offsetWidth, h = bubble.offsetHeight, r = 42;
      const shape = bubble.querySelector('.bubble-shape');
      shape.setAttribute('viewBox', `0 0 ${w} ${h}`);
      // One closed silhouette: rounded body and a curved tail share the same contour.
      shape.querySelector('path').setAttribute('d', `M${r} 0H${w-r}Q${w} 0 ${w} ${r}V${h-r}Q${w} ${h} ${w-r} ${h}H142C122 ${h} 113 ${h+23} 79 ${h+32}Q73 ${h+34} 77 ${h+28}C86 ${h+17} 88 ${h+8} 88 ${h}H${r}Q0 ${h} 0 ${h-r}V${r}Q0 0 ${r} 0Z`);
    }
  });
  const editablePath = join(source, name + '.html');
  await writeFile(editablePath + '.next', await page.content());
  await rename(editablePath + '.next', editablePath);
  return page;
}
const report = [];
let coverLayout;
try {
  const overview = await view('connected-covers', html('Landy · 연결 표지', pano, '@page{size:3240px 1440px;margin:0}'), 3240);
  if (await overview.evaluate(() => /[,.]/.test(document.body.innerText))) throw new Error('Cover punctuation remains');
  coverLayout = await overview.evaluate(() => [...document.querySelectorAll('.tile')].map(tile => {
    const b = tile.getBoundingClientRect();
    const h = tile.querySelector('h1').getBoundingClientRect();
    return { title: tile.querySelector('h1').innerText, overflow: h.left < b.left + 60 || h.right > b.right - 60 || tile.querySelector('h1').scrollWidth > tile.querySelector('h1').clientWidth + 2 };
  }));
  if (coverLayout.some(s => s.overlap || s.overflow)) throw new Error(JSON.stringify(coverLayout));
  await overview.locator('.overview').screenshot({ path: join(out, 'Covers-Connected-Preview.png') });
  await overview.pdf({ path: join(out, 'Covers-Connected-Preview.pdf'), preferCSSPageSize: true, printBackground: true, tagged: true });
  await overview.close();
  for (const [i, post] of posts.entries()) {
    const imageDir = join(out, 'png', post.folder);
    await mkdir(imageDir, { recursive: true });
    const cover = await sharp(join(out, 'Covers-Connected-Preview.png')).extract({ left: i * 1080, top: 0, width: 1080, height: 1440 }).png().toBuffer();
    const content = `<section class="slide cover"><img src="data:image/png;base64,${cover.toString('base64')}" alt="${post.label} 표지"></section>` + post.slides.map(slide).join('');
    const page = await view(post.file, html(post.label, content));
    const check = await page.evaluate(() => {
      const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return { fontLoaded: document.fonts.check('800 106px Wanted'), punctuationRemaining: /[,.]/.test(document.body.innerText), redundantLabels: document.querySelectorAll('.mast,.footer,.rule,.subtitle,.handnote,small').length, slides: [...document.querySelectorAll('.slide:not(.cover)')].map(s => {
        const bounds = s.getBoundingClientRect();
        const text = [...s.querySelectorAll('.headline,.copy,.mast,.footer')];
        const overflow = text.filter(e => { const b = e.getBoundingClientRect(); return b.left < bounds.left + 50 || b.right > bounds.right - 50 || b.top < bounds.top + 35 || b.bottom > bounds.bottom - 35 || e.scrollWidth > e.clientWidth + 2; }).map(e => e.textContent);
        const title = s.querySelector('.headline').getBoundingClientRect();
        const copy = s.querySelector('.copy').getBoundingClientRect();
        const art = [...s.querySelector('.visual').children].filter(e => !e.classList.contains('star')).map(e => e.getBoundingClientRect());
        return { title: s.querySelector('h1').innerText, overflow, textOverlap: overlap(title, copy), artOverlap: art.some(b => overlap(title, b) || overlap(copy, b)), copyFont: parseFloat(getComputedStyle(s.querySelector('.copy')).fontSize) };
      }) };
    });
    if (!check.fontLoaded || check.punctuationRemaining || check.redundantLabels || check.slides.some(s => s.overflow.length || s.textOverlap || s.artOverlap || s.copyFont < 48)) throw new Error(JSON.stringify({ post: post.file, check }, null, 2));
    const pdf = await page.pdf({ path: join(out, post.file + '.pdf'), preferCSSPageSize: true, printBackground: true, tagged: true });
    const pages = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
    if (pages !== 5) throw new Error(`Unexpected PDF pages: ${pages}`);
    const pngs = [];
    for (let n = 0; n < 5; n++) {
      const file = join(imageDir, `${String(n + 1).padStart(2, '0')}.png`);
      if (n === 0) await writeFile(file, cover);
      else await page.locator('.slide').nth(n).screenshot({ path: file, animations: 'disabled' });
      const m = await sharp(file).metadata();
      if (m.width !== 1080 || m.height !== 1440) throw new Error('PNG size mismatch');
      pngs.push(file);
    }
    report.push({ post: post.file, pages, check, pngs });
    await page.close();
  }
} finally { await browser.close(); }
const joined = await sharp({ create: { width: 3240, height: 1440, channels: 3, background: colors.ink } }).composite(await Promise.all(report.map(async (r, i) => ({ input: await sharp(r.pngs[0]).removeAlpha().toBuffer(), left: i * 1080, top: 0 })))).removeAlpha().raw().toBuffer();
const original = await sharp(join(out, 'Covers-Connected-Preview.png')).removeAlpha().raw().toBuffer();
if (!joined.equals(original)) throw new Error('Cover panorama failed pixel identity check');
const thumbs = await Promise.all(report.flatMap(r => r.pngs).map(async (p, i) => ({ input: await sharp(p).resize(270, 360).toBuffer(), left: 28 + (i % 5) * 290, top: 28 + Math.floor(i / 5) * 380 })));
await sharp({ create: { width: 1486, height: 1176, channels: 3, background: '#d9d2cb' } }).composite(thumbs).png().toFile(join(out, 'All-Slides-Preview.png'));
await sharp({ create: { width: 3272, height: 1440, channels: 3, background: '#fff8ef' } }).composite(await Promise.all(report.map(async (r, i) => ({ input: await sharp(r.pngs[0]).toBuffer(), left: i * 1096, top: 0 })))).png().toFile(join(out, 'Profile-Grid-Preview.png'));
await writeFile(join(out, 'CAPTIONS.md'), '# Landy 인스타그램 리뉴얼 캡션\n\n왼쪽부터 **우리학교 / 익명친구 / Landy**. 각 게시물은 PNG 01~05 순서이며 01이 표지다.\n\n' + posts.map((p, i) => `## ${String(i + 1).padStart(2, '0')} · ${p.label}\n\n${cleanCopy(p.caption)}`).join('\n\n') + '\n\n## 제작 메모 · 복사 제외\n\n익명은 학생 간 신원 비공개를 뜻한다. 권한 있는 운영자는 안전 운영을 위해 신원·내용을 열람할 수 있다. 서비스 운영 상태와 편지 기능 개방 상태는 게시 전에 앱에서 확인한다.\n');
await writeFile(join(out, 'README.md'), `# Landy 인스타그램 리뉴얼 · 2026-10-31\n\n새 로고의 차콜·핑크·피치에 맞춘 3개 게시물, 각 5장(총 15장). 상·하단 반복 문구, 시리즈·페이지 표기, 넘김 안내, 장식용 손글씨를 삭제했다. 표지는 제목과 그래픽만, 본문은 제목과 핵심 설명 1~2줄만 남겼다. 본문 크기는 48px다. 이미지와 홍보 캡션의 쉼표·마침표는 제거했다. 기존 게시물은 상위 폴더에 보존했다.\n\n## 파일\n\n- [업로드용 PNG 15장 + 캡션 ZIP](./Landy-Instagram-Renewal-Upload.zip)\n- [연결 표지](./Covers-Connected-Preview.png) · [프로필 간격 미리보기](./Profile-Grid-Preview.png)\n- [전체 15장 미리보기](./All-Slides-Preview.png)\n- [소개 PDF](./01-Landy-Introduction.pdf) · [랜덤채팅 PDF](./02-Landy-Random-Chat.pdf) · [익명편지 PDF](./03-Landy-Anonymous-Letters.pdf)\n- [연결 표지 PDF](./Covers-Connected-Preview.pdf) · [캡션](./CAPTIONS.md)\n\n## 업로드\n\n각 폴더 안의 01.png → 05.png 순서로 한 게시물을 만든다. 01.png가 표지다.\n\n- png/01-우리학교/ — 왼쪽, Landy 소개\n- png/02-익명친구/ — 가운데, 랜덤채팅\n- png/03-Landy/ — 오른쪽, 익명편지\n\n최신 게시물이 앞에 오는 배치 기준으로 **03 → 02 → 01** 순서로 게시해 같은 줄에 놓는다. 계정의 프로필 편집/고정/업로드 미리보기에서 실제 순서와 잘림을 확인한다.\n\nPNG는 기존과 같은 **1080 × 1440px(3:4)**. 연결 원본은 **3240 × 1440px**이며 한 장을 정밀하게 3등분했다. 프로필 미리보기에는 16px 간격을 넣어 실제 분리감을 확인할 수 있다. 연결 표지 이미지는 확인용이고 업로드에는 각 폴더의 01.png를 사용한다.\n\n## 제작·검수\n\n로고는 branding/icon-source.png 원본을 직접 삽입했다. 색·형태를 다시 그리지 않았다. 연결 표지의 로고는 원본 배경색을 자연스럽게 이어 주는 lighten 합성만 적용했다. 폰트는 Wanted Sans, 손글씨는 나눔손글씨 펜. 도형·타이포그래피는 HTML/CSS/SVG로 제작해 source/의 HTML에서 수정할 수 있다. 외부 생성 이미지·서비스 화면 캡처·실제 학생 대화는 사용하지 않았다. 예시 대화와 편지 문구는 홍보용 창작이다.\n\n[제품 명세](../../../PRD.md) 기준으로 학교 인증·쌍방 연장·힌트·고정·익명편지·답장·보관 기능을 설명했다. 익명성 범위와 운영 전 확인 사항은 캡션 제작 메모에 적었다.\n\n재생성: 저장소 루트에서 \`node scripts/generate-instagram-renewal.mjs\`. 로컬 Chrome/Edge, playwright-core, sharp를 사용한다. 브라우저 경로는 LANDY_PDF_BROWSER로 지정할 수 있다. 생성 후 PNG 폴더와 CAPTIONS.md를 ZIP으로 묶는다.\n\nvalidation.json에는 로고 SHA-256, 표지 픽셀 연결 검사, PNG 크기, PDF 장수, 글꼴 로드, 텍스트 넘침·겹침 검사 결과가 담긴다. PDF는 별도로 렌더링해 시각 검수한다.\n`);
await writeFile(join(out, 'validation.json'), JSON.stringify({ logoSource: 'branding/icon-source.png', logoSHA256: createHash('sha256').update(logoBytes).digest('hex'), coverConnection: 'pixel-identical after reassembly', coverLayout, pngSize: [1080, 1440], posts: report }, null, 2));
console.log(JSON.stringify({ out, posts: report.map(r => ({ post: r.post, pages: r.pages })), connection: 'pixel-identical', preview: join(out, 'All-Slides-Preview.png') }, null, 2));
