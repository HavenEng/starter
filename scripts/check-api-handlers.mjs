import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await check(path);
      continue;
    }
    if (!/^route\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let imported = false;
    let complete = false;
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.moduleSpecifier.text === "@/lib/api/handler" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        imported ||= statement.importClause.namedBindings.elements.some(
          (element) =>
            element.name.text === "apiRoute" && !element.propertyName,
        );
      }
      if (
        !statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      )
        continue;
      if (
        ts.isExportDeclaration(statement) ||
        (ts.isFunctionDeclaration(statement) &&
          methods.includes(statement.name?.text))
      )
        throw new Error(`Unwrapped API export: ${path}`);
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isObjectBindingPattern(declaration.name)) {
          const names = declaration.name.elements.map((element) =>
            element.name.getText(source),
          );
          if (
            !methods.every((method) => names.includes(method)) ||
            !declaration.initializer ||
            !ts.isCallExpression(declaration.initializer) ||
            declaration.initializer.expression.getText(source) !== "apiRoute"
          )
            throw new Error(`Incomplete API factory: ${path}`);
          complete = true;
        } else if (methods.includes(declaration.name.getText(source)))
          throw new Error(`Unwrapped API handler: ${path}`);
      }
    }
    if (!imported || !complete)
      throw new Error(
        `API route must export every method through apiRoute: ${path}`,
      );
  }
}
await check("src/app/api");
console.log("All API methods use the shared factory.");
