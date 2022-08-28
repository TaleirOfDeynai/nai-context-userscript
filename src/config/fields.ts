import _camelCase from "lodash/camelCase";
import { assert } from "@utils/assert";
import { isArray } from "@utils/is";
import { chain } from "@utils/iterables";
import * as IterOps from "@utils/iterables";
import "../../vendor/gm-config/gm_config";

import type { ElementOf } from "@utils/iterables";
import type { PredicateFn } from "@utils/functions";


type TypelessField = {
  [K in keyof Field as K extends "type" ? never : K]: Field[K];
};

type PartialField = Record<string, Field>;

const isVisible = (field: Field) =>
  Boolean(field.label) || Boolean(field.section) || field.type !== "hidden";

const isMainSection = (field: Field): field is Field & { section: [string] } => {
  if (field.type !== "hidden") return false;
  if (field.save !== false) return false;
  if (!isArray(field.section)) return false;
  if (field.section.length !== 1) return false;
  return true;
};

const isSubSection = (field: Field): field is Field & { section: ["", string] } => {
  if (field.type !== "hidden") return false;
  if (field.save !== false) return false;
  if (!isArray(field.section)) return false;
  if (field.section.length !== 2) return false;
  if (field.section[0] !== "") return false;
  return true;
};

const fieldPredicate = (predicateFn: PredicateFn<Field>) => (partialField: PartialField) => {
  for (const value of Object.values(partialField))
    if (predicateFn(value))
      return true;
  return false;
};

/**
 * Because the tiny gap in between a section and sub-section when there
 * is a hidden field between them bothered me, this function will collapse
 * a main and sub section into a single section when there are no visible
 * fields between them.
 */
const collapseSections = (fields: PartialField): PartialField => {
  const kvps = Object.entries(fields);
  const values = kvps.map((kvp) => kvp[1]);

  // Must have a main-section in the first position.
  const mainSectionIdx = values.findIndex(isMainSection);
  if (mainSectionIdx !== 0) return fields;

  // Must have a sub-section somewhere.
  const subSectionIdx = values.findIndex(isSubSection);
  if (subSectionIdx === -1) return fields;

  // We can collapse if the fields between these two points are all
  // invisible fields.
  const inBetween = values.slice(mainSectionIdx + 1, subSectionIdx);
  if (inBetween.some(isVisible)) return fields;

  // We can collapse these sections.
  const mainSection = values[mainSectionIdx].section[0];
  const subSection = values[subSectionIdx].section[1];

  return chain(kvps)
    .collect((kvp) => {
      if (kvp === kvps[mainSectionIdx]) return undefined;
      if (kvp === kvps[subSectionIdx]) return undefined;
      return kvp;
    })
    .thru(function* (kvps) {
      yield* Object.entries(section([mainSection, subSection]));
      yield* kvps;
    })
    .value(IterOps.fromPairs) as PartialField;
};

const makeField = <T extends string>(id: T, field: Field): PartialField => {
  // @ts-ignore - Yes it is, you type-unsafe piece of garbage.
  // DURRR!  I'MMA TYPE SYSTEM!  HUUURRRR!
  return { [id]: field };
};

/**
 * Creates a section, with optional sub-section text.
 * 
 * The section is always visible.
 */
export function section(name: string | [string, string]): PartialField;
/**
 * Creates a section, containing the given `fields`.
 * 
 * The section will only be shown if `fields` contains at least one
 * field that will create a visible element.
 */
export function section(name: string | [string, string], fields: PartialField[]): PartialField;
export function section(
  name: string | [string, string],
  fields: PartialField[] = []
) {
  const section = IterOps.castArray(name) as [main: string, sub?: string];
  const id = _camelCase(section[0]);

  const theField = hidden(`section_${id}`, {
    section,
    default: "",
    save: false
  });

  if (!fields.length) return theField;
  if (!fields.some(fieldPredicate(isVisible))) return Object.assign({}, ...fields);
  return collapseSections(Object.assign({}, theField, ...fields));
};

/**
 * Creates a sub-section.
 * 
 * The sub-section is always visible.
 */
export function subSection(name: string | [string, string]): PartialField;
/**
 * Creates a sub-section, containing the given `fields`.
 * 
 * The sub-section will only be shown if `fields` contains at least one
 * field that will create a visible element.
 */
export function subSection(name: string | [string, string], fields: PartialField[]): PartialField;
export function subSection(
  name: string,
  fields: PartialField[] = []
) {
  const section = ["", name] as const;
  const id = _camelCase(name);

  const theField = hidden(`subSection_${id}`, {
    section,
    default: "",
    save: false
  });

  if (!fields.length) return theField;
  if (!fields.some(fieldPredicate(isVisible))) return Object.assign({}, ...fields);
  return Object.assign({}, theField, ...fields);
};

/**
 * Creates a standardized checkbox.
 */
export const checkBox = <TKey extends string>(
  id: TKey,
  field: TypelessField
): PartialField => makeField(id, {
  labelPos: "right",
  type: "checkbox",
  default: true,
  ...field
});

interface SelectField<TOpts extends readonly string[]> extends TypelessField {
  options: readonly [...TOpts];
  default?: ElementOf<TOpts>;
}

export const select = <TKey extends string, TOpts extends string[]>(
  id: TKey,
  field: SelectField<TOpts>
): PartialField => {
  assert("Must have at least 1 option.", field.options.length > 0);
  return makeField(id, {
    labelPos: "left",
    type: "select",
    default: field.options[0],
    ...field
  });
};

/**
 * Creates a standardized hidden field.
 * 
 * The `label` is automatically removed.
 */
export const hidden = <TKey extends string>(
  id: TKey,
  field: TypelessField
): PartialField => {
  delete field.label;
  return makeField(id, {
    labelPos: "right",
    type: "hidden",
    ...field
  });
};