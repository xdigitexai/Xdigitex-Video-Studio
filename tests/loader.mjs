import { statSync } from "node:fs";

function isFile(url) {
  try {
    return statSync(new URL(url)).isFile();
  } catch {
    return false;
  }
}

/**
 * Node resolves extensionless relative imports for TypeScript sources here,
 * matching the bundler resolution the app uses.
 */
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    /\.(ts|tsx|mts)$/.test(context.parentURL)
  ) {
    const base = new URL(specifier, context.parentURL);
    const candidates = [base.href, `${base.href}.ts`, `${base.href}.tsx`, `${base.href}/index.ts`];
    for (const candidate of candidates) {
      if (isFile(candidate)) return nextResolve(candidate, context);
    }
  }
  return nextResolve(specifier, context);
}
