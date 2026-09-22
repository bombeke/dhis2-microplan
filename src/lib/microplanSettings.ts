import { NAMESPACE, isMissing, putKey } from './microplanStore';
import {
  DEFAULT_REPORTING_CYCLE,
  isReportingCycle,
  type ReportingCycle,
} from './planSchedule';

/**
 * App-level access settings, persisted in the DHIS2 dataStore at
 *
 *   dataStore/microplan/settings
 *
 * Why this exists at all: the microplan authorities (`F_VIEW_MICROPLAN` &co.)
 * are custom authorities declared in d2.config.js. Granting them the proper
 * way means editing DHIS2 user roles in the Users app, which many deployments
 * won't hand out — the people who run the microplan programme are rarely the
 * same people who hold `F_USER_ROLE_PUBLIC_ADD`. So the app carries its own
 * grant table: an app administrator maps microplan authorities onto existing
 * DHIS2 user roles and user groups, and that mapping is consulted as a
 * *fallback* when the real DHIS2 authorities don't already allow the action.
 *
 * The fallback only ever widens access; it can never take away an authority a
 * user genuinely holds in DHIS2. That direction matters: it keeps the real
 * DHIS2 permission model authoritative and makes this table a convenience
 * layer rather than a second, competing source of truth.
 *
 * Three maps are stored:
 *
 *   roleAuthorities   userRole id  -> authorities granted to holders of that role
 *   groupAuthorities  userGroup id -> authorities granted to members of that group
 *   groupMembers      userGroup id -> extra user ids treated as members *here*
 *
 * Alongside the grants it holds three app-wide preferences: `reportingCycle` —
 * which month the reporting (financial) year starts in, which decides how the
 * Create Microplan page lays out yearly and quarterly plans — `gps`, the
 * Manage Settlements switches (see GpsSettings below), and `duplicates`, the
 * Manage Duplicates detection attributes and switches (DuplicateSettings).
 *
 * `groupMembers` lets an admin put a user into a microplan group without
 * touching DHIS2 group metadata (again, an authority they may not have). Real
 * DHIS2 group membership still counts — the two are unioned, never subtracted.
 */

export const SETTINGS_KEY = 'settings';

/** The custom authorities declared in d2.config.js, with admin-facing copy. */
export interface AuthorityDescriptor {
  value: string;
  label: string;
  description: string;
}

export const MICROPLAN_AUTHORITIES: AuthorityDescriptor[] = [
  {
    value: 'F_VIEW_MICROPLAN',
    label: 'View microplans',
    description: 'Open the app and use the Map, Microplans and Export pages.',
  },
  {
    value: 'F_ADD_MICROPLAN',
    label: 'Upload microplans',
    description: 'Show the Upload tab and save new microplans to the dataStore.',
  },
  {
    value: 'F_CREATE_MICROPLAN',
    label: 'Create microplans',
    description: 'Build microplans on the Create Microplan page, save drafts and submit them for review.',
  },
  {
    value: 'F_APPROVE_MICROPLAN',
    label: 'Review microplans',
    description: 'Add review notes to submitted microplans and approve them or send them back.',
  },
  {
    value: 'F_DELETE_MICROPLAN',
    label: 'Delete microplans',
    description: 'Show the Delete action on the Microplans page.',
  },
  {
    value: 'F_DOWNLOAD_MICROPLAN',
    label: 'Download data',
    description: 'Export pivot-table data as CSV or JSON from the Export page.',
  },
  {
    value: 'F_READ_GPS_MICROPLAN',
    label: 'Read GPS coordinates',
    description:
      'See raw event coordinates and out-of-bounds flags on the map, and open Manage Settlements read-only.',
  },
  {
    value: 'F_CREATE_GPS_MICROPLAN',
    label: 'Edit settlement GPS',
    description:
      'Add or correct settlement coordinates and polygons on Manage Settlements, save them and submit them for review — within your data capture org units.',
  },
  {
    value: 'F_APPROVE_GPS_MICROPLAN',
    label: 'Review settlement GPS',
    description:
      'Accept or reject settlement coordinates, add review notes, approve or send back submissions and sync approved updates — within your data capture org units.',
  },
  {
    value: 'F_VIEW_GPS_ALL_MICROPLAN',
    label: 'View all settlement GPS',
    description:
      'See settlements outside your data capture org units on Manage Settlements. Only takes effect while "Allow to view all GPS places" is on.',
  },
  {
    value: 'F_CREATE_GPS_ALL_MICROPLAN',
    label: 'Edit all settlement GPS',
    description:
      'Edit settlements outside your data capture org units. Only takes effect while "Allow to create all GPS places" is on.',
  },
  {
    value: 'F_APPROVE_GPS_ALL_MICROPLAN',
    label: 'Review all settlement GPS',
    description:
      'Review settlements outside your data capture org units. Only takes effect while "Allow to approve all GPS places" is on.',
  },
  {
    value: 'F_REVIEW_DUPLICATES_MICROPLAN',
    label: 'Review duplicates',
    description:
      'Open Manage Duplicates, view duplicate profiles and prepare merges for approval — within your data capture org units.',
  },
  {
    value: 'F_APPROVE_DUPLICATES_MICROPLAN',
    label: 'Approve duplicates',
    description:
      'Accept a prepared merge (saves it to DHIS2 and deletes the duplicate) or reject it — within your data capture org units.',
  },
  {
    value: 'F_REVIEW_DUPLICATES_ALL_MICROPLAN',
    label: 'Review all duplicates',
    description:
      'Review duplicates outside your data capture org units. Only takes effect while "Allow to review all duplicates" is on.',
  },
  {
    value: 'F_APPROVE_DUPLICATES_ALL_MICROPLAN',
    label: 'Approve all duplicates',
    description:
      'Approve merges outside your data capture org units. Only takes effect while "Allow to create/approve all duplicates" is on.',
  },
  {
    value: 'F_ADMIN_MICROPLAN',
    label: 'Administer microplan',
    description: 'Open this Settings page and change who can do what.',
  },
];

