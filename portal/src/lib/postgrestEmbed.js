// PostgREST embeds a related table as a single object when it detects a
// to-one relationship (the referencing column carries a UNIQUE constraint,
// as mock_oral_intakes.booking_id and mock_oral_assessments.booking_id
// both do) -- not wrapped in an array the way a genuine to-many embed is.
// Code written against the array shape (`row.intake?.[0] ?? null`) silently
// resolves to null for every row even when the related record exists,
// since indexing a plain object with [0] is just undefined. Normalize
// either shape so a future embed, or a PostgREST version change in either
// direction, can't silently reintroduce this.
export function toOne(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}
