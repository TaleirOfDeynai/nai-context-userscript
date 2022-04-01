import { usModule } from "@utils/usModule";
import UUID from "@nai/UUID";

/**
 * Provides work-alike implementations of classes defined internal to
 * the vanilla NovelAI modules, but must be exported from the context
 * builder via its results.
 */
export default usModule((require, exports) => {
  const uuid = require(UUID);

  return Object.assign(exports, {
  });
});
