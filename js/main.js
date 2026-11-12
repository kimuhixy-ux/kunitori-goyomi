// 画面の組み立てと操作。ルールは game.js / turn.js に任せ、ここでは表示と命令の受け渡しだけをする
import * as G from './game.js';
import { endSeason } from './turn.js';
import { renderMap } from './map.js';

const DATA_FILES = { clans: 'data/clans.json', provinces: 'data/provinces.json', rules: 'data/rules.json', coast: 'data/coast.json', generals: 'data/generals.json' };

// 保存の形を変えたら番号を上げ、古い保存を読みこまないようにする
const SAVE_KEY = 'kunitori-goyomi-save-v1';

const state = { data: null, game: null, picking: false, zoom: 1, selectedId: null, log: [], report: null, confirmReset: false, commanderId: null, escortId: null };

const $status = document.getElementById('status');
const $map = document.getElementById('map');
const $panel = document.getElementById('panel');
const $next = document.getElementById('next');
const $reset = document.getElementById('reset');
const $mapWrap = document.getElementById('map-wrap');
const $zoomIn = document.getElementById('zoom-in');
const $zoomOut = document.getElementById('zoom-out');

// ボタンで選べる倍率。1 は全国が一画面に収まる大きさ、2.5 は国を押しやすい大きさ
const ZOOM_STEPS = [1, 1.6, 2.5, 4];
const ZOOM_PLAY = 2.5;

// 外部データを innerHTML に流さないよう、要素はすべてこの関数で作る
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'onclick') node.addEventListener('click', v);
    else if (k === 'text') node.textContent = v;
    else node[k] = v;
  }
  node.append(...children);
  return node;
}

function fmt(n) {
  return n.toLocaleString('ja-JP');
}

async function loadData() {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, path]) => [key, await (await fetch(path)).json()]),
  );
  return Object.fromEntries(entries);
}

function renderStatus() {
  const { game } = state;
  const items = [
    ['暦', `${game.year}年 ${G.seasonName(game)}`],
    ['兵糧', fmt(game.clans[game.player].rice)],
    ['国', `${G.provincesOf(game, game.player).length} / ${game.data.rules.victory.provinces}`],
    ['兵', fmt(G.troopsOf(game, game.player))],
  ];
  $status.replaceChildren(...items.map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: v })])));
}

// プライベートブラウズなどで保存できなくても、遊ぶこと自体は続けられるようにする
function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ game: G.snapshot(state.game), log: state.log }));
  } catch {
    // 保存できない環境では何もしない
  }
}

function readSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // 消せなくても、次の保存で上書きされる
  }
}

// 命令も季節送りも最後は必ずここを通るので、ここで自動保存する
function render() {
  $reset.hidden = state.picking;
  if (state.picking) {
    renderPicker();
    return;
  }
  writeSave();
  renderStatus();
  renderMap($map, state.game, state.selectedId, selectProvince);
  if (state.game.result) renderResult();
  else if (state.report) renderReport();
  else if (state.selectedId) renderProvince(G.province(state.game, state.selectedId));
  else renderHome();
  $next.disabled = Boolean(state.game.result);
  $reset.textContent = state.confirmReset ? 'もう一度押すと最初から' : '最初から';
  $reset.classList.toggle('confirm', state.confirmReset);
}

// 地図の中心を国に合わせる。描き直しでは位置を保ち、始めたときと拡大したときだけ動かす
function centerOn(id) {
  const p = G.province(state.game, id);
  const vb = $map.viewBox.baseVal;
  const scale = $map.clientWidth / vb.width;
  $mapWrap.scrollTo({ left: (p.x - vb.x) * scale - $mapWrap.clientWidth / 2, top: (p.y - vb.y) * scale - $mapWrap.clientHeight / 2 });
}

// 倍率を変えても、いま画面の真ん中に見えている場所は真ん中のままにする
function setZoom(level) {
  const wrap = $mapWrap;
  const fx = (wrap.scrollLeft + wrap.clientWidth / 2) / ($map.clientWidth || 1);
  const fy = (wrap.scrollTop + wrap.clientHeight / 2) / ($map.clientHeight || 1);
  state.zoom = Math.min(ZOOM_STEPS.at(-1), Math.max(ZOOM_STEPS[0], level));
  $map.style.width = `${state.zoom * 100}%`;
  wrap.scrollTo({ left: fx * $map.clientWidth - wrap.clientWidth / 2, top: fy * $map.clientHeight - wrap.clientHeight / 2 });
  $zoomOut.disabled = state.zoom <= ZOOM_STEPS[0];
  $zoomIn.disabled = state.zoom >= ZOOM_STEPS.at(-1);
}

