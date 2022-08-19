import usConfig from "@config";
import LoreEntryHelpers from "@nai/LoreEntryHelpers";
import SearchService from "../contextBuilder/SearchService";
import { notifyOfProblem } from "../require";
import { replaceWrapper } from "./_helpers";

import type { ILoreEntryHelpers } from "@nai/LoreEntryHelpers";

export const name = LoreEntryHelpers.name;
export const chunkId = 2888;
export const moduleId = LoreEntryHelpers.moduleId;
export const inject = replaceWrapper<ILoreEntryHelpers>({
  "P5": (original, require) => {
    if (!usConfig.activation.vanillaIntegration) return original;

    const searchService = SearchService(require);

    let checkerFailed = false;

    function failSafeChecker() {
      if (!checkerFailed) {
        try {
          return searchService.naiCheckActivation.apply(this, arguments);
        }
        catch (err) {
          notifyOfProblem({
            message: [
              "Search service integration failed.",
              "Falling back to the vanilla `checkActivation` function for the remainder of this session.",
            ].join("  "),
            logToConsole: err
          });
          checkerFailed = true;
        }
      }

      // Invoke the original if the replacement fails.
      return original.apply(this, arguments);
    }

    return failSafeChecker;

    // Comment out the return above to get reports on oddities from the
    // different implementations.
    const report = (keySet: Set<string>, item: any) => {
      const keys = [...keySet].sort();
      const arr: string[] = [];
      for (const k of keys) {
        const v = String(item[k]);
        arr.push(`${k}: ${v ? v : "<empty>"}`);
      }
      return arr.join("; ");
    };

    return function tester(...args: any[]) {
      const o = original.apply(null, args);
      const m = searchService.naiCheckActivation.apply(null, args);
      const oKeys = Object.keys(o);
      const mKeys = Object.keys(m);
      const all = new Set([...oKeys, ...mKeys]);

      const mismatches: string[] = [];
      for (const k of all)
        if (o[k] !== m[k])
          mismatches.push(`Bad comparison in key \`${k}\`.`);

      if (mismatches.length === 0) return m;

      checks: {
        if (!args[2]) break checks;
        if (o.index < 0 && m.index >= 0) break checks;
        if (o.index >= 0 && m.index < 0) break checks;
        if (!!o.key !== !!m.key) break checks;

        console.log("Benign mismatch in quickCheck:", o, m);
        return m;
      }

      mismatches.forEach(console.log.bind(console));
      console.dir(args);
      console.log("Original -", report(all, o));
      console.log("Modified -", report(all, m));
      console.log("--------");
      return m;
    }
  }
});