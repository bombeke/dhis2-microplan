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
 * Alongside the grants it holds one app-wide preference, `reportingCycle`:
 * which month the reporting (financial) year starts in, which decides how the
 * Create Microplan page lays out yearly and quarterly plans.
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
    description: 'See raw event coordinates and out-of-bounds flags on the map.',
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
