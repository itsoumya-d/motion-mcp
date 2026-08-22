/**
 * Minimal CSS rule extraction from SVG <style> blocks.
 * Supports class, id, tag, and compound tag.class selectors — enough for
 * real-world exported SVGs (Illustrator, Figma, Inkscape).
 */

export interface CssRule {
  selector: string;
  declarations: Record<string, string>;
  specificity: number;
}

const DECLARATION_SPLIT = /;\s*/;
const KEY_VALUE_SPLIT = /:\s*/;

function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of body.split(DECLARATION_SPLIT)) {
    const [key, ...rest] = chunk.split(KEY_VALUE_SPLIT);
    if (!key || rest.length === 0) continue;
    out[key.trim().toLowerCase()] = rest.join(":").trim();
  }
  return out;
}

function specificityOf(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const tags = (selector.replace(/[.#][\w-]+/g, "").match(/[\w-]+/g) ?? []).length;
  return ids * 100 + classes * 10 + tags;
}

/** Extracts rules from CSS text. At-rules and their contents are skipped. */
export function parseCssRules(cssText: string): CssRule[] {
  const withoutAt = cssText.replace(/@[\w-]+[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, " ");
  const rules: CssRule[] = [];
  const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(withoutAt))) {
    const selectorText = match[1] ?? "";
    const declarations = parseDeclarations(match[2] ?? "");
    if (Object.keys(declarations).length === 0) continue;
    for (const rawSelector of selectorText.split(",")) {
      const selector = rawSelector.trim();
      if (!selector) continue;
      rules.push({ selector, declarations, specificity: specificityOf(selector) });
    }
  }
  return rules;
}

/**
 * Collects the declarations that apply to an element.
 * @param tag local element tag name
 * @param classList class attribute split into tokens
 */
export function matchingDeclarations(
  rules: CssRule[],
  tag: string,
  id?: string,
  classList: string[] = []
): Record<string, string> {
  const applied: Record<string, string> = {};
  const applicable = rules
    .filter((rule) => selectorMatches(rule.selector, tag, id, classList))
    .sort((a, b) => a.specificity - b.specificity);
  for (const rule of applicable) {
    Object.assign(applied, rule.declarations);
  }
  return applied;
}

function selectorMatches(selector: string, tag: string, id?: string, classList: string[] = []): boolean {
  return selector.split(/(?=\.)|(?=#)/).every((part) => {
    if (part.startsWith(".")) return classList.includes(part.slice(1));
    if (part.startsWith("#")) return id !== undefined && part.slice(1) === id;
    const descendantParts = part.trim().split(/\s+/);
    return descendantParts.every((name) => name === "*" || name === tag);
  });
}
