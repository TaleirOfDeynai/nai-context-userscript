import type { Tokens } from "../TokenizerService";
import type { IFragmentAssembly } from "./Fragment";

export interface ITokenizedAssembly extends IFragmentAssembly {
  tokens: Tokens;
}