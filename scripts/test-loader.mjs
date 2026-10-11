// Résolution façon Next pour `node --test` : alias « @/ » et imports TypeScript sans extension.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const src = pathToFileURL(`${process.cwd()}/src/`).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) specifier = src + specifier.slice(2);
    try {
      return next(specifier, context);
    } catch (err) {
      if (!["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(err?.code) || !/^(\.|file:)/.test(specifier)) throw err;
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          return next(specifier + ext, context);
        } catch {}
      }
      throw err;
    }
  },
});
