// Deterministic intent detection: decides which workspace panel the conversation should open.
// Kept rule-based on purpose: the hosted model is never trusted to decide what changes the interface.
const CHANGE_VERBS = "(?:change|make|add|rename|remove|delete|fix|update|redesign|restyle|move|hide|show|swap|replace|tweak|improve|tidy|resize|recolou?r|darken|lighten|brighten)";
const SITE_NOUNS = "(?:page|site|website|webpage|sidebar|button|colou?rs?|background|backdrop|wallpaper|theme|layout|font|title|header|footer|menu|ui|interface|icon|logo|spacing|style|accent|banner|card|panel|tagline|scene|chat)";
const SITE_CHANGE = new RegExp("^\\s*(?:vain[,:]?\\s+)?(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+|i\\s+want\\s+you\\s+to\\s+|i(?:'d|\\s+would)\\s+like\\s+you\\s+to\\s+|let'?s\\s+)?" + CHANGE_VERBS + "\\b", "i");
const SITE_NOUN = new RegExp("\\b" + SITE_NOUNS + "\\b", "i");

export const HELP = [
  "Everything happens here in the chat. Talk to me naturally and what you ask for appears as a bubble:",
  "- \"make the background unicorns\" shows a preview bubble with Accept, Deny and Amend.",
  "- \"remember this: ...\" saves it, with an Undo.",
  "- \"go learn about black holes\" reads open sources and comes back with a summary, citations and pictures.",
  "- \"open the lab\" turns the whole page into a simulation; everything you type becomes part of it. \"close\" leaves it.",
  "- Also: \"show my memory\", \"what's new in research\", \"which engine are you using\", \"show training data\", \"my past chats\", \"ask me something\".",
  "Nothing permanent about my appearance changes until you accept it. Rollback and the kill switch stay outside the chat.",
].join("\n");

// "hey vain, ..." / "vain: ..." is addressing me, not part of the request.
export const stripAddress = (raw) => String(raw || "").trim().replace(/^(?:hey|hi|ok|okay|yo)?\s*,?\s*vain\s*[,:!\-]*\s*/i, "").trim();
const VAGUE = /^(?:this|that|it|something|anything|stuff)$/i;

export function detectIntent(raw) {
  const m = stripAddress(raw); const low = m.toLowerCase().replace(/[.!]+$/, "");
  if (!m) return null;
  if (low === "/help" || low === "help") return { kind: "help" };
  if (/^(?:\/close|close|dismiss|hide|exit|leave|back to chat|(?:close|exit|leave|stop|end)\s+(?:the\s+)?(?:lab|simulation|sim|labspace|lab mode|this))$/.test(low)) return { kind: "close" };
  if (low === "/memory" || /^(?:show|open|list|view|display)\s+(?:me\s+)?(?:my\s+|your\s+|the\s+)?(?:saved\s+)?(?:memory|memories)\b/.test(low) || /^what do you (?:remember|know) about me\b/.test(low)) return { kind: "block", block: "memories" };
  const learn = m.match(/^(?:please\s+)?(?:go\s+)?(?:and\s+)?(?:learn|read up|look up|research|find out|dig into|study)\s+(?:more\s+)?(?:about\s+|on\s+|into\s+)?(.{1,200}?)[.!]?$/i);
  if (learn && !/\?\s*$/.test(m)) return VAGUE.test(learn[1].trim()) ? { kind: "learn_vague" } : { kind: "learn", topic: learn[1].trim() };
  if (low === "/research" || /^(?:show|open|refresh|get|give me|pull up)\b.*\b(?:research|briefing)\b/.test(low) || /^what(?:'s| is) new (?:in|with) (?:ai|science|research)\b/.test(low)) return { kind: "block", block: "briefing" };
  if (low === "/lab" || /^(?:open|enter|go to|take me to|switch to|start|launch|begin)\s+(?:the\s+|my\s+)?(?:lab|labspace|lab space|lab mode|simulation|sim)\b/.test(low) || /^let'?s\s+(?:open|enter|work in|use|go to)\s+(?:the\s+)?lab\b/.test(low)) return { kind: "lab" };
  if (/^(?:show|open|review|prepare|build)\s+(?:me\s+)?(?:the\s+|my\s+)?(?:training\s+(?:data|examples|files)|dataset|fine-?tun\w*(?:\s+data)?)\b/.test(low) || low === "/data") return { kind: "block", block: "labdata" };
  if (low === "/engines" || low === "/status" || low === "status" || /\bwhich (?:model|engine)\b.*\b(?:using|running|are you)\b/.test(low) || /\bare you (?:using|running on) (?:my |the )?mac\b/.test(low) || /^(?:show|open)\s+(?:the\s+)?(?:engines?|status)\b/.test(low)) return { kind: "block", block: "engines" };
  if (/^(?:show|open|list)\s+(?:me\s+)?(?:my\s+)?(?:past|previous|old)\s+(?:chats?|conversations?)\b/.test(low) || /^my (?:past|previous) (?:chats?|conversations?)\b/.test(low) || low === "/history") return { kind: "block", block: "sessions" };
  if (low === "/question" || /^ask me (?:something|a question|one)\b/.test(low)) return { kind: "question" };
  if (low === "/skip") return { kind: "skip" };
  if (low.startsWith("/site") || low.startsWith("/change")) { const g = m.replace(/^\/\w+\s*/, "").trim(); return g ? { kind: "site_change", goal: g } : { kind: "help_site" }; }
  if (SITE_CHANGE.test(m) && SITE_NOUN.test(m) && m.length <= 1200 && !/\?\s*$/.test(m)) return { kind: "site_change", goal: m };
  return null;
}
