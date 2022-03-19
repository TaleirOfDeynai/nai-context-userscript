type ReplacerFn = (original: any) => any;

export const replaceWrapper =
  (replaceMap: Record<string, ReplacerFn>) =>
  (exports: any, module: Webpack.ModuleInstance): any => {
    const replacedKeys = new Set(Object.keys(replaceMap));
    const passthruKeys = new Set(Object.keys(exports));
    const wrappedModule = {};

    for (const k of replacedKeys) {
      passthruKeys.delete(k);

      const original = exports[k];
      const replacer = replaceMap[k];
      const replacement = replacer(original);

      Object.defineProperty(wrappedModule, k, {
        get() { return replacement; }
      });

      replacedKeys.delete(k);
    }

    // Any property not in the replacer is passed through transparently.
    for (const k of passthruKeys) {
      Object.defineProperty(wrappedModule, k, {
        get() { return exports[k]; }
      });
    }

    // Any keys remaining were not found, which is a problem.
    for (const k of replacedKeys) {
      console.error([
        `Property \`${k}\` in module \`${module.id}\` was not found`,
        "no replacement was made."
      ].join("; "));
    }

    return wrappedModule;
  };