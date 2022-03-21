export type CheckValue
  = "boolean" | "function" | "number" | "object" | "string" | "undefined"
  | ((value: any, key: string) => boolean);

type MappingValue = readonly [
  /** The new name to provide for the export. */
  newKey: string,
  /** Optional value to use to check that the export is what we expect. */
  checkVal?: CheckValue
];

export type MappingStruct<TSrc extends Webpack.ExportsObject> = {
  [k in keyof TSrc]?: MappingValue;
};

type MappedKey<TKey, TMap extends MappingStruct<Webpack.ExportsObject>>
  = TKey extends keyof TMap ? NonNullable<TMap[TKey]>[0] : TKey;

export type MappedOf<TDef extends ModuleDef<Webpack.ExportsObject>> = {
  readonly [K in keyof TDef["TModule"] as MappedKey<K, TDef["mapping"]>]: TDef["TModule"][K];
};

export interface WrappedRequireFn {
  /** Given a {@link ModuleDef}, attempts to get the mapped module instance. */
  <TDef extends ModuleDef<Webpack.ExportsObject>>(moduleDef: TDef): TDef["TMapped"] | undefined;
  /** Access to the raw {@link Webpack.WebpackRequireFn}. */
  raw: Webpack.WebpackRequireFn;
}

const DEFAULT_CHECK = () => true;
const cache = new Map<number | string, any>();

export abstract class ModuleDef<TSrc extends Webpack.ExportsObject> {
  /** The ID of the Webpack module. */
  abstract moduleId: number | string;
  /** The expected number of exports to find on the module, for safety checks. */
  abstract expectedExports: number;
  /** How to map exports from something obfuscated to something readable. */
  abstract mapping: MappingStruct<TSrc>;

  /** Virtual property; a dependent type for the original module. */
  readonly TModule: TSrc;

  /** Virtual property; a dependent type for the mapped module. */
  readonly TMapped: MappedOf<this>;

  /** A readable name given to this module. */
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
      notifyToConsole([
        `Module \`${identifier}\` was requested via a wrapped module definition,`,
        "but the module could not be resolved through Webpack."
      ].join(" "));
      return undefined;
    }

    const passthruKeys = new Set(Object.keys(theModule));

    if (passthruKeys.size !== expectedExports) {
      notifyToConsole([
        `Expected module \`${identifier}\` to have ${expectedExports} exports,`,
        `but the actual count was ${passthruKeys.size}.`
      ].join(" "));
      return undefined;
    }

    const wrappedModule = {};

    for (const [kSrc, v] of Object.entries(mapping)) {
      if (!v) continue;

      const [kTrg, checkVal = DEFAULT_CHECK] = v;
      passthruKeys.delete(kSrc);

      // Normalize the safety check into a function.
      const checkFn
        = typeof checkVal === "function" ? checkVal
        : (val) => typeof val === checkVal;

      // Sanity check; the export exists, right?
      if (!(kSrc in theModule)) {
        notifyToConsole([
          `Expected export \`${kSrc}\` to be mappable to \`${kTrg}\``,
          `in module \`${identifier}\`, but the export was not found;`,
          "were the chunks updated?"
        ].join(" "));
        return undefined;
      }

      // If we have a safety checker, do the check.
      if (checkFn(theModule[kSrc], kSrc)) {
        notifyToConsole([
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

interface ProblemStruct {
  /** The user-facing message to display in the notification. */
  message?: string;
  /** Optional user-facing title to display in the notification. */
  title?: string;
  /** Object(s) to log to console.  May be either a single object or an iterable. */
  logToConsole?: unknown | Iterable<unknown>;
}

const problemDefaults: Required<ProblemStruct> = {
  message: "An error occurred that may prevent the user-script from working.",
  title: "Context User-Script Problem",
  logToConsole: []
};

const asIterable = (value: any): Iterable<unknown> => {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value[Symbol.iterator] === "function") return value;
  return [value];
};

let didNotifyOfProblem = false;

/**
 * Call whenever there's an issue that likely means the user-script is in
 * a bad state; lets the user know it is probably not working correctly.
 * 
 * In order to ensure spam does not occur, only one notification will ever
 * be sent.  It will still log out anything given in
 * {@link ProblemStruct.logToConsole}.
 */
export function notifyOfProblem(problem: ProblemStruct | string) {
  // Normalize the problem struct.
  const theProblem = (() => {
    if (typeof problem !== "string") return problem;
    return { message: problem };
  })();

  const { message, title, logToConsole } = Object.assign({}, problemDefaults, theProblem);

  if (!didNotifyOfProblem) {
    didNotifyOfProblem = true;
    GM.notification([message, "Check the dev console for more information."].join("\n\n"), title);
  }

  console.warn(message);
  for (const item of asIterable(logToConsole)) console.error(item);
};

/**
 * A shorthand version of {@link notifyOfProblem} that logs technical details
 * to console and notifies with a generic "it broke" message to the user.
 */
export function notifyToConsole(...logToConsole: unknown[]) {
  notifyOfProblem({ logToConsole });
}