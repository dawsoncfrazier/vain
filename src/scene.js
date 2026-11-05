// Scene backgrounds: the model may draw an SVG, but only a small drawing vocabulary survives.
// No scripts, text, links, images or external references. The page shows it through <img>, which cannot run code.
const TAGS = new Set(["svg", "g", "defs", "lineargradient", "radialgradient", "stop", "rect", "circle", "ellipse", "path", "polygon", "polyline", "line", "filter", "fegaussianblur"]);
const CANON = { lineargradient: "linearGradient", radialgradient: "radialGradient", fegaussianblur: "feGaussianBlur" };
const ATTRS = new Set(["viewbox", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "d", "points", "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "transform", "offset", "stop-color", "stop-opacity", "id", "gradientunits", "gradienttransform", "fx", "fy", "preserveaspectratio", "stroke-linecap", "stroke-linejoin", "stddeviation", "filter", "fill-rule"]);
const ATTR_CANON = { viewbox: "viewBox", gradientunits: "gradientUnits", gradienttransform: "gradientTransform", preserveaspectratio: "preserveAspectRatio", stddeviation: "stdDeviation" };
export const MAX_SVG = 14000;

function cleanValue(v) {
  if (/[<>&\\]|javascript|data:|expression|@import/i.test(v)) return null;
  const urls = v.match(/url\([^)]*\)/gi) || [];
  if (urls.some(u => !/^url\(#[\w-]+\)$/i.test(u))) return null;
  return v.length <= 800 ? v : null;
}

export function sanitizeSvg(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const start = s.search(/<svg[\s>]/i), end = s.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < 0) return null;
  s = s.slice(start, end + 6);
  if (s.length > MAX_SVG) return null;
  const out = []; let open = []; let sawRoot = false;
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^<>]*?)?)(\/?)>/g; let m, last = 0;
  while ((m = re.exec(s))) {
    const between = s.slice(last, m.index); last = re.lastIndex;
    if (between.trim()) continue; // text content is dropped
    const closing = m[1] === "/", name = m[2].toLowerCase(), selfClose = m[4] === "/";
    if (!TAGS.has(name)) { if (!closing && !selfClose) return null; continue; } // unknown element: refuse the whole drawing
    const tag = CANON[name] || name;
    if (closing) { if (open.pop() !== tag) return null; out.push("</" + tag + ">"); continue; }
    let attrs = ""; const ar = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
    while ((a = ar.exec(m[3]))) {
      const an = a[1].toLowerCase(); if (!ATTRS.has(an)) continue;
      const val = cleanValue(a[3] ?? a[4] ?? ""); if (val === null) return null;
      attrs += " " + (ATTR_CANON[an] || an) + '="' + val + '"';
    }
    if (tag === "svg") { if (sawRoot) return null; sawRoot = true; attrs = attrs.replace(/ (width|height)="[^"]*"/g, ""); if (!/viewBox=/.test(attrs)) attrs += ' viewBox="0 0 1000 600"'; attrs += ' xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"'; attrs = attrs.replace(/ preserveAspectRatio="[^"]*"(?=.*preserveAspectRatio)/, ""); }
    out.push("<" + tag + attrs + (selfClose ? "/>" : ">")); if (!selfClose) open.push(tag);
  }
  if (!sawRoot || open.length) return null;
  const svg = out.join("");
  return /<(rect|circle|ellipse|path|polygon|polyline|line)[\s/>]/.test(svg) ? svg : null;
}
