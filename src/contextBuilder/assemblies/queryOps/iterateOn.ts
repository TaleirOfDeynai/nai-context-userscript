import { iterReverse } from "@utils/iterables";
import { IFragmentAssembly } from "../Fragment";

export default function* iterateOn(
  assembly: IFragmentAssembly,
  reversed: boolean = false
) {
  const { prefix, content, suffix } = assembly;
  if (reversed) {
    if (suffix.content) yield suffix;
    for (const value of iterReverse(content)) yield value;
    if (prefix.content) yield prefix;
  }
  else {
    if (prefix.content) yield prefix;
    for (const value of content) yield value;
    if (suffix.content) yield suffix;
  }
}