export const MICROPLAN_AUTHORITY_VALUES = MICROPLAN_AUTHORITIES.map((a) => a.value);

const AUTHORITY_LABELS = new Map(MICROPLAN_AUTHORITIES.map((a) => [a.value, a.label]));

/** Human label for an authority string, falling back to the string itself. */
export const authorityLabel = (value: string) => AUTHORITY_LABELS.get(value) ?? value;

/**
 * Manage Settlements preferences.
 *
 * The three `allow…All` switches are the second key of a two-key lock: the
 * matching F_*_GPS_ALL_MICROPLAN authority lifts the data-capture org-unit
 * restriction only while its switch is on, so an administrator can suspend
 * country-wide editing without touching a single user role.
 *
 * The settlements service only knows place *names*, so the app has to know
 * which DHIS2 hierarchy level holds states, LGAs and wards to translate an org
 * unit into a settlement filter. `syncEndpoint` is where approved updates are
 * posted; empty means "not available yet" and the Sync button says so.
 */
export interface GpsSettings {
  allowViewAll: boolean;
  allowCreateAll: boolean;
  allowApproveAll: boolean;
  stateLevel: number;
  lgaLevel: number;
  wardLevel: number;
  syncEndpoint: string;
}

export const DEFAULT_GPS_SETTINGS: GpsSettings = {
  allowViewAll: false,
  allowCreateAll: false,
  allowApproveAll: false,
  stateLevel: 2,
  lgaLevel: 3,
  wardLevel: 4,
  syncEndpoint: '',
};

function normaliseGps(raw: unknown): GpsSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const level = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10 ? v : d;
  const d = DEFAULT_GPS_SETTINGS;
  return {
    allowViewAll: bool(src.allowViewAll, d.allowViewAll),
    allowCreateAll: bool(src.allowCreateAll, d.allowCreateAll),
    allowApproveAll: bool(src.allowApproveAll, d.allowApproveAll),
    stateLevel: level(src.stateLevel, d.stateLevel),
    lgaLevel: level(src.lgaLevel, d.lgaLevel),
    wardLevel: level(src.wardLevel, d.wardLevel),
    syncEndpoint: typeof src.syncEndpoint === 'string' ? src.syncEndpoint.trim() : '',
  };
}

/**
 * Manage Duplicates preferences.
 *
 * `attributes` are the tracked-entity attributes whose values, taken together,
 * identify a person: two records with the same (normalised) value for every
 * one of them are reported as duplicates. `programId` is the programme the
 * page opens on and the one the attribute picker lists attributes from.
 *
 * The two `allow…All` switches pair with F_REVIEW_DUPLICATES_ALL_MICROPLAN and
 * F_APPROVE_DUPLICATES_ALL_MICROPLAN exactly as the GPS switches do: both keys
 * are needed to go beyond the data capture org units.
 *
 * `shardLevel` is the hierarchy level duplicate records are grouped by in the
 * dataStore (one key per org unit at that level), so that reviewers in
 * different districts never write the same key.
 */
export interface DuplicateSettings {
  programId: string;
  attributes: string[];
  allowReviewAll: boolean;
  allowApproveAll: boolean;
  shardLevel: number;
}

export const DEFAULT_DUPLICATE_SETTINGS: DuplicateSettings = {
  programId: '',
  attributes: [],
  allowReviewAll: false,
  allowApproveAll: false,
  shardLevel: 3,
};

function normaliseDuplicates(raw: unknown): DuplicateSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_DUPLICATE_SETTINGS;
  return {
    programId: typeof src.programId === 'string' ? src.programId : d.programId,
    attributes: Array.isArray(src.attributes)
      ? Array.from(new Set(src.attributes.filter((x): x is string => typeof x === 'string' && x.length > 0)))
      : [],
    allowReviewAll: typeof src.allowReviewAll === 'boolean' ? src.allowReviewAll : d.allowReviewAll,
    allowApproveAll: typeof src.allowApproveAll === 'boolean' ? src.allowApproveAll : d.allowApproveAll,
    shardLevel:
      typeof src.shardLevel === 'number' && Number.isInteger(src.shardLevel) && src.shardLevel >= 1 && src.shardLevel <= 10
        ? src.shardLevel
        : d.shardLevel,
  };
}

