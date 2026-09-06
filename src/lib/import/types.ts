/**
 * What a parser produces, before anything is written.
 *
 * Deliberately not a Prisma shape. A parsed row is a *proposal* — it has been
 * read out of somebody else's file and has not yet been judged against what is
 * already here — so it carries the source line it came from and the problems
 * found in it, and the decision about what to do with it is made later and
 * separately.
 */
import type { DatePrecision } from "@/lib/date-precision";
import type { PlainDate } from "@/lib/dates";

export interface ImportedMethod {
  /** Taxonomy slug this maps onto: `email`, `mobile`, `phone`, `url`. */
  slug: string;
  value: string;
  label: string | null;
}

export interface ImportedAddress {
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface ImportedContact {
  firstName: string;
  lastName: string | null;
  nickname: string | null;
  /** Null when the source had no birthday, or one too vague to place. */
  birthDate: PlainDate | null;
  /** What the source actually knew. A year nobody supplied is never invented. */
  birthDatePrecision: DatePrecision;
  occupation: string | null;
  employer: string | null;
  summary: string | null;
  methods: ImportedMethod[];
  addresses: ImportedAddress[];
}

/** One entry read from a file, with whatever went wrong reading it. */
export interface ParsedRow {
  /** 1-based, so a message can point at something the person can find. */
  index: number;
  contact: ImportedContact | null;
  /** Why this row cannot be imported, if it cannot. */
  problem: string | null;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Problems with the file itself rather than with any one row. */
  fileProblem: string | null;
}

/** An empty contact, so a parser only has to set what its format carries. */
export function emptyContact(): ImportedContact {
  return {
    firstName: "",
    lastName: null,
    nickname: null,
    birthDate: null,
    birthDatePrecision: "DAY",
    occupation: null,
    employer: null,
    summary: null,
    methods: [],
    addresses: [],
  };
}
