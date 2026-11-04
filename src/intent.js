// Deterministic intent detection: decides which workspace panel the conversation should open.
// Kept rule-based on purpose: the hosted model is never trusted to decide what changes the interface.
const CHANGE_VERBS = "(?:change|make|add|rename|remove|delete|fix|update|redesign|restyle|move|hide|show|swap|replace|tweak|improve|tidy|resize|recolou?r|darken|lighten|brighten)";
const SITE_NOUNS = "(?:page|site|website|webpage|sidebar|button|colou?rs?|background|theme|layout|font|title|header|footer|menu|ui|interface|icon|logo|spacing|style|accent|banner|card|panel|tagline)";
const SITE_CHANGE = new RegExp("^\\s*(?:vain[,:]?\\s+)?(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+|i\\s+want\\s+you\\s+to\\s+|i(?:'d|\\s+would)\\s+like\\s+you\\s+to\\s+|let'?s\\s+)?" + CHANGE_VERBS + "\\b", "i");
const SITE_NOUN = new RegExp("\\b" + SITE_NOUNS + "\\b", "i");

export const HELP = [
  "Everything happens in this chat; panels open beside it when the conversation calls for them.",
  "- Say things naturally: \"show my memory\", \"what's new in AI research\", \"let's work on training data\", \"which model are you using\", \"make the background darker blue\".",
  "- Commands: /memory /research /lab /engines /site <change> /question /skip /close /help",
  "- Facts about you are remembered when you state them (\"I graduated in 2026\"). \"Forget <text>\" removes one. Questions are never saved as facts.",
  "- Site changes are proposals: you see them first and approve or discard. Code-level changes arrive with the Mac studio.",
  "- Rollback and the kill switch are outside the chat on purpose.",
].join("\n");

export function detectIntent(raw) {
  const m = (raw || "").trim(); const low = m.toLowerCase();
  if (!m) return null;
  if (low === "/help" || low === "help") return { kind: "help" };
  if (low === "/close" || /^(?:close|hide|dismiss)(?:\s+it)?[.!]?$/.test(low) || /^(?:close|hide|dismiss|go back from|back to)\s+(?:the\s+)?(?:panel|stage|lab|memory|research|this|chat)\b/.test(low)) return { kind: "close" };
  if (low === "/memory" || /^(?:show|open|list|view|display)\s+(?:me\s+)?(?:my\s+|your\s+|the\s+)?(?:saved\s+)?(?:memory|memories)\b/.test(low) || /^what do you (?:remember|know) about me\b/.test(low)) return { kind: "panel", mode: "memory" };
  if (low === "/research" || /^(?:show|open|refresh|get|give me|pull up)\b.*\b(?:research|briefing)\b/.test(low) || /^what(?:'s| is) new (?:in|with) (?:ai|science|research)\b/.test(low)) return { kind: "panel", mode: "research" };
  if (low === "/lab" || /^(?:open|show|enter|go to|take me to|switch to|start|let'?s (?:work on|open|do))\s+(?:the\s+|my\s+)?(?:lab|labspace|lab space|training(?: data)?|dataset|fine-?tun\w*)\b/.test(low) || /\b(?:prepare|build|assemble)\b.*\b(?:training (?:data|files|set)|dataset)\b/.test(low) || /^let'?s (?:train|fine-?tune|distill|merge)\b/.test(low)) return { kind: "panel", mode: "lab" };
  if (low === "/engines" || low === "/status" || low === "status" || /\bwhich (?:model|engine)\b.*\b(?:using|running|are you)\b/.test(low) || /\bare you (?:using|running on) (?:my |the )?mac\b/.test(low) || /^(?:show|open)\s+(?:the\s+)?(?:engines?|status)\b/.test(low)) return { kind: "panel", mode: "engines" };
  if (low === "/question" || /^ask me (?:something|a question|one)\b/.test(low)) return { kind: "question" };
  if (low === "/skip") return { kind: "skip" };
  if (low.startsWith("/site") || low.startsWith("/change")) { const g = m.replace(/^\/\w+\s*/, "").trim(); return g ? { kind: "site_change", goal: g } : { kind: "help_site" }; }
  if (SITE_CHANGE.test(m) && SITE_NOUN.test(m) && m.length <= 1200 && !/\?\s*$/.test(m)) return { kind: "site_change", goal: m };
  return null;
}
