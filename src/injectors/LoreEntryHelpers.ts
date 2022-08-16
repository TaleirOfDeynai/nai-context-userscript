import LoreEntryHelpers, { ILoreEntryHelpers } from "@nai/LoreEntryHelpers";
import SearchService from "../contextBuilder/SearchService";
import { replaceWrapper } from "./_helpers";

export const name = LoreEntryHelpers.name;
export const chunkId = 2888;
export const moduleId = LoreEntryHelpers.moduleId;
export const inject = replaceWrapper<ILoreEntryHelpers>({
  "P5": (original, require) => {
    // return original;

    const searchService = SearchService(require);
    return searchService.naiCheckActivation;

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