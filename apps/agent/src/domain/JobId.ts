import { Schema } from "effect"

export const JobId = Schema.String.pipe(Schema.brand("JobId"))
export type JobId = typeof JobId.Type
