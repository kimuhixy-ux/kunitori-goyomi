// 画面の組み立てと操作。ルールは game.js / turn.js に任せ、ここでは表示と命令の受け渡しだけをする
import * as G from './game.js';
import { endSeason } from './turn.js';
import { renderMap } from './map.js';

const DATA_FILES = { clans: 'data/clans.json', provinces: 'data/provinces.json', rules: 'data/rules.json', coast: 'data/coast.json' };

// 保存の形を変えたら番号を上げ、古い保存を読みこまないようにする
const SAVE_KEY = 'kunitori-goyomi-save-v1';

const state = { data: null, game: null, picking: false, zoomed: true, selectedId: null, log: [], report: null, confirmReset: false };

const $status = document.getElementById('status');
const $map = document.getElementById('map');
const $panel = document.getElementById('panel');
const $next = document.getElementById('next');
const $reset = document.getElementById('reset');
const $mapWrap = document.getElementById('map-wrap');
const $zoom = document.getElementById('zoom');

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

function setZoom(on) {
  state.zoomed = on;
  $mapWrap.classList.toggle('zoomed', on);
  $zoom.textContent = on ? '全国を見る' : '拡大する';
}

function homeProvince() {
  const mine = G.provincesOf(state.game, state.game.player);
  return mine.reduce((a, b) => (a.troops >= b.troops ? a : b), mine[0]);
}

function toggleZoom() {
  setZoom(!state.zoomed);
  const focus = state.selectedId ?? homeProvince()?.id;
  if (state.zoomed && focus) centerOn(focus);
}

// 全国表示で国を押したら、その国を拡大して見せる
function selectProvince(id) {
  if (id && !state.zoomed && !state.picking) {
    setZoom(true);
    state.selectedId = id;
    state.report = null;
    render();
    centerOn(id);
    return;
  }
  state.selectedId = state.selectedId === id ? null : id;
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
  setZoom(true);
  centerOn(homeProvince().id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderReport() {
  const r = state.report;
  const head = r.won ? `${r.to}を奪った！` : `${r.to}を落とせなかった`;
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
  return el('div', { className: 'facts' }, facts.map((f) => el('span', { text: f })));
}

function renderProvince(p) {
  const { game } = state;
  const mine = p.clan === game.player;
  let body;
  if (!mine) body = [el('p', { text: `守りの力 ${fmt(Math.round(G.defensePower(game, p)))}（兵×城×季節）` })];
  else if (p.acted) body = [el('p', { text: 'この国はこの季節、もう命令を終えた。' })];
  else body = commandList(p);
  $panel.replaceChildren(el('h2', { text: p.name }), provinceFacts(p), ...body, backButton());
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
  const list = [
    cmdButton('開墾', `兵糧 ${develop.cost} → 石高 +${develop.gain}万石（上限 ${Math.floor(p.baseKoku * develop.maxRate)}）`,
      G.canDevelop(game, p), act(() => G.develop(game, p))),
    cmdButton('徴兵', `兵 +${fmt(plan.amount)}　兵糧 ${plan.cost}　上限 ${fmt(G.troopCap(game, p))}${busy}`,
      G.canRecruit(game, p), act(() => G.recruit(game, p))),
  ];
  const enemies = G.neighbors(game, p).filter((n) => n.clan !== game.player);
  const friends = G.neighbors(game, p).filter((n) => n.clan === game.player);
  return [
    el('h3', { text: '内政' }), el('div', { className: 'commands' }, list),
    ...(enemies.length ? [el('h3', { text: `出陣${busy}` }), el('div', { className: 'commands' }, enemies.map((n) => marchTarget(p, n)))] : []),
    ...(friends.length ? [el('h3', { text: '移動（兵の8割を送る）' }), el('div', { className: 'commands' }, friends.map((n) => moveButton(p, n)))] : []),
  ];
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
  const buttons = [0.5, 0.8].map((ratio) => {
    const size = G.marchSize(p, ratio);
    const [label, cls] = odds(size, power);
    return el('button', {
      className: 'cmd', type: 'button', disabled: !G.canMarch(game, p, n, ratio),
      onclick: () => doMarch(p, n, ratio),
    }, [`${ratio === 0.5 ? '半数' : '8割'} ${fmt(size)}`, el('span', { className: `sub ${cls}`, text: `${label}・兵糧 ${G.marchCost(game, size)}` })]);
  });
  const snow = G.snowedIn(game, n) || G.snowedIn(game, p) ? '　❄雪で動けない' : '';
  return el('div', { className: 'target' }, [
    el('div', { text: `${n.name}（${G.clanInfo(game, n.clan).name}家）守りの力 ${fmt(power)}${snow}` }),
    el('div', { className: 'row' }, buttons),
  ]);
}

function doMarch(p, n, ratio) {
  const result = G.march(state.game, p, n, ratio);
  if (!result) return;
  state.report = result;
  render();
}

function moveButton(p, n) {
  const size = G.marchSize(p, 0.8);
  return cmdButton(`${n.name}へ`, `兵 ${fmt(size)} を送る`, G.canMove(state.game, p, n),
    act(() => G.move(state.game, p, n, 0.8)));
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
  setZoom(!state.picking);
  render();
  if (!state.picking && homeProvince()) centerOn(homeProvince().id);
}

$next.addEventListener('click', nextSeason);
$reset.addEventListener('click', onReset);
$zoom.addEventListener('click', toggleZoom);
start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