function homeProvince() {
  const mine = G.provincesOf(state.game, state.game.player);
  return mine.reduce((a, b) => (a.troops >= b.troops ? a : b), mine[0]);
}

// ピンチで中途半端な倍率になっていても、次の段へ進める
function zoomStep(dir) {
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > state.zoom + 0.01) : ZOOM_STEPS.findLast((z) => z < state.zoom - 0.01);
  if (next) setZoom(next);
}

// iPhone の Safari は2本指の操作を gesture イベントで知らせる。地図の中だけ拡大し、ページ全体は拡大させない
let pinchBase = 1;
function watchPinch() {
  $mapWrap.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    pinchBase = state.zoom;
  });
  $mapWrap.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    setZoom(pinchBase * e.scale);
  });
  $mapWrap.addEventListener('gestureend', (e) => e.preventDefault());
}

// 指なら Safari がそのままずらしてくれるので、マウスのときだけ押したまま動かして地図をずらす
const DRAG_SLOP = 5;
function watchDrag() {
  let drag = null;
  $mapWrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    delete $mapWrap.dataset.dragged;
    // 押した国に青い枠が残るのを防ぐ。国を選ぶ処理は click で動くので影響しない
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, left: $mapWrap.scrollLeft, top: $mapWrap.scrollTop, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    drag.moved = true;
    $mapWrap.classList.add('dragging');
    $mapWrap.scrollTo({ left: drag.left - dx, top: drag.top - dy });
  });
  window.addEventListener('pointerup', () => {
    if (drag?.moved) $mapWrap.dataset.dragged = '1';
    drag = null;
    $mapWrap.classList.remove('dragging');
  });
  // ずらし終えた直後のクリックで国が選ばれてしまわないよう、その1回だけ止める
  $mapWrap.addEventListener('click', (e) => {
    if (!$mapWrap.dataset.dragged) return;
    delete $mapWrap.dataset.dragged;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

// 全国表示で国を押したら、その国を拡大して見せる
function selectProvince(id) {
  if (id && state.zoom === ZOOM_STEPS[0] && !state.picking) {
    setZoom(ZOOM_PLAY);
    state.selectedId = id;
    state.report = null;
    render();
    centerOn(id);
    return;
  }
  state.selectedId = state.selectedId === id ? null : id;
  Object.assign(state, { commanderId: null, escortId: null });
  state.report = null;
  state.confirmReset = false;
  render();
}

function backButton() {
  return el('button', { className: 'back', type: 'button', text: '◀ 全体へ戻る', onclick: () => selectProvince(null) });
}

function logList(lines) {
  return el('ul', { className: 'lines' }, lines.map((l) => el('li', { className: l.mine ? 'mine' : '' }, [
    l.text,
    ...(l.detail ?? []).map((d) => el('span', { className: 'detail', text: d })),
  ])));
}

function clanList() {
  const { game } = state;
  const alive = game.data.clans.filter((c) => game.clans[c.id].alive)
    .map((c) => ({ c, n: G.provincesOf(game, c.id).length }))
    .sort((a, b) => b.n - a.n);
  return el('ul', { className: 'clan-list' }, alive.map(({ c, n }) => el('li', {}, [
    el('span', { className: 'dot', style: `background:${c.color}` }),
    `${c.name}　${n}国`,
  ])));
}

function renderHome() {
  const { game } = state;
  const { victory } = game.data.rules;
  const season = G.isBusySeason(game)
    ? '今は農繁期。動員（徴兵・出陣）した国は秋の収穫が減るが、敵の守りも手薄になる。'
    : game.season === game.data.rules.winterSeason ? '冬。雪国（❄）は出陣できず、攻め込まれもしない。' : '';
  $panel.replaceChildren(
    el('h2', { text: `${game.year}年 ${G.seasonName(game)}` }),
    el('p', { text: `目標：京（山城）を含めて${victory.provinces}か国を治める。自分の国（金の縁）を押して命令する。` }),
    ...(season ? [el('p', { text: season })] : []),
    ...(G.underSiege(game, game.player) ? [el('p', { text: `包囲網：${game.data.rules.siege.provinces}か国に達した家として、隣の大名が手を組んで狙ってくる。和睦にも応じない。` })] : []),
    ...(state.log.length ? [el('h3', { text: '前の季節の出来事' }), logList(state.log)] : []),
    el('h3', { text: '諸大名' }),
    clanList(),
  );
}

// 押し間違いで保存を消さないよう、2回押して初めてやり直す
function onReset() {
  if (state.confirmReset) {
    start(true);
  } else {
    state.confirmReset = true;
    render();
  }
}

// 大名選びの間は織田家を仮に置いた盤面を見せる。保存はまだしない
function renderPicker() {
  const { game } = state;
  $status.replaceChildren(el('div', {}, [el('dt', { text: '暦' }), el('dd', { text: `${game.year}年 ${G.seasonName(game)}` })]));
  renderMap($map, { ...game, player: null }, null, () => {});
  $next.disabled = true;
  const clans = game.data.clans
    .map((c) => ({ c, ps: G.provincesOf(game, c.id) }))
    .sort((a, b) => sum(b.ps, 'koku') - sum(a.ps, 'koku'));
  $panel.replaceChildren(
    el('h2', { text: '大名を選ぶ' }),
    el('p', { text: `どの家で天下をめざすか選ぶ。京（山城）を含めて${game.data.rules.victory.provinces}か国を治めれば勝ち。石高の多い順に並べてある。` }),
    el('div', { className: 'commands' }, clans.map(({ c, ps }) => clanButton(c, ps))),
  );
}

function sum(list, key) {
  return list.reduce((total, p) => total + p[key], 0);
}

function clanButton(c, ps) {
  const names = ps.map((p) => p.name + (p.capital ? '（京）' : '')).join('・');
  return el('button', { className: 'cmd', type: 'button', onclick: () => pickClan(c.id) }, [
    el('span', { className: 'dot', style: `background:${c.color}` }),
    `${c.name}家`,
    el('span', { className: 'sub', text: `${names}　石高 ${sum(ps, 'koku')}万石　兵 ${fmt(sum(ps, 'troops'))}` }),
  ]);
}

function pickClan(id) {
  Object.assign(state, { game: G.createGame(state.data, id), picking: false, selectedId: null, report: null, log: [] });
  render();
  setZoom(ZOOM_PLAY);
  centerOn(homeProvince().id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderReport() {
  const r = state.report;
  const head = r.head ?? (r.won ? `${r.to}を奪った！` : `${r.to}を落とせなかった`);
  $panel.replaceChildren(
    el('h2', { text: head }),
    el('ul', { className: 'lines' }, r.lines.map((t) => el('li', { text: t }))),
    backButton(),
  );
}

function renderResult() {
  const { game } = state;
  const win = game.result === 'win';
  $panel.replaceChildren(
    el('p', { className: 'big', text: win ? '天下布武' : '落城' }),
    el('p', { text: win ? `${game.year}年、京を押さえ天下に号令した。` : `${game.year}年、${G.clanInfo(game, game.player).name}家は滅んだ。` }),
    el('button', { className: 'next', type: 'button', text: 'はじめから', onclick: () => start(true) }),
  );
}

function provinceFacts(p) {
  const { game } = state;
  const facts = [
    `${G.clanInfo(game, p.clan).name}家`,
    `石高 ${p.koku}万石`,
    `兵 ${fmt(p.troops)}`,
    `城 ${'★'.repeat(p.castle) || 'なし'}`,
  ];
  if (p.snow) facts.push('雪国');
  if (p.capital) facts.push('京');
  if (p.unrest) facts.push(`民心が乱れている（あと${p.unrest}季節）`);
  const truce = p.clan === game.player ? 0 : G.truceLeft(game, game.player, p.clan);
  if (truce) facts.push(`和睦中（あと${truce}季節）`);
  return el('div', { className: 'facts' }, facts.map((f) => el('span', { text: f })));
}

function renderProvince(p) {
  const { game } = state;
  const mine = p.clan === game.player;
  let body;
  if (!mine) body = [el('p', { text: `守りの力 ${fmt(Math.round(G.defensePower(game, p)))}（兵×城×季節）` })];
  else if (p.acted) body = [el('p', { text: 'この国はこの季節、もう命令を終えた。' })];
  else body = commandList(p);
  $panel.replaceChildren(el('h2', { text: p.name }), provinceFacts(p), generalList(p), ...body, backButton());
}

function generalLabel(g) {
  return `${g.name}${g.lord ? '（当主）' : ''}　統率${g.lead}・政務${g.admin}`;
}

// 国の働きは武将の能力で変わるので、敵の国でも誰がいるかは見せる
function generalList(p) {
  const generals = G.generalsIn(state.game, p);
  if (generals.length === 0) return el('p', { className: 'facts', text: '武将なし（統率・政務は並以下）' });
  return el('div', {}, [
    el('h3', { text: '武将' }),
    el('ul', { className: 'lines' }, generals.map((g) => el('li', { text: generalLabel(g) }))),
  ]);
}

// 大将や同行する武将を選ぶ欄。選び直すと勝算の表示も変わるので描き直す
function generalSelect(p, key, emptyLabel) {
  const generals = G.generalsIn(state.game, p);
  const select = el('select', { className: 'pick', onchange: () => { state[key] = select.value || null; render(); } }, [
    ...(emptyLabel ? [el('option', { value: '', text: emptyLabel })] : []),
    ...generals.map((g) => el('option', { value: g.id, text: generalLabel(g) })),
  ]);
  select.value = state[key] ?? (emptyLabel ? '' : generals[0]?.id ?? '');
  return select;
}

function cmdButton(label, sub, enabled, onclick) {
  return el('button', { className: 'cmd', type: 'button', disabled: !enabled, onclick }, [
    label,
    el('span', { className: 'sub', text: sub }),
  ]);
}

function act(fn) {
  return () => {
    fn();
    render();
  };
}

function commandList(p) {
  const { game } = state;
  const { develop } = game.data.rules;
  const plan = G.recruitPlan(game, p);
  const busy = G.isBusySeason(game) ? '（農繁期：秋の収穫が減る）' : '';
  const unrest = p.unrest ? '　民心が乱れて兵が集まらない' : '';
  const list = [
    cmdButton('開墾', `兵糧 ${G.developCost(game, p)} → 石高 +${develop.gain}万石（上限 ${Math.floor(p.baseKoku * develop.maxRate)}）`,
      G.canDevelop(game, p), act(() => G.develop(game, p))),
    cmdButton('徴兵', `兵 +${fmt(plan.amount)}　兵糧 ${plan.cost}　上限 ${fmt(G.troopCap(game, p))}${busy}${unrest}`,
      G.canRecruit(game, p), act(() => G.recruit(game, p))),
    cmdButton('築城', p.castle >= game.data.rules.fortify.max ? '城はもう最も堅い' : `兵糧 ${G.fortifyCost(game, p)} → 城 ★${p.castle + 1}（守りが強くなる）${busy}`,
      G.canFortify(game, p), act(() => G.fortify(game, p))),
  ];
  const enemies = G.neighbors(game, p).filter((n) => n.clan !== game.player);
  const friends = G.neighbors(game, p).filter((n) => n.clan === game.player);
  const hasGenerals = G.generalsIn(game, p).length > 0;
  const commander = hasGenerals ? [el('label', { className: 'pick-row' }, ['大将', generalSelect(p, 'commanderId', null)])] : [];
  const escort = hasGenerals ? [el('label', { className: 'pick-row' }, ['同行', generalSelect(p, 'escortId', 'だれも行かない')])] : [];
  return [
    el('h3', { text: '内政' }), el('div', { className: 'commands' }, list),
    ...(enemies.length ? [el('h3', { text: `出陣${busy}` }), ...commander, el('div', { className: 'commands' }, enemies.map((n) => marchTarget(p, n)))] : []),
    ...diplomacyList(p, enemies),
    ...(friends.length ? [el('h3', { text: '移動（兵の8割を送る）' }), ...escort, el('div', { className: 'commands' }, friends.map((n) => moveButton(p, n)))] : []),
  ];
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

// 調略は隣の国ごと、和睦は隣の大名家ごとに並べる
function diplomacyList(p, enemies) {
  const { game } = state;
  if (enemies.length === 0) return [];
  const plots = enemies.filter((n) => G.plotTarget(game, n)).map((n) => {
    const target = G.plotTarget(game, n);
    return cmdButton(`調略：${n.name}の${target.name}`, `兵糧 ${game.data.rules.plot.cost}　成功の見込み ${pct(G.plotChance(game, p, n))}　成功すればこの国の家臣になる`,
      G.canPlot(game, p, n), () => doPlot(p, n));
  });
  const clans = [...new Set(enemies.map((n) => n.clan))];
  const truces = clans.map((c) => {
    const left = G.truceLeft(game, game.player, c);
    const sub = left ? `和睦中（あと${left}季節）`
      : `兵糧 ${G.truceCost(game, c)}　応じる見込み ${pct(G.truceChance(game, game.player, c))}　1年間たがいに攻めない`;
    return cmdButton(`和睦：${G.clanInfo(game, c).name}家`, sub, G.canTruce(game, p, c), () => doTruce(p, c));
  });
  const siege = G.underSiege(game, game.player) ? [el('p', { className: 'facts', text: '包囲網のさなか。どの家も和睦に応じない。' })] : [];
  return [el('h3', { text: '外交' }), ...siege, el('div', { className: 'commands' }, [...plots, ...truces])];
}

function doPlot(p, n) {
  const r = G.plot(state.game, p, n);
  if (!r) return;
  state.report = r.ok
    ? { head: '調略が実った', lines: [`${n.name}の${r.name}が寝返り、${p.name}に入った。`] }
    : { head: '調略は失敗した', lines: [`${r.name}は誘いに乗らなかった。兵糧だけが減った。`] };
  render();
}

function doTruce(p, clanId) {
  const r = G.truce(state.game, p, clanId);
  if (r === null) return;
  const name = `${G.clanInfo(state.game, clanId).name}家`;
  state.report = r
    ? { head: '和睦が成った', lines: [`${name}と和睦した。${state.game.data.rules.truce.seasons}季節のあいだ、たがいに攻め込まない。`] }
    : { head: '和睦は断られた', lines: [`${name}は和睦に応じなかった。兵糧だけが減った。`] };
  render();
}

// 勝算は「出す兵 ÷ 守りの力」でざっくり3段階に。合戦には運の幅があるので数字は見せすぎない
function odds(size, power) {
  const r = power === 0 ? 9 : size / power;
  if (r >= 1.3) return ['有利', 'odds-high'];
  if (r >= 0.9) return ['五分', 'odds-even'];
  return ['不利', 'odds-low'];
}

function marchTarget(p, n) {
  const { game } = state;
  const power = Math.round(G.defensePower(game, n));
  const commander = G.generalsIn(game, p).find((g) => g.id === state.commanderId);
  const factor = G.attackFactor(game, p, commander);
  const buttons = [0.5, 0.8].map((ratio) => {
    const size = G.marchSize(p, ratio);
    const [label, cls] = odds(size * factor, power);
    return el('button', {
      className: 'cmd', type: 'button', disabled: !G.canMarch(game, p, n, ratio),
      onclick: () => doMarch(p, n, ratio),
    }, [`${ratio === 0.5 ? '半数' : '8割'} ${fmt(size)}`, el('span', { className: `sub ${cls}`, text: `${label}・兵糧 ${G.marchCost(game, size)}` })]);
  });
  const truce = G.truceLeft(game, p.clan, n.clan);
  const snow = (G.snowedIn(game, n) || G.snowedIn(game, p) ? '　❄雪で動けない' : '') + (truce ? `　和睦中（あと${truce}季節）` : '');
  return el('div', { className: 'target' }, [
    el('div', { text: `${n.name}（${G.clanInfo(game, n.clan).name}家）守りの力 ${fmt(power)}${snow}` }),
    el('div', { className: 'row' }, buttons),
  ]);
}

function doMarch(p, n, ratio) {
  const result = G.march(state.game, p, n, ratio, Math.random, state.commanderId);
  if (!result) return;
  state.report = result;
  render();
}

function moveButton(p, n) {
  const size = G.marchSize(p, 0.8);
  return cmdButton(`${n.name}へ`, `兵 ${fmt(size)} を送る`, G.canMove(state.game, p, n),
    act(() => G.move(state.game, p, n, 0.8, state.escortId)));
}

function nextSeason() {
  if (state.game.result) return;
  state.log = endSeason(state.game);
  state.selectedId = null;
  state.report = null;
  state.confirmReset = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 保存があれば続きから。保存がないときと fresh のときは、保存を消して大名選びから始める
async function start(fresh = false) {
  state.data ??= await loadData();
  const game = G.createGame(state.data);
  if (fresh) clearSave();
  const saved = fresh ? null : readSave();
  if (saved?.game) G.restore(game, saved.game);
  Object.assign(state, { game, picking: !saved?.game, selectedId: null, report: null, log: saved?.log ?? [], confirmReset: false });
  // 大名選びは全国を見渡して選び、続きから遊ぶときは自分の国を拡大して見せる
  setZoom(state.picking ? ZOOM_STEPS[0] : ZOOM_PLAY);
  render();
  if (!state.picking && homeProvince()) centerOn(homeProvince().id);
}

$next.addEventListener('click', nextSeason);
$reset.addEventListener('click', onReset);
$zoomIn.addEventListener('click', () => zoomStep(1));
$zoomOut.addEventListener('click', () => zoomStep(-1));
watchPinch();
watchDrag();
start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
