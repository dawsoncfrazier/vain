// Illustrations the model draws on request or on its own initiative. Same safety filter as backgrounds; never persistent by itself.
import { runChat } from "./engine.js";
import { sanitizeSvg } from "./scene.js";
const RULES = "Draw ONE clear illustration of the subject as an SVG, viewBox 0 0 600 400, flat shapes with a coherent palette on a dark-friendly background. Allowed elements only: svg g defs linearGradient radialGradient stop rect circle ellipse path polygon polyline line filter feGaussianBlur. No text, no images, no links, no scripts, no event attributes. Colours as #rrggbb. Under 6000 characters. Output ONLY the <svg>...</svg>.";
export async function drawArt(env, subject) {
  subject = String(subject || "").trim().slice(0, 300);
  if (subject.length < 2) throw Object.assign(new Error("Tell me what to draw."), { status: 400 });
  const r = await runChat(env, [{ role: "system", content: RULES }, { role: "user", content: subject }], { tier: "best", max_tokens: 2500, temperature: 0.8 });
  const svg = sanitizeSvg(r.text.slice(Math.max(0, r.text.search(/<svg/i))));
  if (!svg) throw Object.assign(new Error("The drawing didn't pass the safety filter. Try asking again."), { status: 422 });
  return { subject, svg, engine: r.engine };
}
