// 画面の組み立てと操作。ルールは game.js / turn.js に任せ、ここでは表示と命令の受け渡しだけをする
import * as G from './game.js';
import { endSeason } from './turn.js';
import { renderMap } from './map.js';

const DATA_FILES = { clans: 'data/clans.json', provinces: 'data/provinces.json', rules: 'data/rules.json', coast: 'data/coast.json', generals: 'data/generals.json' };

// 保存の形を変えたら番号を上げ、古い保存を読みこまないようにする
const SAVE_KEY = 'kunitori-goyomi-save-v1';

const state = { data: null, game: null, picking: false, zoom: 1, selectedId: null, log: [], report: null, confirmReset: false, commanderId: null, escortId: null, tactic: 'assault', helpOpen: false };

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
  Object.assign(state, { commanderId: null, escortId: null, tactic: 'assault' });
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
    helpBox(),
    ...(season ? [el('p', { text: season })] : []),
    ...(G.underSiege(game, game.player) ? [el('p', { text: `包囲網：${game.data.rules.siege.provinces}か国に達した家として、隣の大名が手を組んで狙ってくる。和睦にも応じない。` })] : []),
    ...(state.log.length ? [el('h3', { text: '前の季節の出来事' }), logList(state.log)] : []),
    el('h3', { text: '諸大名' }),
    clanList(),
    chronicleBox(),
  );
}

// 遊び方。[見出し, 本文] の組で並べる
const HELP = [
  ['目標', '京（山城）を含めて35か国を治めれば勝ち。自分の国がなくなれば負け。'],
  ['進め方', '自分の国（金の縁）を押して命令する。1つの国は1季節に1つだけ命令できる。命令を終えたら下の「季節を進める」を押す。'],
  ['季節', '春・秋は農繁期。徴兵・出陣・築城をした国は秋の収穫が減るが、敵の守りも手薄になる。冬は雪国（❄）が出陣できず、攻め込まれもしない。秋に石高に応じた兵糧が入る。'],
  ['兵糧', '兵を養うのに毎季節使う。尽きると各国の兵が逃げ出す。'],
  ['開墾', '兵糧を使って石高（米のとれ高）を増やす。石高が多いほど収穫も兵の上限も増える。'],
  ['徴兵', '兵糧を使って兵を集める。'],
  ['築城', '兵糧を使って城を1段堅くする（★5まで）。城が堅いほど守りが強い。'],
  ['出陣', '隣の敵国へ兵の半数か8割で攻め込む。「有利・五分・不利」が勝算の目安。大将に統率の高い武将を選ぶと強い。勝てば国と大将がそちらへ移る。'],
  ['策', '力攻めはふつうの攻め方。兵糧攻めは兵糧を3倍使い秋の収穫も減るが、こちらの損害が少なく堅い城に向く。夜襲は当たれば城の守りを無いものにして大きく削るが、外れると兵の4分の1を失う。統率の高い大将ほど当てやすい。'],
  ['籠城と迎撃', '守る側は、城が弱く野戦でも負けない兵がいれば城を出て迎え撃つ。城の守りは使えないが、崩れた攻め手を追い討つ。'],
  ['移動', '兵の8割を隣の自分の国へ送る。「同行」で武将も連れて行ける。'],
  ['調略', '隣の敵国の家臣に寝返りを持ちかける。自分の国の武将の政務が高いほど成功しやすい。'],
  ['和睦', '隣の大名と1年間たがいに攻めない約束をする。相手より兵が多いほど応じやすい。断られても兵糧は減る。'],
  ['同盟', '隣の大名と期限なしでたがいに攻めない約束をする。和睦より応じにくいが、和睦中なら話が進みやすい。攻められると隣の同盟国から援軍が来ることがある。相手がこちらより大きくなるほど、またこちらが包囲網を招くと、同盟を破って攻めてくることがある。こちらから手切れもできるが、家臣の忠誠が下がる。'],
  ['婚姻', '同盟した相手と婚姻を結ぶ。援軍が多くなり、裏切られにくくなる。'],
  ['武将', '統率は合戦と守り、政務は開墾の費用・徴兵の人数・調略に効く。国にいる武将のうち一番得意な者の値が使われる。'],
  ['忠誠', '家臣には忠誠がある。低いと敵の調略に乗りやすく、30を切ると出奔（家を去ること）しやすい。年が改まるたびに少し下がり、兵糧が尽きたときや大将として負けたときにも下がる。勝てば上がる。'],
  ['特技', '一部の武将は特技を持つ。築城（普請が安い）・開墾（開墾が安い）・調略（成功しやすい）・兵站（出陣の兵糧が半分）は国にいるだけで効く。鉄砲は大将なら攻めが、国にいれば守りが強くなる。夜戦は大将のとき夜襲が当たりやすい。元服した若武者も特技を持つことがある。'],
  ['年表', '国の取り合い・家督・出奔・同盟などの出来事が記録される。ふだんは下の「年表」で、決着がつくと勝ち負けの数や領国の移り変わりと一緒に見られる。'],
  ['褒美', '兵糧を使い、その国でいちばん忠誠の低い家臣の忠誠を上げる。'],
  ['寿命', '年が進むほど武将は亡くなりやすくなる。当主が亡くなると家臣のひとりが家督を継ぎ、家臣の忠誠が下がる。春にはときどき若武者が元服して加わる。'],
  ['捕虜', '城を落としたとき、逃げ場のない武将を捕らえることがある。登用（家臣にする。忠誠は低い）・解放（家臣の忠誠が上がる）・処断（家臣の忠誠が下がる）から選ぶ。決めずに季節を進めると解き放つ。'],
  ['出来事', '夏に豊作・凶作の見込みが決まり、秋の収穫が増減する。長雨の国はその季節に兵を出せず、攻め込まれもしない。農繁期に兵を動かした国や奪ったばかりの国では一揆が起きることがある。疫病で兵が減ることも、大雪で雪国の隣まで雪に閉ざされる冬もある。'],
  ['民心', '奪ったばかりの国は1年間、収穫が半分になり徴兵もできない。'],
  ['包囲網', '10か国に達すると、隣の大名がこちらを優先して狙い、和睦にも応じなくなる。'],
  ['地図', '「＋ 拡大」「－ 縮小」で大きさを変える。iPhoneでは2本指で広げてもよい。PCではマウスで押したまま動かすと地図がずれる。'],
  ['保存', '自動で保存される。「最初から」を2回押すとやり直せる。'],
];

