// The org chart as one self-contained web page: no network requests, no outside files.
//
// The chart is a nested list. Without scripting it is exactly that: every post, in reading order,
// each manager followed by their reports. With scripting it becomes a tree (WAI-ARIA tree pattern):
// arrow keys move, Right and Left open and close, Home and End jump, and a screen reader hears
// each post's level and place. Vacant and planned posts say so in words and have a border pattern
// of their own; color is never the only sign. Colors are the brand tokens, which pass 7:1 in both
// themes. The same rows follow as a table, and, when two dates are compared, a list of what changed.

import { readFileSync } from "node:fs";
import { orgRows, CHANGE } from "./views.mjs";
import { compareDates } from "./index.mjs";

const TOKENS = JSON.parse(readFileSync(new URL("../../brand/design-system/tokens.json", import.meta.url), "utf8"));
const color = (name, theme) => { const v = TOKENS.color.tokens.find((t) => t.name === name).value; return typeof v === "string" ? v : v[theme]; };
const vars = (theme) => ["surface-100", "surface-200", "surface-300", "ink", "ink-muted", "link", "border-control", "hairline", "focus-ring"].map((n) => `--${n}:${color(n, theme)}`).join(";");
const h = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root{${vars("light")};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${vars("dark")}}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface-100);color:var(--ink);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 .5rem}
h2{font-size:1.25rem;margin:2.5rem 0 .75rem}
p{margin:.5rem 0;max-width:70ch}
.muted{color:var(--ink-muted)}
.bar{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}
button{font:inherit;color:var(--ink);background:var(--surface-200);border:2px solid var(--border-control);border-radius:.4rem;padding:.5rem .9rem;min-height:2.75rem;cursor:pointer}
button:hover{background:var(--surface-300)}
:focus-visible{outline:3px solid var(--focus-ring);outline-offset:2px}
ul.chart,ul.chart ul{list-style:none;margin:0;padding:0}
ul.chart ul{margin-left:.6rem;padding-left:.9rem;border-left:2px solid var(--hairline)}
ul.chart li{margin:.5rem 0}
.post{display:block;background:var(--surface-200);border:2px solid var(--border-control);border-radius:.5rem;padding:.6rem .8rem}
.post.vacant{border-style:dashed;border-width:3px;background:var(--surface-100)}
.post.planned{border-style:dotted;border-width:3px;background:var(--surface-100)}
.post .t{font-weight:700;display:block}
.post .w{display:block}
.post .m{display:block;color:var(--ink-muted);font-size:.95rem}
.tag{font-weight:700}
.sep{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
li[aria-expanded="false"]>ul{display:none}
.twist{display:inline-block;width:1.2em;font-weight:700}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.95rem}
caption{text-align:left;font-weight:700;padding:.4rem 0}
th,td{text-align:left;vertical-align:top;padding:.45rem .6rem;border:1px solid var(--border-control)}
thead th{background:var(--surface-300)}
.dates{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0;margin:1rem 0}
.dates a{display:inline-block;color:var(--link);text-decoration:underline;border:2px solid var(--border-control);border-radius:.4rem;padding:.5rem .9rem;min-height:2.75rem;background:var(--surface-200)}
.dates a[aria-current="true"]{background:var(--ink);color:var(--surface-100);border-color:var(--ink)}
section[hidden]{display:none}
svg.drawing{display:block;max-width:none;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}
svg.drawing .box{fill:var(--surface-200);stroke:var(--border-control);stroke-width:2}
svg.drawing .box.vacant{fill:var(--surface-100);stroke-width:3;stroke-dasharray:8 5}
svg.drawing .box.planned{fill:var(--surface-100);stroke-width:3;stroke-dasharray:2 5}
svg.drawing .line{fill:none;stroke:var(--border-control);stroke-width:2}
svg.drawing text{fill:var(--ink)}
svg.drawing .t{font-weight:700}
svg.drawing .m{fill:var(--ink-muted)}
@media print{button,.bar,.dates{display:none}li[aria-expanded="false"]>ul{display:block}section[hidden]{display:block}}
`;

// Progressive enhancement: the list works without this. With it, the list is a tree.
const JS = `
(function(){
function init(tree){
var items=[].slice.call(tree.querySelectorAll('li'));
tree.setAttribute('role','tree');
items.forEach(function(li){
  li.setAttribute('role','treeitem');li.tabIndex=-1;
  var sub=li.querySelector(':scope > ul');
  if(sub){sub.setAttribute('role','group');li.setAttribute('aria-expanded','true');
    var tw=li.querySelector(':scope > .post .twist');if(tw)tw.textContent='\\u25BE ';}
  var level=1,p=li.parentElement;while(p&&p!==tree){if(p.tagName==='UL')level++;p=p.parentElement;}
  li.setAttribute('aria-level',level);
  var sibs=[].slice.call(li.parentElement.children);
  li.setAttribute('aria-setsize',sibs.length);li.setAttribute('aria-posinset',sibs.indexOf(li)+1);
  li.setAttribute('aria-labelledby',li.querySelector(':scope > .post').id);
});
function visible(){return items.filter(function(li){for(var p=li.parentElement.closest('li');p;p=p.parentElement.closest('li')){if(p.getAttribute('aria-expanded')==='false')return false;}return true;});}
function focus(li){items.forEach(function(x){x.tabIndex=-1;});li.tabIndex=0;li.focus();}
function set(li,open){if(!li.hasAttribute('aria-expanded'))return;li.setAttribute('aria-expanded',open?'true':'false');
  var tw=li.querySelector(':scope > .post .twist');if(tw)tw.textContent=open?'\\u25BE ':'\\u25B8 ';}
if(items[0])items[0].tabIndex=0;
tree.addEventListener('keydown',function(e){
  var li=e.target.closest('li');if(!li||e.target!==li)return;
  var v=visible(),i=v.indexOf(li),open=li.getAttribute('aria-expanded');
  switch(e.key){
    case 'ArrowDown':if(v[i+1])focus(v[i+1]);break;
    case 'ArrowUp':if(v[i-1])focus(v[i-1]);break;
    case 'ArrowRight':if(open==='false')set(li,true);else if(open==='true')focus(li.querySelector(':scope > ul > li'));break;
    case 'ArrowLeft':if(open==='true')set(li,false);else{var p=li.parentElement.closest('li');if(p)focus(p);}break;
    case 'Home':focus(v[0]);break;
    case 'End':focus(v[v.length-1]);break;
    case 'Enter':case ' ':if(open)set(li,open==='false');break;
    case '*':[].slice.call(li.parentElement.children).forEach(function(x){set(x,true);});break;
    default:return;
  }
  e.preventDefault();
});
tree.addEventListener('click',function(e){var li=e.target.closest('li');if(!li)return;
  if(e.target.closest('.post')&&li.hasAttribute('aria-expanded')&&li===e.target.closest('.post').parentElement)set(li,li.getAttribute('aria-expanded')==='false');
  items.forEach(function(x){x.tabIndex=-1;});li.tabIndex=0;});
var part=tree.closest('.part');
var bar=part&&part.querySelector('.bar');if(bar){bar.hidden=false;
  bar.querySelector('[data-all="open"]').addEventListener('click',function(){items.forEach(function(x){set(x,true);});});
  bar.querySelector('[data-all="close"]').addEventListener('click',function(){items.forEach(function(x){set(x,false);});});}
var help=part&&part.querySelector('.keys');if(help)help.hidden=false;
}
[].slice.call(document.querySelectorAll('ul.chart')).forEach(init);
// Several dates in one page: show one at a time. Without this script they follow one another.
var links=[].slice.call(document.querySelectorAll('.dates a'));
if(links.length){
  var sections=links.map(function(a){return document.getElementById(a.getAttribute('href').slice(1));});
  var show=function(i,move){sections.forEach(function(s,k){s.hidden=k!==i;});links.forEach(function(a,k){if(k===i)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});
    if(move){var h=sections[i].querySelector('h2');h.tabIndex=-1;h.focus();}};
  links.forEach(function(a,i){a.addEventListener('click',function(e){e.preventDefault();show(i,true);});});
  var start=links.findIndex(function(a){return a.getAttribute('href')===location.hash;});
  show(start<0?links.length-1:start,false);
}
})();
`;

const fit = (text, max) => { const t = String(text ?? ""); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

/**
 * The chart drawn as boxes and lines: each post under the one it reports to. It is a picture of what
 * the list says, for people who want the shape at a glance; the list and the table carry the content.
 * @param {object} org
 * @param {{ on?: string, standalone?: boolean }} [options]  standalone: an SVG file of its own, with its colors written in
 * @returns {string} SVG
 */
export function orgSvg(org, options = {}) {
  const { state, rows } = orgRows(org, options);
  const row = new Map(rows.map((r) => [r.id, r]));
  const byId = new Map(state.posts.map((p) => [p.id, p]));
  const W = 220, H = 66, GX = 24, GY = 44, PAD = 12;
  const pos = new Map();
  let next = 0;
  const place = (id, depth) => {
    const kids = byId.get(id).reports;
    let x;
    if (!kids.length) x = next++;
    else { const xs = kids.map((k) => place(k, depth + 1)); x = (xs[0] + xs.at(-1)) / 2; }
    pos.set(id, { x: PAD + x * (W + GX), y: PAD + (depth - 1) * (H + GY) });
    return x;
  };
  for (const r of state.roots) place(r, 1);
  const width = Math.max(1, next) * (W + GX) - GX + PAD * 2;
  const height = Math.max(1, ...state.posts.map((p) => p.depth)) * (H + GY) - GY + PAD * 2;
  const lines = state.posts.filter((p) => p.manager).map((p) => {
    const a = pos.get(p.manager), b = pos.get(p.id), mid = a.y + H + GY / 2;
    return `<path class="line" d="M${a.x + W / 2} ${a.y + H}V${mid}H${b.x + W / 2}V${b.y}"/>`;
  });
  const boxes = state.posts.map((p) => {
    const { x, y } = pos.get(p.id), r = row.get(p.id);
    const who = p.status === "filled" ? r.holder : p.status === "vacant" ? "Vacant" : `Planned, from ${p.starts}`;
    return `<g><rect class="box ${p.status}" x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/><text class="t" x="${x + 10}" y="${y + 24}">${h(fit(p.title, 27))}</text><text x="${x + 10}" y="${y + 43}">${h(fit(who, 30))}</text><text class="m" x="${x + 10}" y="${y + 58}" font-size="12">${h(fit(r.unit, 34))}</text></g>`;
  });
  const label = `${org.meta.name} on ${state.on}: ${state.posts.length} post${state.posts.length === 1 ? "" : "s"}, each drawn under the post it reports to. A dashed box is vacant; a dotted box is planned.`;
  const own = options.standalone ? `<style>svg{font:14px system-ui,sans-serif}.box{fill:${color("surface-200", "light")};stroke:${color("border-control", "light")};stroke-width:2}.box.vacant{fill:#fff;stroke-width:3;stroke-dasharray:8 5}.box.planned{fill:#fff;stroke-width:3;stroke-dasharray:2 5}.line{fill:none;stroke:${color("border-control", "light")};stroke-width:2}text{fill:${color("ink", "light")}}.t{font-weight:700}.m{fill:${color("ink-muted", "light")}}</style><rect width="100%" height="100%" fill="#fff"/>` : "";
  return `<svg${options.standalone ? ' xmlns="http://www.w3.org/2000/svg"' : ' class="drawing"'} role="img" aria-label="${h(label)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${h(label)}</title>${own}${lines.join("")}${boxes.join("")}</svg>${options.standalone ? "\n" : ""}`;
}

