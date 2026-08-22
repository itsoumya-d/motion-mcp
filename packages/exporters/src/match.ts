import type { SvgNodeInfo } from "@motion-mcp/shared-types";
import { flattenSvgNodes } from "@motion-mcp/svg-parser";

/** Part-matching convention shared with the player and emitters. */
export function partTokens(node: SvgNodeInfo): string[] {
  return [node.nodeId, node.id ?? "", node.semanticLabel ?? "", node.roleGuess]
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export function tokensMatch(targetPart: string, tokens: string[]): boolean {
  const needle = targetPart.toLowerCase();
  if (needle === "*") return false;
  return tokens.some((token) => token.includes(needle) || needle.includes(token));
}

export function flattenTree(root: SvgNodeInfo): SvgNodeInfo[] {
  return flattenSvgNodes(root);
}
