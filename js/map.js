// 国を丸、隣接を線で描く。正確な国境は描かず、iPhone でも指で押しやすい大きさを優先した
import * as G from './game.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// 実際の位置に置くと畿内の国どうしが近いので、丸は小さめにして見えない当たり判定で指の押しやすさを補う
const RADIUS = 5.4;
const HIT_RADIUS = 6.5;

function svgEl(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function polygon(points, cls) {
  return svgEl('polygon', { class: cls, points: points.map((pt) => pt.join(',')).join(' ') });
}

// 海岸線は国の位置を見分ける目安なので、細部を省いた折れ線で描く
function coastNodes(coast) {
  return [...coast.land.map((r) => polygon(r, 'land')), ...coast.lakes.map((r) => polygon(r, 'lake'))];
}

function edgeNodes(game) {
  return game.data.provinces.edges.map(([a, b]) => {
    const p = G.province(game, a);
    const q = G.province(game, b);
    return svgEl('line', { class: 'edge', x1: p.x, y1: p.y, x2: q.x, y2: q.y });
  });
}

function compact(n) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString('ja-JP');
}

function provinceNode(game, p, selectedId, onTap) {
  const clan = G.clanInfo(game, p.clan);
  const mine = p.clan === game.player;
  const g = svgEl('g', { class: `node${mine && p.acted ? ' done' : ''}`, role: 'button', tabindex: '0' });
  g.setAttribute('aria-label', `${p.name} ${clan.name}家 兵${p.troops}`);
  g.append(svgEl('circle', { cx: p.x, cy: p.y, r: HIT_RADIUS, fill: 'transparent' }));
  g.append(svgEl('circle', { cx: p.x, cy: p.y, r: RADIUS, fill: clan.color }));
  if (mine) g.append(svgEl('circle', { class: 'ring-mine', cx: p.x, cy: p.y, r: RADIUS + 0.9 }));
  if (p.id === selectedId) g.append(svgEl('circle', { class: 'ring-selected', cx: p.x, cy: p.y, r: RADIUS + 2.2 }));
  g.append(svgEl('text', { class: 'name', x: p.x, y: p.y - 0.2, 'text-anchor': 'middle', fill: clan.ink }, p.name));
  g.append(svgEl('text', { class: 'troops', x: p.x, y: p.y + 2.9, 'text-anchor': 'middle', fill: clan.ink }, compact(p.troops)));
  if (G.snowedIn(game, p)) g.append(svgEl('text', { class: 'snow', x: p.x + 4, y: p.y - 3.8 }, '❄'));
  if (p.rain) g.append(svgEl('text', { class: 'snow', x: p.x + 4, y: p.y + 6 }, '☔'));
  if (p.capital) g.append(svgEl('text', { class: 'snow', x: p.x - 7, y: p.y - 3.8 }, '京'));
  g.addEventListener('click', () => onTap(p.id));
  return g;
}

export function renderMap(svg, game, selectedId, onTap) {
  svg.replaceChildren(...coastNodes(game.data.coast), ...edgeNodes(game), ...game.provinces.map((p) => provinceNode(game, p, selectedId, onTap)));
}
