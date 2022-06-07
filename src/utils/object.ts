/**
 * A combination of {@link Object.create}, {@link Object.assign},
 * and {@link Object.freeze}.  Takes the `proto` object and instantiates
 * a new object with it as the prototype, assigns `extensions` to it,
 * freezes the new object to make it immutable, and returns it.
 */
export const protoExtend = <T extends {}, U extends {}>(proto: T, extensions: U): Readonly<T & U> => {
  let instance = Object.create(proto);
  for (const k in extensions) {
    Object.defineProperty(instance, k, {
      value: extensions[k],
      enumerable: true,
      writable: false
    });
  }
  return Object.freeze(instance);
};