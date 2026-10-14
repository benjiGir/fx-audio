// TypeDoc plugin that makes the reference of Effect classes readable.
//
// 1. A service is declared as `class Audio extends Context.Service<Audio, { ...members }>()(key)`,
//    so TypeDoc shows its members inside the `extends` clause. Move them onto the class.
// 2. Classes built by `Schema.Class` and `Context.Service` inherit a constructor and a few
//    statics from Effect. They are Effect's, documented there: leave them out, with the
//    `extends` clauses and default values that only repeat Effect's internals.
import { Converter, ReflectionKind, ReflectionType } from "typedoc"

const members = ReflectionKind.Property | ReflectionKind.Method | ReflectionKind.Accessor
const fromEffect = ReflectionKind.Constructor | members

/** The object type literal given as a type argument of the base class, if any. */
const serviceShape = (cls) =>
  cls.extendedTypes
    ?.flatMap((type) => (type.type === "reference" ? (type.typeArguments ?? []) : []))
    .find((argument) => argument instanceof ReflectionType)?.declaration

export function load(app) {
  app.converter.on(
    Converter.EVENT_RESOLVE_END,
    (context) => {
      const { project } = context
      for (const cls of project.getReflectionsByKind(ReflectionKind.Class)) {
        const shape = serviceShape(cls)
        if (shape === undefined) continue
        for (const child of shape.children ?? []) {
          child.parent = cls
          cls.addChild(child)
        }
        cls.extendedTypes = undefined
      }
      for (const cls of project.getReflectionsByKind(ReflectionKind.Class)) {
        // Keep an `extends` clause only for a class of this project.
        cls.extendedTypes = cls.extendedTypes?.filter(
          (type) => type.type === "reference" && type.reflection !== undefined
        )
        if (cls.extendedTypes?.length === 0) cls.extendedTypes = undefined
      }
      for (const reflection of project.getReflectionsByKind(fromEffect)) {
        const sources = reflection.sources ?? []
        if (
          sources.length > 0 &&
          sources.every((source) => source.fileName.includes("node_modules"))
        ) {
          project.removeReflection(reflection)
        } else {
          reflection.inheritedFrom = undefined
          reflection.overwrites = undefined
          reflection.defaultValue = undefined
        }
      }
    },
    // Before TypeDoc groups the members of each class.
    1000
  )
}
