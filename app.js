import { POPUPS } from './data.js';
import { GOOGLE_MAPS_KEY } from './config.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BOOK_LABEL = { required: '예약 필수', info: '예약 안내 있음', check: '확인 필요' };
const KEY = 'popup-state-v1', ORDER_KEY = 'popup-order-v1';

// 저장 상태: {id: {want, done}} — localStorage, 로그인 없음
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
const st = (id) => state[id] || {};
function setState(id, patch) {
  state[id] = { ...st(id), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { alert('저장 공간을 쓸 수 없어 상태가 유지되지 않을 수 있어요.'); }
}

// 가고 싶은 곳 방문 순서: id 배열. 순서가 없는 항목은 뒤에 붙음
let order = [];
try { order = JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch { order = []; }
function wantList() {
  const w = POPUPS.filter((p) => st(p.id).want);
  const o = order.map((id) => w.find((p) => p.id === id)).filter(Boolean);
  return o.concat(w.filter((p) => !o.includes(p)));
}
function saveOrder(list) { order = list.map((p) => p.id); try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch {} }
function moveWant(id, dir) {
  const l = wantList(), i = l.findIndex((p) => p.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; saveOrder(l); render();
}
function nearestOrder() { // 직선거리 기준으로 가까운 곳부터 차례로 고름(근사, 최적해 보장 안 함)
  let rest = wantList(), cur = me || rest[0]; const out = [];
  while (rest.length) { rest.sort((a, b) => between(cur, a) - between(cur, b)); cur = rest.shift(); out.push(cur); }
  saveOrder(out); render();
}
function routeUrl(list) { // 구글 지도 URL은 경유지 최대 9곳 → 앞에서 10곳까지만. origin 없으면 구글이 현재 위치를 씀
  const pts = list.slice(0, 10).map((p) => p.lat + ',' + p.lng), dest = pts.pop();
  return `https://www.google.com/maps/dir/?api=1${me ? `&origin=${me.lat},${me.lng}` : ''}&destination=${dest}${pts.length ? '&waypoints=' + pts.join('|') : ''}&travelmode=walking`;
}

// 같은 좌표는 하나의 그룹
const groups = [];
for (const p of POPUPS) {
  const k = p.lat + ',' + p.lng;
  let g = groups.find((g) => g.key === k);
  if (!g) { g = { key: k, lat: p.lat, lng: p.lng, items: [] }; groups.push(g); }
  g.items.push(p); p.group = g;
}

let filter = 'all', query = '', me = null, view = 'map';

function between(a, b) { // 직선거리(m). 도보거리·시간은 계산하지 않음
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const dist = (p) => (me ? between(me, p) : null);
const distText = (p) => { const d = dist(p); return d == null ? '' : '직선거리 약 ' + (d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km'); };

function openText(p) { // 등록 시간표(토요일) 기준만 판단. 실시간 영업 정보가 아님
  const m = /(\d{2}):(\d{2})\D+(\d{2}):(\d{2})/.exec(p.satHours);
  if (!m) return '';
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const o = +m[1] * 60 + +m[2], c = +m[3] * 60 + +m[4];
  const s = cur < o ? '시작 전' : cur >= c ? '종료' : '운영 중';
  return `11/7(토) 시간표 ${p.satHours} · 지금은 시간표상 ${s}`;
}
const lastDay = (p) => p.period.endsWith('2026-11-07');
const matches = (p) => {
  if (query && !p.name.toLowerCase().includes(query)) return false;
  const s = st(p.id);
  return filter === 'all' || (filter === 'want' && s.want);
};
function visible() {
  if (filter === 'want') return wantList().filter(matches); // 저장한 순서 유지
  const v = POPUPS.filter(matches);
  if (me) v.sort((a, b) => dist(a) - dist(b));
  return v;
}

// ---- 지도 (Google Maps JavaScript API, config.js의 키 필요. 키가 없거나 로드 실패면 목록만) ----
let map = null, markers = [], meMarker = null, line = null;
function mapFailed(msg) {
  $('#map').innerHTML = `<p class="small" style="padding:16px">${msg}</p>`;
  if (view === 'map') $('#toggle').click();
}
window.gm_authFailure = () => mapFailed('구글 지도 키가 잘못됐거나 사용 제한에 걸렸어요. config.js의 키와 허용 도메인을 확인해 주세요.');
window.__gmReady = () => {
  map = new google.maps.Map($('#map'), { mapId: 'DEMO_MAP_ID', renderingType: 'RASTER', disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, center: { lat: 37.5435, lng: 127.053 }, zoom: 15 });
  const b = new google.maps.LatLngBounds(); groups.forEach((g) => b.extend({ lat: g.lat, lng: g.lng })); map.fitBounds(b, 30);
  render();
};

function pinClass(items) {
  if (items.some((p) => st(p.id).want && !st(p.id).done)) return 'star';
  if (items.every((p) => st(p.id).done)) return 'done';
  return '';
}
function drawMarkers(list) {
  if (!map) return;
  markers.forEach((m) => (m.map = null)); markers = [];
  if (line) line.setMap(null);
  if (filter === 'want' && list.length > 1) line = new google.maps.Polyline({ map, path: (me ? [me] : []).concat(list), strokeColor: '#e8a200', strokeWeight: 4 });
  for (const g of groups) {
    const items = g.items.filter((p) => list.includes(p));
    if (!items.length) continue;
    const content = document.createElement('div');
    content.className = 'pin ' + pinClass(items);
    content.innerHTML = `<span>${filter === 'want' ? list.indexOf(items[0]) + 1 : items.length > 1 ? items.length : ''}</span>`;
    const m = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: g.lat, lng: g.lng }, content, gmpClickable: true });
    m.addEventListener('gmp-click', () => openGroup(items));
    markers.push(m);
  }
}

// ---- 목록 ----
function tags(p) {
  const s = st(p.id), t = [];
  if (s.done) t.push('<span class="tag done">방문 완료</span>');
  else if (s.want) t.push('<span class="tag star">가고 싶은 곳</span>');
  if (p.booking) t.push(`<span class="tag book">${BOOK_LABEL[p.booking.status]}</span>`);
  if (lastDay(p)) t.push('<span class="tag last">11/7 마지막 날</span>');
  if (p.group.items.length > 1) t.push(`<span class="tag">같은 위치 ${p.group.items.length}곳</span>`);
  return t.join('');
}
function drawList(list) {
  const want = filter === 'want';
  const item = (p, i) => `
    <button class="item" data-id="${p.id}">
      <b>${want ? i + 1 + '. ' : ''}${esc(p.name)}</b>
      <span class="m">${esc(p.summary)}</span>
      <span class="m">${esc(p.satHours)} ${me ? '· ' + distText(p) : ''}</span>
      <span>${tags(p)}</span>
    </button>`;
  const rows = list.map((p, i) => want ? `<div class="rowi">${item(p, i)}<button class="mv" data-mv="-1" data-id="${p.id}" aria-label="위로">↑</button><button class="mv" data-mv="1" data-id="${p.id}" aria-label="아래로">↓</button></div>` : item(p, i)).join('');
  const head = !want ? '' : list.length ? `
    <div class="route">
      <button id="near">가까운 순으로 정렬</button>
      <a class="primary" href="${routeUrl(list)}" target="_blank" rel="noopener">구글 지도로 전체 경로 열기</a>
      <p class="small">순서는 ↑↓로 바꿀 수 있고, 정렬은 직선거리 기준이라 도보 시간은 계산하지 않아요.${list.length > 10 ? ' 구글 지도는 앞의 10곳까지만 열려요.' : ''}</p>
    </div>` : '<p class="small">상세 카드의 ☆ 버튼으로 저장하면 여기서 방문 순서와 경로를 정할 수 있어요.</p>';
  $('#list').innerHTML = head + (rows || (want ? '' : '<p class="small">조건에 맞는 팝업이 없어요.</p>'));
  const near = $('#near'); if (near) near.onclick = nearestOrder;
}
$('#list').addEventListener('click', (e) => {
  const mv = e.target.closest('.mv'); if (mv) return moveWant(mv.dataset.id, +mv.dataset.mv);
  const b = e.target.closest('.item'); if (b) openPopup(POPUPS.find((p) => p.id === b.dataset.id));
});

function render() { const v = visible(); drawMarkers(v); drawList(v); }

// ---- 하단 카드 ----
const sheet = $('#sheet'), body = $('#sheet-body');
function openGroup(items) {
  if (items.length === 1) return openPopup(items[0]);
  body.innerHTML = `<h2>같은 위치 ${items.length}곳</h2><p class="small">${esc(items[0].address)}</p>` +
    items.map((p) => `<button class="item" data-id="${p.id}"><b>${esc(p.name)}</b><span class="m">${esc(p.satHours)}</span><span>${tags(p)}</span></button>`).join('');
  body.querySelectorAll('.item').forEach((b) => b.onclick = () => openPopup(POPUPS.find((p) => p.id === b.dataset.id)));
  sheet.classList.add('show');
}
function openPopup(p) {
  const s = st(p.id), g = p.group;
  const book = p.booking
    ? `<div class="book"><b>${BOOK_LABEL[p.booking.status]}</b> · ${esc(p.booking.text)}${p.booking.url ? `<br><a href="${esc(p.booking.url)}" target="_blank" rel="noopener">예약 페이지 열기</a>` : ''}</div>`
    : '<p class="small">예약 안내: 자료에 예약 정보 없음</p>';
  body.innerHTML = `
    ${g.items.length > 1 ? `<button class="small" style="min-height:36px;padding:0 10px" id="back">← 같은 위치 ${g.items.length}곳</button>` : ''}
    <h2>${esc(p.name)}</h2>
    <p class="small">${esc(p.address)}${me ? ' · ' + distText(p) : ''}</p>
    <p>${esc(p.summary)}</p>
    <p><b>기간</b> ${esc(p.period)}${lastDay(p) ? ' <span class="tag last">11/7 마지막 날</span>' : ''}</p>
    <p><b>운영시간</b> ${esc(p.week)}<br><span class="small">${esc(openText(p))} (등록 시간표 기준, 실시간 정보 아님)</span></p>
    ${(p.notes || []).map((n) => `<div class="note">${esc(n)}</div>`).join('')}
    ${book}
    <div class="actions">
      <a class="primary wide" id="gnav" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking" target="_blank" rel="noopener">구글 지도 길찾기</a>
      <a class="sec wide" href="https://popply.co.kr/popup/${p.id}" target="_blank" rel="noopener">팝플리 상세 페이지 보기</a>
      <button id="want" class="${s.want ? 'on' : ''}">${s.want ? '★ 저장됨' : '☆ 가고 싶은 곳'}</button>
      <button id="done" class="${s.done ? 'on' : ''}">${s.done ? '✓ 방문 완료' : '방문 완료'}</button>
    </div>
    <p class="small">길찾기는 구글 지도 앱으로 열고, 앱이 없으면 웹으로 연결돼요. 인터넷이 필요합니다.</p>`;
  const back = $('#back'); if (back) back.onclick = () => openGroup(g.items);
  $('#want').onclick = () => { setState(p.id, { want: !s.want }); openPopup(p); render(); };
  $('#done').onclick = () => { setState(p.id, { done: !s.done }); openPopup(p); render(); };
  sheet.classList.add('show');
  if (view === 'map' && map) map.panTo({ lat: p.lat, lng: p.lng });
}
$('#close').onclick = () => sheet.classList.remove('show');

// ---- 내 위치: 권한은 버튼을 눌렀을 때 요청. 이미 허용돼 있으면 시작부터 표시하고 계속 따라감 ----
let watchId = null;
function locate(follow) {
  if (!navigator.geolocation) return alert('이 기기에서는 위치를 쓸 수 없어요.');
  if (follow) $('#fab').textContent = '찾는 중…';
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition((pos) => {
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $('#fab').textContent = '내 위치';
    if (map) {
      if (!meMarker) { const d = document.createElement('div'); d.className = 'me'; meMarker = new google.maps.marker.AdvancedMarkerElement({ map, content: d, zIndex: 1000 }); }
      meMarker.position = me;
      if (follow) { map.panTo(me); if (map.getZoom() < 15) map.setZoom(15); follow = false; }
    }
    render();
  }, (err) => {
    $('#fab').textContent = '내 위치';
    if (follow) alert(err.code === 1 ? '위치 권한이 거부됐어요. 위치 없이도 모든 팝업을 볼 수 있어요.' : '위치를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
}
$('#fab').onclick = () => locate(true);
navigator.permissions?.query({ name: 'geolocation' }).then((r) => { if (r.state === 'granted') locate(false); }).catch(() => {});

// ---- 전환·검색·필터 ----
$('#toggle').onclick = () => {
  view = view === 'map' ? 'list' : 'map';
  document.body.classList.toggle('show-list', view === 'list');
  $('#list').classList.toggle('show', view === 'list');
  $('#toggle').textContent = view === 'map' ? '목록' : '지도';
};
$('#q').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
$('#chips').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f;
  $('#chips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  render();
};

// ---- 설치 안내: 안드로이드는 설치 버튼, 아이폰은 Safari 안내 ----
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#install').style.display = 'block'; });
$('#install-btn').onclick = () => { installEvt?.prompt(); installEvt = null; $('#install').style.display = 'none'; };
if (/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone) { $('#install').style.display = 'block'; $('#install-btn').style.display = 'none'; $('#ios').style.display = 'inline'; }

// ---- 오프라인 표시 + 서비스 워커 ----
const offline = () => { $('#offline').style.display = navigator.onLine ? 'none' : 'block'; };
addEventListener('online', offline); addEventListener('offline', offline); offline();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

render();
if (!GOOGLE_MAPS_KEY) mapFailed('구글 지도 키가 없어 목록만 보여요. config.js에 키를 넣어 주세요.');
else {
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&libraries=marker&language=ko&region=KR&loading=async&callback=__gmReady`;
  s.onerror = () => mapFailed('지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
  document.head.append(s);
}
