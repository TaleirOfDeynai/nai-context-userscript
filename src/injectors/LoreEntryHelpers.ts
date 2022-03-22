import LoreEntryHelpers, { ILoreEntryHelpers } from "../naiModules/LoreEntryHelpers";
import SearchService from "../contextBuilder/SearchService";
import { replaceWrapper } from "./_helpers";

export const name = LoreEntryHelpers.name;
export const chunkId = 2888;
export const moduleId = LoreEntryHelpers.moduleId;
export const inject = replaceWrapper<ILoreEntryHelpers>({
  "P5": (original, require) => SearchService(require).naiCheckActivation
});