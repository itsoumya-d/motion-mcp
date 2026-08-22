import ts from "typescript";

export interface PatchResult {
  content: string;
  changed: boolean;
  notes: string[];
}

interface ImportInfo {
  imported: Set<string>;
  lastImportEnd: number;
}

function collectImports(sourceFile: ts.SourceFile): Record<string, ImportInfo> {
  const imports: Record<string, ImportInfo> = {};
  let lastImportEnd = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    lastImportEnd = Math.max(lastImportEnd, statement.end);
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const entry = imports[specifier] ?? { imported: new Set<string>(), lastImportEnd: 0 };
    const clause = statement.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        entry.imported.add(element.name.text);
      }
    }
    entry.lastImportEnd = lastImportEnd;
    imports[specifier] = entry;
  }
  return imports;
}

/**
 * Ensures the given symbols are imported from `specifier`.
 *
 * Never rewrites an existing import statement — missing symbols are covered by
 * an additional import from the same module, which TypeScript accepts and
 * which keeps the patch surgical. Idempotent.
 */
export function ensureImport(source: string, specifier: string, symbols: string[]): PatchResult {
  const notes: string[] = [];
  const sourceFile = ts.createSourceFile("patch.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = collectImports(sourceFile);
  const existing = imports[specifier]?.imported ?? new Set<string>();
  const missing = symbols.filter((symbol) => !existing.has(symbol));
  if (missing.length === 0) {
    return { content: source, changed: false, notes: ["imports already satisfied"] };
  }
  const insertionPoint = imports[specifier]?.lastImportEnd ?? Object.values(imports).at(-1)?.lastImportEnd ?? 0;
  const line = `import { ${missing.join(", ")} } from "${specifier}";`;
  const at = insertionPoint === 0 ? 0 : endOfLine(source, insertionPoint);
  const content = `${source.slice(0, at)}${source.length > 0 && at > 0 ? "\n" : ""}${line}${source.slice(at)}`;
  notes.push(`added import of ${missing.join(", ")} from "${specifier}"`);
  return { content, changed: true, notes };
}

/** True when the file already renders <Component somewhere. */
export function rendersComponent(source: string, componentName: string): boolean {
  return new RegExp(`<\\s*${componentName}[\\s/>]`).test(source);
}

/**
 * Inserts a `<ComponentName />` usage after the JSX line containing
 * `anchorText`. Refuses to touch files that already render the component or
 * that lack the anchor — safety over cleverness.
 */
export function insertComponentUsageAfterAnchor(
  source: string,
  componentName: string,
  anchorText: string,
  propsLiteral = ""
): PatchResult {
  const notes: string[] = [];
  if (rendersComponent(source, componentName)) {
    return { content: source, changed: false, notes: [`${componentName} is already rendered`] };
  }
  const anchorIndex = source.indexOf(anchorText);
  if (anchorIndex === -1) {
    return { content: source, changed: false, notes: [`anchor not found: ${anchorText}`] };
  }
  const lineEnd = endOfLine(source, anchorIndex + anchorText.length);
  const indentMatch = /^[\t ]*/.exec(source.slice(source.lastIndexOf("\n", anchorIndex) + 1));
  const indent = indentMatch?.[0] ?? "";
  const usage = `\n${indent}<${componentName} ${propsLiteral} />`;
  return {
    content: `${source.slice(0, lineEnd)}${usage}${source.slice(lineEnd)}`,
    changed: true,
    notes: [`rendered <${componentName} /> after anchor "${anchorText.slice(0, 40)}"`]
  };
}

function endOfLine(source: string, from: number): number {
  const nextNewline = source.indexOf("\n", from);
  return nextNewline === -1 ? source.length : nextNewline;
}
