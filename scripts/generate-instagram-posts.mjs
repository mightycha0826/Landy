/** Three five-slide Landy introductions. Local assets/browser only. */
import {readFile,writeFile,mkdir,mkdtemp,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=join(root,'docs/marketing/instagram');
const scratch=await mkdtemp(join(tmpdir(),'landy-instagram-'));
const font=async p=>(await readFile(join(root,p))).toString('base64');
const wanted=await font('node_modules/wanted-sans/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2');
const chab=await font('src/lib/fonts/LOTTERIACHAB.woff2');
const icon=await font('static/icon-512.png');
const titles=['우리학교','익명친구','Landy'];
const imageFolders=['01-우리학교','02-익명친구','03-Landy'];
const folderGuide='## 이미지 폴더\n\n각 게시물 폴더 안의 이미지를 01.png → 05.png 순서로 업로드한다. 01.png가 표지다.\n\n```text\npng/\n  01-우리학교/  01.png ~ 05.png\n  02-익명친구/  01.png ~ 05.png\n  03-Landy/     01.png ~ 05.png\n```';
const logoAlpha='<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 -6 6 0 0" result="logo-mask"/>';
const shadowColors={violet:'#672cb0',blue:'#3452c9',rose:'#bc236c',amber:'#d96b24',white:'#ffffff'};
const filter=`<filter id="logo-transparent" color-interpolation-filters="sRGB">${logoAlpha}</filter>`+Object.entries(shadowColors).map(([name,color])=>`<filter id="logo-shadow-${name}" color-interpolation-filters="sRGB">${logoAlpha}<feFlood flood-color="${color}"/><feComposite operator="in" in2="logo-mask"/></filter>`).join('');
const envelope=cls=>`<svg class="${cls}" viewBox="0 0 600 390" aria-hidden="true"><rect x="10" y="18" width="580" height="350" rx="26" fill="#fffdf5" stroke="#ee9176" stroke-width="3"/><path d="M12 34L300 225L587 33" fill="#ffe6bd" stroke="#ee9176" stroke-width="3"/><path d="M15 347l190-147M585 347L395 200" stroke="#ee9176" stroke-width="3"/><circle cx="300" cy="227" r="39" fill="#f52a8c"/><path d="M283 226l12 12 23-26" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const logo=(cls,decorative=false)=>`<img class="${cls}" src="data:image/png;base64,${icon}" alt="${decorative?'':'Landy 로고'}"${decorative?' aria-hidden="true"':''}>`;
const css=`
@font-face{font-family:Wanted;src:url(data:font/woff2;base64,${wanted}) format('woff2');font-weight:100 1000;font-display:block}
@font-face{font-family:'Lotteria Chab';src:url(data:font/woff2;base64,${chab}) format('woff2');font-weight:400;font-display:block}
*{box-sizing:border-box}html,body{padding:0;margin:0;background:#eddaff;color:#291744;font-family:Wanted,'Malgun Gothic',sans-serif;word-break:keep-all;overflow-wrap:break-word}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:1080px 1440px;margin:0}.slide{--accent:#f52a8c;--trail:#ff8bb9;position:relative;width:1080px;height:1440px;overflow:hidden;break-after:page;background:#fff4ed}.slide:last-child{break-after:auto}.slide.lilac{--accent:#6435e6;--trail:#9756f5;background:linear-gradient(145deg,#f2d4ff,#c7b8ff)}.slide.paper{--accent:#ed4b48;--trail:#ff984d;background:linear-gradient(150deg,#fff19a,#ffdfb0)}.slide.sky{--accent:#3156d9;--trail:#37c4e0;background:linear-gradient(150deg,#e0ffed,#bcefff)}.slide.coral{--accent:#d92275;--trail:#f94f83;background:linear-gradient(150deg,#ffe0bb,#ffb5d0)}.slide.ink{--accent:#ffe871;--trail:#ff93ce;background:#5235d6;color:#fffaf7}
h1,p{margin:0}.headline{position:absolute;left:96px;right:96px;top:164px;font-size:96px;font-weight:820;line-height:1.24;letter-spacing:-4px;z-index:2}.tagline{position:absolute;left:96px;right:96px;bottom:116px;font-size:46px;font-weight:570;line-height:1.5;letter-spacing:-1px;color:#493358;z-index:2}.ink .tagline{color:#fff4fc}.brand-type{font-family:'Lotteria Chab',sans-serif;font-weight:400;letter-spacing:-2px;font-size:1.2em}
.art-letter{position:absolute;left:235px;top:598px;width:600px;height:390px;transform:rotate(-7deg);filter:drop-shadow(0 18px 24px #63387518)}.art-mark{position:absolute;left:200px;top:450px;width:680px;height:680px;filter:url(#logo-transparent)}.final .tagline{bottom:80px}.big-hello{position:absolute;left:240px;top:638px;font-size:174px;font-weight:850;letter-spacing:-7px;color:var(--accent);transform:rotate(-7deg)}.big-question{position:absolute;left:460px;top:575px;font-size:435px;font-weight:850;line-height:1;color:var(--accent);transform:rotate(8deg)}.big-quote{position:absolute;left:675px;top:552px;font-size:470px;font-weight:850;line-height:1;color:var(--accent)}.thread{position:absolute;top:560px;left:0;width:1080px;height:520px;color:var(--trail)}.ink .thread{opacity:.85}.filter-defs{position:absolute;width:0;height:0}
.slide,.tile{isolation:isolate}.watermark{position:absolute;right:-590px;bottom:-810px;width:1540px;height:1540px;opacity:.24;filter:url(#logo-shadow-violet);z-index:0;pointer-events:none;user-select:none}.sky .watermark{filter:url(#logo-shadow-blue)}.paper .watermark{filter:url(#logo-shadow-amber)}.coral .watermark{filter:url(#logo-shadow-rose)}.ink .watermark{filter:url(#logo-shadow-white)}.art-letter,.art-mark,.big-hello,.big-question,.big-quote,.thread{z-index:1}.tile{overflow:hidden}.bigword{z-index:2}
.panorama{position:absolute;top:0;left:0;width:3240px;height:1440px;overflow:hidden}.panobg{position:absolute;inset:0;width:3240px;height:1440px}.tile{position:absolute;top:0;width:1080px;height:1440px}.bigword{position:absolute;top:285px;left:86px;font-size:142px;line-height:1.14;font-weight:850;letter-spacing:-6px;color:#291744;white-space:nowrap}.bigword.brand-type{font-size:174px;font-weight:400;letter-spacing:-4px;top:266px;color:#6426c9}.boundary-envelope{position:absolute;left:791px;top:692px;width:578px;height:372px;transform:rotate(6deg);filter:drop-shadow(0 23px 24px #6e409024)}.pano-logo{position:absolute;left:2253px;top:443px;width:870px;height:870px;filter:url(#logo-transparent)}.overview{position:relative;width:3240px;height:1440px;background:#ffe578}
@media screen{.slide{margin:20px auto;box-shadow:0 5px 25px #25163015}}@media print{html,body{background:white}.slide{margin:0}}
`;
const panoBg=`<svg class="panobg" viewBox="0 0 3240 1440" aria-hidden="true"><defs>${filter}<linearGradient id="sky" x1="1" y1="0" x2="0" y2=".65"><stop stop-color="#ffe578"/><stop offset=".36" stop-color="#ffd0ec"/><stop offset=".7" stop-color="#d4b5ff"/><stop offset="1" stop-color="#b9edff"/></linearGradient><linearGradient id="trail" x1="1" x2="0"><stop stop-color="#ff674b"/><stop offset=".4" stop-color="#f52995"/><stop offset=".72" stop-color="#8a39ee"/><stop offset="1" stop-color="#4365ed"/></linearGradient></defs><rect width="3240" height="1440" fill="url(#sky)"/><ellipse cx="700" cy="785" rx="930" ry="455" fill="#fff" opacity=".13"/><ellipse cx="2170" cy="400" rx="1130" ry="495" fill="#fff" opacity=".12"/><path d="M-180 1040C170 1090 250 960 590 994S1180 1220 1590 993S2210 805 2550 981S3030 1180 3420 915" fill="none" stroke="url(#trail)" stroke-width="118" stroke-linecap="round"/></svg>`;
const panorama=`<div class="panorama">${panoBg}${titles.map((t,i)=>`<div class="tile" style="left:${i*1080}px"><h1 class="bigword ${i===2?'brand-type':''}">${t}</h1></div>`).join('')}${envelope('boundary-envelope')}${logo('pano-logo')}</div>`;
const thread='<svg class="thread" viewBox="0 0 1080 640" aria-hidden="true"><path d="M-90 424C177 196 261 517 524 340S840 179 1190 395" fill="none" stroke="currentColor" stroke-width="72" stroke-linecap="round"/></svg>';
const art=t=>({letter:envelope('art-letter'),mark:logo('art-mark'),hello:`${thread}<div class="big-hello" aria-hidden="true">안녕.</div>`,question:'<div class="big-question" aria-hidden="true">?</div>',quote:`${thread}<div class="big-quote" aria-hidden="true">“</div>`,thread})[t]||'';
const data=[
 {name:'01-Landy-Introduction',title:'우리학교 · Landy 소개',caption:'같은 학교에, 아직 모르는 친구가 있다.\n\n충남삼성고 학생을 위한 익명 대화 앱, Landy.\n랜덤채팅으로 새 친구를 만나고, 이름으로 친구를 찾아 익명편지를 보내봐.\n\n홈 화면에 추가하고 학교 이메일로 인증해 시작해.\n오늘은 어떤 친구를 알게 될까?\n\n#Landy #우리학교 #CNSA',slides:[
  {title:'같은 학교에,<br>아직 모르는<br>친구가 있다.',line:'충남삼성고 학생을 위한 익명 대화 앱.<br>랜덤채팅과 익명편지로,<br>새로운 친구에게 말을 걸어봐.',art:'quote',tone:'lilac'},
  {title:'이름보다 먼저,<br>이야기로.',line:'랜덤채팅에서는 익명으로 대화해.<br>좋아하는 노래, 오늘의 고민부터<br>너다운 이야기를 꺼내봐.',art:'hello',tone:'coral'},
  {title:'만남은 채팅으로.<br>마음은 편지로.',line:'새로운 친구는 랜덤채팅으로 만나고,<br>아는 친구에게는 이름을 찾아 익명편지를 보내.<br>너에게 편한 방법으로 시작해봐.',art:'letter',tone:'paper'},
  {title:'첫마디는,<br><span class="brand-type">Landy</span>에서.',line:'홈 화면에 Landy를 추가하고,<br>학교 이메일로 인증해 시작해.<br>오늘은 어떤 친구를 알게 될까?',art:'mark',tone:'sky'}]},
 {name:'02-Landy-Random-Chat',title:'익명친구 · 랜덤채팅',caption:'이름은 몰라도, 말은 통할 수 있으니까.\n\n우리학교 누군가와 익명으로 시작하는 랜덤채팅.\n둘 다 원할 때 대화를 연장하고, 힌트로 서로를 조금씩 알아가.\n잘 통하면 함께 채팅을 고정해 이야기를 이어갈 수도 있어.\n\n오늘은 어떤 친구를 만나게 될까?\n\n#Landy #익명친구 #랜덤채팅',slides:[
  {title:'이름은 몰라도,<br>말은 통할 수<br>있으니까.',line:'우리학교 누군가와 익명으로 연결돼.<br>서로의 이름 대신,<br>오늘 하고 싶었던 말부터.',art:'question',tone:'sky'},
  {title:'“우리, 더<br>얘기할까?”',line:'짧은 대화로 시작해.<br>둘 다 더 이야기하고 싶을 때만<br>시간을 연장할 수 있어.',art:'thread',tone:'coral'},
  {title:'궁금해질수록,<br>하나씩 가까이.',line:'대화를 이어가며 힌트가 하나씩 공개돼.<br>처음엔 몰랐던 친구의 취향과 이야기를,<br>서로의 속도로 알아가봐.',art:'quote',tone:'ink'},
  {title:'오늘은<br>어떤 친구일까?',line:'서로 동의하면 채팅을 고정할 수도 있어.<br>시간에 쫓기지 않고 이야기를 이어가봐.<br>첫 친구는, Landy에서.',art:'mark',tone:'lilac'}]},
 {name:'03-Landy-Anonymous-Letters',title:'Landy · 익명편지',caption:'고마웠다는 말, 아직 못 했다면.\n\n이름으로 받을 친구를 찾아 익명편지를 보내봐.\n받는 친구에게 내 실명은 보이지 않고, 나만의 서명을 붙일 수 있어.\n봉투를 열고 답장을 주고받는 작은 재미까지.\n\n전하고 싶었던 그 한마디는 뭐야?\n\n#Landy #익명편지 #우리학교',slides:[
  {title:'고마웠다는 말,<br>아직 못 했다면.',line:'이름으로 받을 친구를 찾고,<br>너의 마음을 익명편지에 담아 보내.<br>말로 꺼내기 어려웠던 그 한마디도.',art:'letter',tone:'paper'},
  {title:'받는 사람은 너.<br>내 이름 대신,<br>내 마음으로.',line:'받는 친구에게는 내 실명이 보이지 않아.<br>나만의 서명을 붙여,<br>내 마음이 전해지게 써봐.',art:'letter',tone:'coral'},
  {title:'한 통이,<br>대화의 시작이<br>될지도.',line:'편지를 열고 답장을 주고받을 수 있어.<br>천천히 읽고, 네 속도로 답해봐.<br>다음 봉투엔 어떤 이야기가 담길까?',art:'question',tone:'lilac'},
  {title:'전하고 싶었던<br>그 한마디.',line:'고마움도, 응원도, 조심스러운 첫인사도.<br>받고 보낸 편지는 폴더에 모아둘 수 있어.<br>오늘은 누구에게 보내볼까?',art:'mark',tone:'sky'}]}
];
const renderSlide=s=>`<section class="slide ${s.tone}${s.art==='mark'?' final':''}">${logo('watermark',true)}<h1 class="headline">${s.title}</h1>${art(s.art)}<p class="tagline">${s.line}</p></section>`;
const html=(title,body,extra='')=>`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>${css}${extra}</style></head><body><svg class="filter-defs" aria-hidden="true"><defs>${filter}</defs></svg>${body}</body></html>`;
await mkdir(join(out,'png'),{recursive:true});
let executablePath=process.env.LANDY_PDF_BROWSER;
if(!executablePath) for(const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome']){try{await access(p);executablePath=p;break;}catch{}}
if(!executablePath) throw new Error('Set LANDY_PDF_BROWSER to a local browser');
const browser=await chromium.launch({executablePath,headless:true});
const report=[];
async function viewFile(name,markup,width=1080){
 const file=join(scratch,name+'.html');await writeFile(file,markup);
 const view=await browser.newPage({viewport:{width,height:1440},deviceScaleFactor:1});
 await view.route(/^https?:/,r=>r.abort());await view.goto(pathToFileURL(file).href);await view.emulateMedia({media:'print'});await view.evaluate(()=>document.fonts.ready);return view;
}
let coverLayout;
try{
 const overview=await viewFile('cover-overview',html('우리학교 · 익명친구 · Landy',`<div class="overview">${panorama}</div>`,'@page{size:3240px 1440px;margin:0}'),3240);
 coverLayout=await overview.evaluate(()=>{
  const env=document.querySelector('.boundary-envelope').getBoundingClientRect(),mark=document.querySelector('.pano-logo').getBoundingClientRect();
  const words=[...document.querySelectorAll('.bigword')];
  const overflow=words.filter(e=>{const r=e.getBoundingClientRect(),b=e.closest('.tile').getBoundingClientRect();return r.left<b.left+60||r.right>b.right-60;}).map(e=>e.textContent);
  return {words:words.map(e=>e.textContent),font:getComputedStyle(words[2]).fontFamily,chabLoaded:document.fonts.check('174px "Lotteria Chab"'),logoWidth:mark.width,envelopeAcrossFirstSeam:env.left<1080&&env.right>1080,logoInThirdPanel:mark.left>2160&&mark.right<3240,overflow};
 });
 if(JSON.stringify(coverLayout.words)!==JSON.stringify(titles)||!coverLayout.chabLoaded||!coverLayout.font.includes('Lotteria Chab')||coverLayout.logoWidth!==870||!coverLayout.envelopeAcrossFirstSeam||!coverLayout.logoInThirdPanel||coverLayout.overflow.length)throw new Error(JSON.stringify(coverLayout));
 await overview.locator('.overview').screenshot({path:join(out,'Covers-Connected-Preview.png')});
 await overview.pdf({path:join(out,'Covers-Connected-Preview.pdf'),preferCSSPageSize:true,printBackground:true,tagged:true});await overview.close();
 const covers=await Promise.all(data.map((_,i)=>sharp(join(out,'Covers-Connected-Preview.png')).extract({left:i*1080,top:0,width:1080,height:1440}).png().toBuffer()));
 for(const [i,post]of data.entries()){
  const cover=`<section class="slide cover"><img width="1080" height="1440" src="data:image/png;base64,${covers[i].toString('base64')}" alt="${titles[i]}"></section>`;
  const view=await viewFile(post.name,html(post.title,cover+post.slides.map(renderSlide).join('')));
  const check=await view.evaluate(()=>({forbiddenContainers:document.querySelectorAll('.card,.label,.head,.foot,.kicker,.flowstep').length,slides:[...document.querySelectorAll('.slide:not(.cover)')].map(s=>{
   const b=s.getBoundingClientRect(),text=[...s.querySelectorAll('.headline,.headline span,.tagline')];
   const sizes=text.map(e=>parseFloat(getComputedStyle(e).fontSize));
   const overflow=text.filter(e=>{const r=e.getBoundingClientRect();return r.left<b.left+60||r.right>b.right-60||r.top<b.top+60||r.bottom>b.bottom-60||e.scrollWidth>e.clientWidth+2;}).map(e=>e.textContent);
   const h=s.querySelector('.headline').getBoundingClientRect(),p=s.querySelector('.tagline').getBoundingClientRect();
   const art=[...s.querySelectorAll('.art-letter,.art-mark,.big-hello,.big-question,.big-quote,.thread')].map(e=>e.getBoundingClientRect());
   return {text:s.textContent,minFont:Math.min(...sizes),overlap:h.bottom>p.top||art.some(r=>r.top<h.bottom+20||r.bottom>p.top-20),overflow};
  })}));
  if(check.forbiddenContainers||check.slides.some(s=>s.minFont<44||s.overlap||s.overflow.length))throw new Error(JSON.stringify({post:post.name,check}));
  const pdf=await view.pdf({path:join(out,post.name+'.pdf'),preferCSSPageSize:true,printBackground:true,tagged:true,outline:true});
  const pages=[...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;if(pages!==5)throw new Error('Unexpected PDF page count');
  const imageDir=join(out,'png',imageFolders[i]);await mkdir(imageDir,{recursive:true});
  const pngs=[];for(let n=0;n<5;n++){
   const dest=join(imageDir,String(n+1).padStart(2,'0')+'.png');if(n===0)await writeFile(dest,covers[i]);else {const slide=view.locator('.slide').nth(n);await slide.scrollIntoViewIfNeeded();await view.waitForTimeout(200);await slide.screenshot({path:dest,animations:'disabled'});}
   const m=await sharp(dest).metadata();if(m.width!==1080||m.height!==1440)throw new Error('Image size mismatch');pngs.push(dest);
  }
  report.push({name:post.name,pages,bytes:pdf.length,check,pngs});await view.close();
 }
 const full=sharp(join(out,'Covers-Connected-Preview.png'));for(let i=0;i<3;i++){
  const crop=await full.clone().extract({left:i*1080,top:0,width:1080,height:1440}).raw().toBuffer();if(!crop.equals(await sharp(report[i].pngs[0]).raw().toBuffer()))throw new Error('Cover seam mismatch');
 }
 const thumbs=await Promise.all(report.flatMap(r=>r.pngs).map(async(p,i)=>({input:await sharp(p).resize(216,288).toBuffer(),left:(i%5)*228,top:Math.floor(i/5)*304})));
 await sharp({create:{width:1140,height:912,channels:3,background:'#ded8e4'}}).composite(thumbs).png().toFile(join(scratch,'all-slides.png'));
}finally{await browser.close();}
const captions=['# 인스타그램 소개 캡션','프로필 왼쪽부터 **우리학교 / 익명친구 / Landy**. 일반적인 최신순 배치에서는 **03 → 02 → 01**로 게시한다. 각 게시물은 PNG 01~05 순서의 독립 캐러셀이다.',...data.map((p,i)=>`## ${String(i+1).padStart(2,'0')} · ${titles[i]}\n\n${p.caption}`),'## 제작 메모 · 캡션 복사 제외','첫 대화·첫 편지에 대한 호기심에 학교 인증·랜덤채팅·쌍방 연장·힌트·고정·익명편지·답장의 핵심 설명을 더했다. 확인되지 않은 URL·사용자 수·즉시 매칭·완전 익명 보증은 넣지 않았다. 실제 서비스 링크와 운영 상태는 게시 시 확인한다. 익명성은 학생 간 신원 비공개이며 운영 권한·정책은 앱 안내를 따른다.'].join('\n\n')+'\n';
await writeFile(join(out,'CAPTIONS.md'),captions);
const readme=['# Landy 인스타그램 소개 시리즈','‘우리학교 / 익명친구 / Landy’ 표지 3개를 연결한 시리즈다. 각 게시물은 5장이다. 2026-10-04 수정에서는 첫 대화·첫 편지를 궁금하게 만드는 문구에 핵심 기능 설명을 2~3줄씩 더하고 색감을 높였다.',data.map((p,i)=>`- [${titles[i]} · ${p.title.split(' · ')[1]}](./${p.name}.pdf)`).join('\n'),'- [연결 표지 PDF](./Covers-Connected-Preview.pdf) · [미리보기](./Covers-Connected-Preview.png)\n- [업로드용 PNG 15장 + 캡션 ZIP](./Landy-Instagram-Upload.zip)\n- [캡션·게시 순서](./CAPTIONS.md)','Landy 표지는 저장소의 **롯데리아 촵땡겨체**를 사용한다. 표지 앱 로고는 870px이며 편지는 첫 번째/두 번째 경계에서 이어진다.','분홍·코랄·레몬색·선명한 보라·하늘색을 사용한다. 각 게시물의 마지막 장 메인 로고는 680px다. 세 표지는 기존 노랑·분홍·보라·하늘색 팔레트를 복원하고 배경과 연결 곡선의 그라데이션 방향을 오른쪽에서 왼쪽으로 뒤집었다. 배경 로고 없이 편지와 곡선이 이어지도록 유지했다. 본문 12장의 오른쪽 아래에는 1,540px 로고를 배경 색감에 맞춘 단색 실루엣으로 바꾸고 불투명도 24%로 일부만 걸쳐 배치했다. 큰 타이포그래피, 여백, 곡선과 봉투·로고 구성은 유지했다. 카드형 박스·버튼·작은 라벨·영문 태그·페이지 번호는 넣지 않았다. 본문 글자는 최소 46px이며 학교 인증, 채팅 연장·힌트·고정, 편지 대상 검색·서명·답장·보관을 쉽게 설명한다.','## 게시하기','일반적인 최신순 배치에서는 **03 → 02 → 01**로 게시한다. 각 게시물은 PNG 01~05 순이며 01이 표지다. 계정의 고정/재정렬/미리보기 상태를 확인해 같은 줄에 배치한다. PNG는 1,080 × 1,440px, 3:4 비율이며 PDF는 공유용이다.','3:4 지원 참고: [Instagram 지원 발표 보도](https://9to5mac.com/2025/05/29/instagram-changes-standard-photo-aspect-ratio/). 업로드 도구에서 실제 잘림을 확인한다.','## 내용 기준·재생성','[PRD](../../PRD.md)와 [유저 플로우](../../USER-FLOWS.md)의 제품 범위를 바탕으로 했다. 근거 없는 성과·후기, 즉시 매칭·완전 익명·전달 보증, 확인되지 않은 URL/QR은 넣지 않았다. 운영 정책은 앱 안내를 따른다.','~~~powershell\nnode scripts/generate-instagram-posts.mjs\nCompress-Archive -LiteralPath \'docs/marketing/instagram/png\',\'docs/marketing/instagram/CAPTIONS.md\' -DestinationPath \'docs/marketing/instagram/Landy-Instagram-Upload.zip\' -CompressionLevel Optimal -Force\n~~~','로컬 Chrome/Edge, 프로젝트의 playwright-core·sharp와 저장소 글꼴을 사용한다. 글꼴·문구/배치·텍스트와 그림 겹침·넘침·박스 제거·PDF 장수·PNG 크기·표지 연결을 검사한다. HTML·검증 결과·전체 장 미리보기는 실행 결과의 임시 폴더에 남는다. 브라우저를 찾지 못하면 LANDY_PDF_BROWSER를 지정한다.'].join('\n\n')+'\n';
await writeFile(join(out,'README.md'),readme.replace('## 게시하기',folderGuide+'\n\n## 게시하기'));
await writeFile(join(scratch,'validation.json'),JSON.stringify({coverLayout,report,connectedCovers:'pixel-identical'},null,2));
console.log(JSON.stringify({out,scratch,coverLayout,posts:report.map(({check,pngs,...r})=>r),connectedCovers:'pixel-identical'},null,2));