// One date's chart, table, drawing and (when there is an earlier date to compare with) changes.
function part(org, options, level, key) {
  const { state, rows } = orgRows(org, options);
  const row = new Map(rows.map((r) => [r.id, r]));
  const count = (s) => state.posts.filter((p) => p.status === s).length;
  const H = (n, text, attrs = "") => `<h${level + n}${attrs}>${text}</h${level + n}>`;
  const item = (id) => {
    const p = state.posts.find((x) => x.id === id), r = row.get(id);
    const kids = p.reports;
    // Everything a reader needs is in the text: the title, who holds it, and, in words, whether it is vacant or planned.
    const who = p.status === "filled" ? h(r.holder) + (r.pronouns ? ` <span class="muted">(${h(r.pronouns)})</span>` : "") : `<span class="tag">${h(r.status)}</span>`;
    const meta = [r.unit, kids.length ? `${kids.length} direct report${kids.length === 1 ? "" : "s"}` : "", r.dotted ? `dotted line to ${r.dotted}` : "", options.budget && r.band ? `band ${r.band}` : "", options.budget && r.annualCost ? r.annualCost : ""].filter(Boolean).map(h).join(" · ");
    return `<li><span class="post ${p.status}" id="p${key}-${h(id)}"><span class="t">${kids.length ? '<span class="twist" aria-hidden="true"></span>' : ""}${h(p.title)}</span><span class="sep">: </span><span class="w">${who}</span>${meta ? `<span class="sep">. </span><span class="m">${meta}</span>` : ""}</span>${kids.length ? `<ul>${kids.map(item).join("")}</ul>` : ""}</li>`;
  };
  const head = ["Level", "Post", "Held by", "Unit", "Reports to", "Status", ...(options.budget ? ["Band", "FTE", "Annual cost"] : [])];
  const cells = (r) => [r.level, r.title, r.holder + (r.pronouns ? ` (${r.pronouns})` : ""), r.unit, r.reportsTo + (r.dotted ? ` (dotted line to ${r.dotted})` : ""), r.status, ...(options.budget ? [r.band, r.fte, r.annualCost] : [])];
  let changes = "";
  if (options.compare) {
    const [from, to] = [options.compare, state.on].sort();
    const diff = compareDates(org, from, to, options);
    changes = `${H(1, `What changed from ${h(from)} to ${h(to)}`)}${diff.changes.length
      ? `<div class="wrap" tabindex="0" role="group" aria-label="Table of changes"><table><caption>Changes, grouped by kind</caption><thead><tr><th scope="col">Change</th><th scope="col">Post</th><th scope="col">Detail</th></tr></thead><tbody>${diff.changes.map((c) => `<tr><td>${h(CHANGE[c.kind])}</td><th scope="row">${h(c.title)}</th><td>${h(c.detail)}</td></tr>`).join("")}</tbody></table></div>`
      : "<p>Nothing changed.</p>"}`;
  }
  return `<div class="part">
<p>${count("filled")} filled, ${count("vacant")} vacant, ${count("planned")} planned. A vacant post has a dashed border and says "Vacant"; a planned post has a dotted border and says "Planned".</p>
${H(1, "Chart", ` id="chart-h${key}"`)}
<p class="keys muted" hidden>Move with the arrow keys: Up and Down between posts, Right to open a post's reports, Left to close them or go to its manager. Home and End go to the first and last post.</p>
<div class="bar" hidden><button type="button" data-all="open">Open all</button><button type="button" data-all="close">Close all</button></div>
${state.roots.length ? `<ul class="chart" aria-labelledby="chart-h${key}">${state.roots.map(item).join("")}</ul>` : "<p>No posts on this date.</p>"}
${H(1, "The same, as a table")}
<div class="wrap" tabindex="0" role="group" aria-label="Table of posts"><table><caption>One row per post, each manager followed by their reports. Level 1 reports to nobody in this chart.</caption>
<thead><tr>${head.map((x) => `<th scope="col">${h(x)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${cells(r).map((c, i) => (i === 1 ? `<th scope="row">${h(c)}</th>` : `<td>${h(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>
${state.roots.length ? `${H(1, "The same, as a drawing")}
<p class="muted">A picture of the chart above, for its shape at a glance. It says nothing the chart and the table do not.</p>
<div class="wrap" tabindex="0" role="group" aria-label="Drawing of the chart; scroll sideways to see all of it">${orgSvg(org, options)}</div>` : ""}
${changes}
</div>`;
}

/**
 * @param {object} org  a valid organization file
 * @param {{ on?: string, compare?: string, dates?: string[], budget?: boolean, lang?: string }} [options]
 *   dates: several dates in one page, to switch between; each is compared with the one before it
 * @returns {string} an HTML document
 */
export function orgHtml(org, options = {}) {
  const dates = options.dates?.length ? [...new Set(options.dates)].sort() : undefined;
  const title = dates ? `${org.meta.name}: organization from ${dates[0]} to ${dates.at(-1)}` : `${org.meta.name}: organization on ${options.on ?? new Date().toISOString().slice(0, 10)}`;
  const main = dates
    ? `<nav aria-label="Dates"><ul class="dates">${dates.map((d) => `<li><a href="#d-${d}">${d}</a></li>`).join("")}</ul></nav>
${dates.map((d, i) => `<section id="d-${d}"><h2>On ${d}</h2>\n${part(org, { ...options, on: d, compare: i ? dates[i - 1] : undefined }, 2, i)}</section>`).join("\n")}`
    : part(org, { ...options, on: options.on ?? new Date().toISOString().slice(0, 10) }, 1, "");
  return `<!doctype html>
<html lang="${h(options.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${h(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${h(title)}</h1>
${options.budget ? '<p><strong>Internal.</strong> This page includes budget figures.</p>' : ""}
${main}
</main>
<script>${JS}</script>
</body>
</html>
`;
}
