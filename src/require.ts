export type CheckValue
  = "boolean" | "function" | "number" | "object" | "string" | "undefined"
  | ((value: any, key: string) => boolean);

type WebpackModule = { [exportKey: string]: any };

export type MappingStruct<TSrc extends WebpackModule> = {
  [k in keyof TSrc]?: readonly [newKey: string, checkVal?: CheckValue];
};

type MappedKey<TKey, TMap extends MappingStruct<WebpackModule>>
  = TKey extends keyof TMap ? TMap[TKey][0] : TKey;

export type MappedOf<TDef extends ModuleDef<WebpackModule>> = {
  readonly [K in keyof TDef["MODULE"] as MappedKey<K, TDef["mapping"]>]: TDef["MODULE"][K];
};

export interface WrappedRequireFn {
  <TDef extends ModuleDef<WebpackModule>>(moduleDef: TDef): MappedOf<TDef> | undefined;
  raw: Webpack.WebpackRequireFn;
}

const DEFAULT_CHECK = () => true;
const cache = new Map<number | string, any>();

export abstract class ModuleDef<TSrc extends WebpackModule> {
  abstract moduleId: number;
  abstract expectedExports: number;
  abstract mapping: MappingStruct<TSrc>;

  /** Virtual property to overcome TypeScript retardation. */
  readonly MODULE: TSrc;

  get name(): string {
    return this.constructor.name;
  }
}

export function makeWrappedRequire(webpackRequire: Webpack.WebpackRequireFn): WrappedRequireFn {
  function wrappedRequire(moduleDef: ModuleDef<any>) {
    const { name, moduleId, expectedExports, mapping } = moduleDef;
    const identifier = `${name}@${moduleId}`;

    const fromCache = cache.get(moduleId);
    if (fromCache) return fromCache;

    const theModule = webpackRequire(moduleId);

    if (typeof theModule !== "object") {
      console.error([
        `Module \`${identifier}\` was requested via a wrapped module definition,`,
        "but the module could not be resolved through Webpack."
      ].join(" "));
      return undefined;
    }

    const passthruKeys = new Set(Object.keys(theModule));

    if (passthruKeys.size !== expectedExports) {
      console.error([
        `Expected module \`${identifier}\` to have ${expectedExports} exports,`,
        `but the actual count was ${passthruKeys.size}.`
      ].join(" "));
      return undefined;
    }

    const wrappedModule = {};

    for (const [kSrc, v] of Object.entries(mapping)) {
      const [kTrg, checkVal = DEFAULT_CHECK] = v;
      passthruKeys.delete(kSrc);

      // Normalize the safety check into a function.
      const checkFn
        = typeof checkVal === "function" ? checkVal
        : (val) => typeof val === checkVal;

      // Sanity check; the export exists, right?
      if (!(kSrc in theModule)) {
        console.error([
          `Expected export \`${kSrc}\` to be mappable to \`${kTrg}\``,
          `in module \`${identifier}\`, but the export was not found;`,
          "were the chunks updated?"
        ].join(" "));
        return undefined;
      }

      // If we have a safety checker, do the check.
      if (checkFn(theModule[kSrc], kSrc)) {
        console.error([
          `Expected export \`${kSrc}\` to be mappable to \`${kTrg}\``,
          `in module \`${identifier}\`, but the export failed`,
          "its safety check."
        ].join(" "));
        return undefined;
      }

      Object.defineProperty(wrappedModule, kTrg, {
        get() { return theModule[kSrc]; }
      });
    }

    // Any unmapped exports are passed through transparently.
    for (const kSrc of passthruKeys) {
      Object.defineProperty(wrappedModule, kSrc, {
        get() { return theModule[kSrc]; }
      });
    }

    cache.set(moduleId, wrappedModule);
    return wrappedModule;
  }

  return Object.assign(wrappedRequire, { raw: webpackRequire });
}