export interface MicroplanSettings {
  /** Schema version, so a future migration can tell old payloads apart. */
  version: number;
  updatedAt: string; // ISO
  updatedBy: string; // username
  roleAuthorities: Record<string, string[]>;
  groupAuthorities: Record<string, string[]>;
  groupMembers: Record<string, string[]>;
  /** first month of the reporting year — JANUARY is the calendar year */
  reportingCycle: ReportingCycle;
  /** Manage Settlements preferences */
  gps: GpsSettings;
  /** Manage Duplicates preferences */
  duplicates: DuplicateSettings;
}

export const SETTINGS_VERSION = 1;

export const emptySettings = (): MicroplanSettings => ({
  version: SETTINGS_VERSION,
  updatedAt: '',
  updatedBy: '',
  roleAuthorities: {},
  groupAuthorities: {},
  groupMembers: {},
  reportingCycle: DEFAULT_REPORTING_CYCLE,
  gps: { ...DEFAULT_GPS_SETTINGS },
  duplicates: { ...DEFAULT_DUPLICATE_SETTINGS, attributes: [] },
});

/**
 * Coerce whatever is in the dataStore into a well-formed settings object.
 * The key is hand-editable through the DataStore Management app, so nothing
 * about its shape can be assumed: every map is rebuilt entry by entry and
 * anything that isn't a string array is dropped rather than trusted.
 */
export function normaliseSettings(raw: unknown): MicroplanSettings {
  const base = emptySettings();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Record<string, unknown>;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

  const mapOfStrings = (v: unknown): Record<string, string[]> => {
    if (!v || typeof v !== 'object') return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
      const list = strings(value);
      if (list.length) out[key] = Array.from(new Set(list));
    }
    return out;
  };

  return {
    version: typeof src.version === 'number' ? src.version : SETTINGS_VERSION,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : '',
    updatedBy: typeof src.updatedBy === 'string' ? src.updatedBy : '',
    roleAuthorities: mapOfStrings(src.roleAuthorities),
    groupAuthorities: mapOfStrings(src.groupAuthorities),
    groupMembers: mapOfStrings(src.groupMembers),
    reportingCycle: isReportingCycle(src.reportingCycle)
      ? src.reportingCycle
      : DEFAULT_REPORTING_CYCLE,
    gps: normaliseGps(src.gps),
    duplicates: normaliseDuplicates(src.duplicates),
  };
}

type Engine = { query: (q: unknown) => Promise<any>; mutate: (m: unknown) => Promise<any> };

/**
 * Read the settings key. A missing key is the normal state of a fresh install,
 * not an error, so it resolves to empty settings — every caller would
 * otherwise have to special-case the first run.
 */
export async function readSettings(engine: Engine): Promise<MicroplanSettings> {
  try {
    const res: any = await engine.query({
      s: { resource: `dataStore/${NAMESPACE}/${SETTINGS_KEY}` },
    });
    return normaliseSettings(res.s);
  } catch (e) {
    if (isMissing(e)) return emptySettings();
    throw e;
  }
}

/** Write the settings key, stamping who changed it and when. */
export async function writeSettings(
  engine: Engine,
  settings: MicroplanSettings,
  updatedBy: string
): Promise<MicroplanSettings> {
  const payload: MicroplanSettings = {
    ...normaliseSettings(settings),
    version: SETTINGS_VERSION,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await putKey(engine, SETTINGS_KEY, payload);
  return payload;
}

/* ---- authority resolution ------------------------------------------------ */

/** Everything about a user that the grant table needs in order to be applied. */
export interface GrantSubject {
  userId: string;
  /** ids of the DHIS2 user roles the user holds. */
  roleIds: string[];
  /** ids of the DHIS2 user groups the user genuinely belongs to. */
  groupIds: string[];
}

/**
 * Group ids that count for this user: real DHIS2 membership plus any group the
 * settings key has added them to. Exposed separately because the Settings page
 * shows both, and it's the one piece of the resolution that isn't a plain
 * lookup.
 */
export function effectiveGroupIds(settings: MicroplanSettings, subject: GrantSubject): string[] {
  const ids = new Set(subject.groupIds);
  for (const [groupId, members] of Object.entries(settings.groupMembers)) {
    if (members.includes(subject.userId)) ids.add(groupId);
  }
  return Array.from(ids);
}

/**
 * The authorities this user picks up *from the settings key alone*. Callers
 * union this with the user's real DHIS2 authorities; keeping it separate is
 * what lets the UI say "granted by app settings" rather than just "granted".
 */
export function grantedAuthorities(
  settings: MicroplanSettings,
  subject: GrantSubject
): Set<string> {
  const granted = new Set<string>();

  for (const roleId of subject.roleIds) {
    for (const auth of settings.roleAuthorities[roleId] ?? []) granted.add(auth);
  }
  for (const groupId of effectiveGroupIds(settings, subject)) {
    for (const auth of settings.groupAuthorities[groupId] ?? []) granted.add(auth);
  }

  return granted;
}
