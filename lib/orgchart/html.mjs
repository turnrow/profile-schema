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
@media print{button,.bar{display:none}li[aria-expanded="false"]>ul{display:block}}
`;

// Progressive enhancement: the list works without this. With it, the list is a tree.
const JS = `
(function(){
var tree=document.querySelector('ul.chart');if(!tree)return;
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
var bar=document.querySelector('.bar');if(bar){bar.hidden=false;
  bar.querySelector('[data-all="open"]').addEventListener('click',function(){items.forEach(function(x){set(x,true);});});
  bar.querySelector('[data-all="close"]').addEventListener('click',function(){items.forEach(function(x){set(x,false);});});}
var help=document.getElementById('keys');if(help)help.hidden=false;
})();
`;

const STATUS_WORD = { filled: "", vacant: "Vacant", planned: "Planned" };

/**
 * @param {object} org  a valid organization file
 * @param {{ on?: string, compare?: string, budget?: boolean, lang?: string }} [options]
 * @returns {string} an HTML document
 */
export function orgHtml(org, options = {}) {
  const { state, rows } = orgRows(org, options);
  const row = new Map(rows.map((r) => [r.id, r]));
  const count = (s) => state.posts.filter((p) => p.status === s).length;
  const item = (id) => {
    const p = state.posts.find((x) => x.id === id), r = row.get(id);
    const kids = p.reports;
    // Everything a reader needs is in the text: the title, who holds it, and, in words, whether it is vacant or planned.
    const who = p.status === "filled" ? h(r.holder) + (r.pronouns ? ` <span class="muted">(${h(r.pronouns)})</span>` : "") : `<span class="tag">${h(r.status)}</span>`;
    const meta = [r.unit, kids.length ? `${kids.length} direct report${kids.length === 1 ? "" : "s"}` : "", r.dotted ? `dotted line to ${r.dotted}` : "", options.budget && r.band ? `band ${r.band}` : "", options.budget && r.annualCost ? r.annualCost : ""].filter(Boolean).map(h).join(" · ");
    return `<li><span class="post ${p.status}" id="p-${h(id)}"><span class="t">${kids.length ? '<span class="twist" aria-hidden="true"></span>' : ""}${h(p.title)}</span><span class="sep">: </span><span class="w">${who}</span>${meta ? `<span class="sep">. </span><span class="m">${meta}</span>` : ""}</span>${kids.length ? `<ul>${kids.map(item).join("")}</ul>` : ""}</li>`;
  };
  const head = ["Level", "Post", "Held by", "Unit", "Reports to", "Status", ...(options.budget ? ["Band", "FTE", "Annual cost"] : [])];
  const cells = (r) => [r.level, r.title, r.holder + (r.pronouns ? ` (${r.pronouns})` : ""), r.unit, r.reportsTo + (r.dotted ? ` (dotted line to ${r.dotted})` : ""), r.status, ...(options.budget ? [r.band, r.fte, r.annualCost] : [])];
  let changes = "";
  if (options.compare) {
    const [from, to] = [options.compare, state.on].sort();
    const diff = compareDates(org, from, to, options);
    changes = `<h2>What changed from ${h(from)} to ${h(to)}</h2>${diff.changes.length
      ? `<div class="wrap"><table><caption>Changes, grouped by kind</caption><thead><tr><th scope="col">Change</th><th scope="col">Post</th><th scope="col">Detail</th></tr></thead><tbody>${diff.changes.map((c) => `<tr><td>${h(CHANGE[c.kind])}</td><th scope="row">${h(c.title)}</th><td>${h(c.detail)}</td></tr>`).join("")}</tbody></table></div>`
      : "<p>Nothing changed.</p>"}`;
  }
  const title = `${org.meta.name}: organization on ${state.on}`;
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
<p>${count("filled")} filled, ${count("vacant")} vacant, ${count("planned")} planned. A vacant post has a dashed border and says "Vacant"; a planned post has a dotted border and says "Planned".</p>
<h2 id="chart-h">Chart</h2>
<p id="keys" class="muted" hidden>Move with the arrow keys: Up and Down between posts, Right to open a post's reports, Left to close them or go to its manager. Home and End go to the first and last post.</p>
<div class="bar" hidden><button type="button" data-all="open">Open all</button><button type="button" data-all="close">Close all</button></div>
${state.roots.length ? `<ul class="chart" aria-labelledby="chart-h">${state.roots.map(item).join("")}</ul>` : "<p>No posts on this date.</p>"}
<h2>The same, as a table</h2>
<div class="wrap"><table><caption>One row per post, each manager followed by their reports. Level 1 reports to nobody in this chart.</caption>
<thead><tr>${head.map((x) => `<th scope="col">${h(x)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${cells(r).map((c, i) => (i === 1 ? `<th scope="row">${h(c)}</th>` : `<td>${h(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>
${changes}
</main>
<script>${JS}</script>
</body>
</html>
`;
}