// 開いたままにしておけるよう、開閉を覚えておく（画面は命令のたびに描き直すため）
function helpBox() {
  const box = el('details', { className: 'help', open: state.helpOpen }, [
    el('summary', { text: '遊び方' }),
    el('dl', {}, HELP.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
  ]);
  box.addEventListener('toggle', () => { state.helpOpen = box.open; });
  return box;
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
    helpBox(),
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
  const captives = r.captives?.length ? captiveBox(G.province(state.game, r.toId)) : [];
  $panel.replaceChildren(
    el('h2', { text: head }),
    el('ul', { className: 'lines' }, r.lines.map((t) => el('li', { text: t }))),
    ...captives,
    backButton(),
  );
}

// 捕らえた武将の処遇。合戦の報告からも、その国の画面からも決められる
function captiveBox(p) {
  const { game } = state;
  const captives = G.captivesIn(game, p);
  if (captives.length === 0) return [];
  const { loyalty } = game.data.rules;
  return [el('h3', { text: '捕らえた武将（決めずに季節を進めると解き放つ）' }), el('div', { className: 'commands' }, captives.map((g) => el('div', { className: 'target' }, [
    el('div', { text: `${generalLabel(g)}（${G.clanInfo(game, g.clan).name}家）` }),
    el('div', { className: 'row three' }, [
      cmdButton('登用', g.lord ? '当主は仕えない' : `忠誠${loyalty.captive}で家臣に`, G.canHire(g), () => decideCaptive(g, 'hire')),
      cmdButton('解放', `家臣の忠誠 +${loyalty.mercy}`, true, () => decideCaptive(g, 'release')),
      cmdButton('処断', `家臣の忠誠 -${loyalty.cruelty}`, true, () => decideCaptive(g, 'execute')),
    ]),
  ])))];
}

function captiveResult(g, how) {
  const { game } = state;
  if (how === 'hire') return G.hireCaptive(game, g) ? [`${g.name}を登用した。`] : [];
  if (how === 'release') {
    return G.releaseCaptive(game, g) ? [`${g.name}を${G.clanInfo(game, g.clan).name}家へ帰した。家臣の忠誠が上がった。`]
      : [`${g.name}を解き放った。主家はもう無く、どこかへ去った。家臣の忠誠が上がった。`];
  }
  return [`${g.name}を処断した。家臣の忠誠が下がった。`, ...G.executeCaptive(game, g)];
}

function decideCaptive(g, how) {
  const lines = captiveResult(g, how);
  if (state.report) state.report.lines.push(...lines);
  else state.report = { head: '捕虜の処遇', lines };
  render();
}

function renderResult() {
  const { game } = state;
  const win = game.result === 'win';
  $panel.replaceChildren(
    el('p', { className: 'big', text: win ? '天下布武' : '落城' }),
    el('p', { text: win ? `${game.year}年、京を押さえ天下に号令した。` : `${game.year}年、${G.clanInfo(game, game.player).name}家は滅んだ。` }),
    statsBox(),
    el('h3', { text: '年表' }),
    chronicleList(),
    el('button', { className: 'next', type: 'button', text: 'はじめから', onclick: () => start(true) }),
  );
}

// 何年かかったか、合戦の勝ち負け、領国の数の移り変わり
function statsBox() {
  const { game } = state;
  const { won, lost, held, fell, history } = game.stats;
  const years = game.year - game.data.rules.startYear;
  const counts = [...history, { year: game.year, count: G.provincesOf(game, game.player).length }];
  const max = Math.max(...counts.map((h) => h.count), 1);
  return el('div', {}, [
    el('div', { className: 'facts' }, [
      el('span', { text: `${years}年` }),
      el('span', { text: `攻め ${won}勝${lost}敗` }),
      el('span', { text: `守り ${held}勝${fell}敗` }),
    ]),
    el('h3', { text: '領国の数' }),
    el('ul', { className: 'bars' }, counts.filter((h, i) => i === 0 || h.year !== counts[i - 1].year).map((h) => el('li', {}, [
      el('span', { className: 'bar-year', text: `${h.year}` }),
      el('span', { className: 'bar', style: `width:${Math.max(2, (h.count / max) * 100)}%` }),
      el('span', { className: 'bar-num', text: `${h.count}` }),
    ]))),
  ]);
}

// 新しい出来事が上に来るようにする。終わりまで遊んだあと、決着から振り返れるように
function chronicleList() {
  const { game } = state;
  return el('ul', { className: 'lines' }, [...game.chronicle].reverse().map((c) => el('li', {}, [
    el('span', { className: 'detail', text: `${c.year}年 ${game.data.rules.seasons[c.season]}` }),
    c.text,
  ])));
}

// 遊んでいる途中も年表を見られるよう、畳んで置いておく
function chronicleBox() {
  const box = el('details', { className: 'help' }, [el('summary', { text: `年表（${state.game.chronicle.length}件）` })]);
  box.append(el('div', { className: 'chronicle' }, [chronicleList()]));
  return box;
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
  if (p.crop > 1) facts.push('豊作の見込み');
  if (p.crop < 1) facts.push('凶作の見込み');
  if (p.rain) facts.push('長雨（兵を動かせない）');
  if (p.heavySnow && G.snowedIn(game, p)) facts.push('大雪');
  const truce = p.clan === game.player ? 0 : G.truceLeft(game, game.player, p.clan);
  if (truce) facts.push(`和睦中（あと${truce}季節）`);
  const link = p.clan === game.player ? null : G.allianceLink(game, game.player, p.clan);
  if (link) facts.push(link.marriage ? '同盟・婚姻' : '同盟');
  return el('div', { className: 'facts' }, facts.map((f) => el('span', { text: f })));
}

function renderProvince(p) {
  const { game } = state;
  const mine = p.clan === game.player;
  let body;
  if (!mine) body = [el('p', { text: `守りの力 ${fmt(Math.round(G.defensePower(game, p)))}（兵×城×季節）` })];
  else if (p.acted) body = [el('p', { text: 'この国はこの季節、もう命令を終えた。' })];
  else body = commandList(p);
  const captives = mine ? captiveBox(p) : [];
  $panel.replaceChildren(el('h2', { text: p.name }), provinceFacts(p), generalList(p), ...captives, ...body, backButton());
}

// 忠誠は自分の家臣にだけ見せる（他家の家臣の心は外からは分からない）
function generalLabel(g) {
  const { game } = state;
  const own = g.clan === game.player && !g.lord && !g.captive;
  const loyalty = own ? `・忠誠${g.loyalty}${g.loyalty < game.data.rules.loyalty.leave ? '（出奔のおそれ）' : ''}` : '';
  const skill = g.skill ? `・特技 ${G.SKILLS[g.skill]}` : '';
  return `${g.name}${g.lord ? '（当主）' : ''}　統率${g.lead}・政務${g.admin}${skill}${loyalty}`;
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

function internalList(p, busy) {
  const { game } = state;
  const { develop, loyalty } = game.data.rules;
  const plan = G.recruitPlan(game, p);
  const unrest = p.unrest ? '　民心が乱れて兵が集まらない' : '';
  const target = G.rewardTarget(game, p);
  const rewardButton = target
    ? [cmdButton(`褒美：${target.name}`, `兵糧 ${loyalty.rewardCost} → 忠誠 ${target.loyalty} → ${Math.min(loyalty.max, target.loyalty + loyalty.reward)}`,
      G.canReward(game, p), act(() => G.reward(game, p)))]
    : [];
  return [
    cmdButton('開墾', `兵糧 ${G.developCost(game, p)} → 石高 +${develop.gain}万石（上限 ${Math.floor(p.baseKoku * develop.maxRate)}）`,
      G.canDevelop(game, p), act(() => G.develop(game, p))),
    cmdButton('徴兵', `兵 +${fmt(plan.amount)}　兵糧 ${plan.cost}　上限 ${fmt(G.troopCap(game, p))}${busy}${unrest}`,
      G.canRecruit(game, p), act(() => G.recruit(game, p))),
    cmdButton('築城', p.castle >= game.data.rules.fortify.max ? '城はもう最も堅い' : `兵糧 ${G.fortifyCost(game, p)} → 城 ★${p.castle + 1}（守りが強くなる）${busy}`,
      G.canFortify(game, p), act(() => G.fortify(game, p))),
    ...rewardButton,
  ];
}

function commandList(p) {
  const { game } = state;
  const busy = G.isBusySeason(game) ? '（農繁期：秋の収穫が減る）' : '';
  const list = internalList(p, busy);
  const enemies = G.neighbors(game, p).filter((n) => n.clan !== game.player);
  const friends = G.neighbors(game, p).filter((n) => n.clan === game.player);
  const hasGenerals = G.generalsIn(game, p).length > 0;
  const commander = hasGenerals ? [el('label', { className: 'pick-row' }, ['大将', generalSelect(p, 'commanderId', null)])] : [];
  const escort = hasGenerals ? [el('label', { className: 'pick-row' }, ['同行', generalSelect(p, 'escortId', 'だれも行かない')])] : [];
  return [
    el('h3', { text: '内政' }), el('div', { className: 'commands' }, list),
    ...(enemies.length ? [el('h3', { text: `出陣${busy}` }), ...commander, tacticSelect(p), el('div', { className: 'commands' }, enemies.map((n) => marchTarget(p, n)))] : []),
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
  const truces = clans.filter((c) => !G.allied(game, game.player, c)).map((c) => {
    const left = G.truceLeft(game, game.player, c);
    const sub = left ? `和睦中（あと${left}季節）`
      : `兵糧 ${G.truceCost(game, c)}　応じる見込み ${pct(G.truceChance(game, game.player, c))}　1年間たがいに攻めない`;
    return cmdButton(`和睦：${G.clanInfo(game, c).name}家`, sub, G.canTruce(game, p, c), () => doTruce(p, c));
  });
  const siege = G.underSiege(game, game.player) ? [el('p', { className: 'facts', text: '包囲網のさなか。どの家も和睦にも同盟にも応じない。' })] : [];
  return [el('h3', { text: '外交' }), ...siege, el('div', { className: 'commands' }, [...plots, ...truces, ...clans.flatMap((c) => allianceButtons(p, c))])];
}

// 同盟していなければ同盟を、同盟していれば婚姻と手切れを出す
function allianceButtons(p, clanId) {
  const { game } = state;
  const name = `${G.clanInfo(game, clanId).name}家`;
  const link = G.allianceLink(game, game.player, clanId);
  if (!link) {
    return [cmdButton(`同盟：${name}`, `兵糧 ${G.allianceCost(game, clanId)}　応じる見込み ${pct(G.allianceChance(game, game.player, clanId))}　期限なし。攻められると援軍が来ることがある`,
      G.canAlly(game, p, clanId), () => doAlly(p, clanId))];
  }
  const marriage = link.marriage ? [] : [cmdButton(`婚姻：${name}`, `兵糧 ${game.data.rules.alliance.marriageCost}　援軍が増え、裏切られにくくなる`, G.canMarry(game, p, clanId), () => doMarry(p, clanId))];
  const warn = `裏切りの気配 ${pct(G.betrayChance(game, clanId, game.player))}／季節　命令は使わないが家臣の忠誠 -${game.data.rules.alliance.breakLoyalty}`;
  return [...marriage, cmdButton(`手切れ：${name}`, warn, true, () => doBreak(clanId))];
}

function doAlly(p, clanId) {
  const r = G.ally(state.game, p, clanId);
  if (r === null) return;
  const name = `${G.clanInfo(state.game, clanId).name}家`;
  state.report = r
    ? { head: '同盟が成った', lines: [`${name}と同盟した。たがいに攻めず、攻められれば援軍を出し合う。`] }
    : { head: '同盟は断られた', lines: [`${name}は同盟に応じなかった。兵糧だけが減った。`] };
  render();
}

function doMarry(p, clanId) {
  if (!G.marry(state.game, p, clanId)) return;
  state.report = { head: '婚姻が成った', lines: [`${G.clanInfo(state.game, clanId).name}家と婚姻を結んだ。援軍が増え、裏切られにくくなる。`] };
  render();
}

function doBreak(clanId) {
  if (!G.breakAlliance(state.game, state.game.player, clanId)) return;
  state.report = { head: '同盟を破った', lines: [`${G.clanInfo(state.game, clanId).name}家との同盟を破った。家臣の忠誠が下がった。`] };
  render();
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

// 策を選ぶ欄。夜襲の見込みは大将で変わるので、選んでいる大将で計算する
function tacticSelect(p) {
  const { game } = state;
  const commander = G.generalsIn(game, p).find((g) => g.id === state.commanderId) ?? G.generalsIn(game, p)[0];
  const labels = {
    assault: '力攻め',
    siege: `兵糧攻め（兵糧${game.data.rules.tactics.siegeCost}倍・損害少・収穫減）`,
    night: `夜襲（当たる見込み ${pct(G.nightChance(game, commander))}）`,
  };
  const select = el('select', { className: 'pick', onchange: () => { state.tactic = select.value; render(); } },
    Object.entries(labels).map(([value, text]) => el('option', { value, text })));
  select.value = state.tactic;
  return el('label', { className: 'pick-row' }, ['策', select]);
}

// 兵糧攻めは攻め手の損害が守り手より軽く済むぶん、勝算を上乗せして見せる
const SIEGE_EDGE = 1.2;

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
  const factor = G.attackFactor(game, p, commander) * (state.tactic === 'siege' ? SIEGE_EDGE : 1);
  const buttons = [0.5, 0.8].map((ratio) => {
    const size = G.marchSize(p, ratio);
    const [label, cls] = odds(size * factor, power);
    return el('button', {
      className: 'cmd', type: 'button', disabled: !G.canMarch(game, p, n, ratio, state.tactic),
      onclick: () => doMarch(p, n, ratio),
    }, [`${ratio === 0.5 ? '半数' : '8割'} ${fmt(size)}`, el('span', { className: `sub ${cls}`, text: `${label}・兵糧 ${G.marchCost(game, size, state.tactic, p)}` })]);
  });
  const truce = G.truceLeft(game, p.clan, n.clan);
  const snow = (G.snowedIn(game, n) || G.snowedIn(game, p) ? '　❄雪で動けない' : '') + (n.rain || p.rain ? '　長雨で動けない' : '') + (truce ? `　和睦中（あと${truce}季節）` : '') + (G.allied(game, p.clan, n.clan) ? '　同盟中' : '');
  return el('div', { className: 'target' }, [
    el('div', { text: `${n.name}（${G.clanInfo(game, n.clan).name}家）守りの力 ${fmt(power)}${snow}` }),
    el('div', { className: 'row' }, buttons),
  ]);
}

function doMarch(p, n, ratio) {
  const result = G.march(state.game, p, n, ratio, Math.random, state.commanderId, state.tactic);
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
