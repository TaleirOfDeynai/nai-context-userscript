import { usModule } from "@utils/usModule";
import $Activation from "../activation";
import { nil, add } from "./_helpers";

import type { EntryWeigher } from "./index";

export default usModule((require, exports) => {
  const { isActivated } = $Activation(require);

  /**
   * Weight function that simply provides one point for each match in
   * the story.
   */
  const storyCount: EntryWeigher = () => (source) => {
    // Can't score if the entry has no activation data.
    if (!isActivated(source)) return nil;

    // We only score it if the source has a story activation.
    const keyed = source.activations.get("keyed");
    if (!keyed) return nil;

    return add(keyed.size);
  };

  return Object.assign(exports, { storyCount });
});