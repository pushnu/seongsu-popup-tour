import { POPUPS } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BOOK_LABEL = { required: '예약 필수', info: '예약 안내 있음', check: '확인 필요' };
const KEY = 'popup-state-v1';

// 저장 상태: {id: {want, done}} — localStorage, 로그인 없음
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
const st = (id) => state[id] || {};
function setState(id, patch) {
  state[id] = { ...st(id), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { alert('저장 공간을 쓸 수 없어 상태가 유지되지 않을 수 있어요.'); }
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

function dist(p) { // 직선거리(m). 도보거리·시간은 계산하지 않음
  if (!me) return null;
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (p.lat - me.lat) * toR, dLng = (p.lng - me.lng) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(me.lat * toR) * Math.cos(p.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
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
  return filter === 'all' || (filter === 'want' && s.want) || (filter === 'todo' && !s.done) || (filter === 'done' && s.done) || (filter === 'book' && p.booking);
};
function visible() {
  const v = POPUPS.filter(matches);
  if (me) v.sort((a, b) => dist(a) - dist(b));
  return v;
}

// ---- 지도 (Leaflet + OpenStreetMap, 키 불필요. 타일은 캐시하지 않음) ----
const map = L.map('map', { zoomControl: false }).fitBounds(groups.map((g) => [g.lat, g.lng]), { padding: [30, 30] });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const markerLayer = L.layerGroup().addTo(map);
let meMarker = null;

function pinClass(items) {
  if (items.some((p) => st(p.id).want && !st(p.id).done)) return 'star';
  if (items.every((p) => st(p.id).done)) return 'done';
  return '';
}
function drawMarkers(list) {
  markerLayer.clearLayers();
  for (const g of groups) {
    const items = g.items.filter((p) => list.includes(p));
    if (!items.length) continue;
    const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30],
      html: `<div class="pin ${pinClass(items)}"><span>${items.length > 1 ? items.length : ''}</span></div>` });
    L.marker([g.lat, g.lng], { icon }).addTo(markerLayer).on('click', () => openGroup(items));
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
  $('#list').innerHTML = list.length ? list.map((p) => `
    <button class="item" data-id="${p.id}">
      <b>${esc(p.name)}</b>
      <span class="m">${esc(p.summary)}</span>
      <span class="m">${esc(p.satHours)} ${me ? '· ' + distText(p) : ''}</span>
      <span>${tags(p)}</span>
    </button>`).join('') : '<p class="small">조건에 맞는 팝업이 없어요.</p>';
}
$('#list').addEventListener('click', (e) => {
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
      <button class="primary" id="nav">네이버 지도 길찾기</button>
      <a class="primary" id="gnav" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking" target="_blank" rel="noopener">구글 지도 길찾기</a>
      <button id="want" class="${s.want ? 'on' : ''}">${s.want ? '★ 저장됨' : '☆ 가고 싶은 곳'}</button>
      <button id="done" class="${s.done ? 'on' : ''}">${s.done ? '✓ 방문 완료' : '방문 완료'}</button>
    </div>
    <p class="small">길찾기는 각 지도 앱으로 열고, 앱이 없으면 웹으로 연결돼요. 인터넷이 필요합니다.
      <a href="https://map.naver.com/p/search/${encodeURIComponent(p.address)}" target="_blank" rel="noopener">네이버 지도에서 주소 검색</a></p>`;
  const back = $('#back'); if (back) back.onclick = () => openGroup(g.items);
  $('#nav').onclick = () => naver(p);
  $('#want').onclick = () => { setState(p.id, { want: !s.want }); openPopup(p); render(); };
  $('#done').onclick = () => { setState(p.id, { done: !s.done }); openPopup(p); render(); };
  sheet.classList.add('show');
  if (view === 'map') map.panTo([p.lat, p.lng]);
}
$('#close').onclick = () => sheet.classList.remove('show');

function naver(p) {
  const name = encodeURIComponent(p.name);
  const app = `nmap://route/walk?dlat=${p.lat}&dlng=${p.lng}&dname=${name}&appname=${encodeURIComponent(location.origin)}`;
  // shortcut: 네이버 웹 길찾기 URL은 비공식 형식(EPSG:3857 좌표). 안 열리면 카드의 주소 검색 링크를 사용. 공식 문서가 생기면 교체
  const x = (p.lng * 20037508.34) / 180, y = (Math.log(Math.tan(((90 + p.lat) * Math.PI) / 360)) * 20037508.34) / Math.PI;
  const web = `https://map.naver.com/p/directions/-/${x.toFixed(1)},${y.toFixed(1)},${name},,PLACE_POI/-/walk`;
  const t = setTimeout(() => { if (!document.hidden) location.href = web; }, 1500);
  document.addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
  location.href = app;
}

// ---- 내 위치: 권한은 버튼을 눌렀을 때 요청. 이미 허용돼 있으면 시작부터 표시하고 계속 따라감 ----
let watchId = null;
function locate(follow) {
  if (!navigator.geolocation) return alert('이 기기에서는 위치를 쓸 수 없어요.');
  if (follow) $('#fab').textContent = '찾는 중…';
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition((pos) => {
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $('#fab').textContent = '내 위치';
    const icon = L.divIcon({ className: '', iconSize: [18, 18], html: '<div class="me"></div>' });
    if (meMarker) meMarker.setLatLng([me.lat, me.lng]); else meMarker = L.marker([me.lat, me.lng], { icon, zIndexOffset: 1000 }).addTo(map);
    if (follow) { map.setView([me.lat, me.lng], Math.max(map.getZoom(), 15)); follow = false; }
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
  if (view === 'map') map.invalidateSize();
};
$('#q').oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
$('#chips').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f;
  $('#chips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  render();
};

// ---- 오프라인 표시 + 서비스 워커 ----
const offline = () => { $('#offline').style.display = navigator.onLine ? 'none' : 'block'; };
addEventListener('online', offline); addEventListener('offline', offline); offline();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

render();
