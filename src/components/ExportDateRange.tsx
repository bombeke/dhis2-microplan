import React from 'react';
import { Help, InputField, SegmentedControl, SingleSelectField, SingleSelectOption } from '@dhis2/ui';
import {
  RANGE_UNITS,
  describeExportRange,
  validateExportRange,
  type ExportDateRange as Range,
  type RangeMode,
  type RangeUnit,
} from '../lib/exportRange';
import { toIso } from '../lib/exportRange';

/**
 * Date-range control for the Export page: keep the pivot table's own period,
 * export everything **since** a date, or export the **last N** days / weeks /
 * months / years. N is free-form (any whole number above 0) because the DHIS2
 * relative-period keywords only cover a fixed handful of values.
 */
export const ExportDateRange: React.FC<{
  value: Range;
  onChange: (next: Range) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const error = validateExportRange(value);
  const today = toIso(new Date());

  return (
    <div className="daterange">
      <SegmentedControl
        selected={value.mode}
        onChange={({ value: mode }) => onChange({ ...value, mode: mode as RangeMode })}
        options={[
          { label: 'Pivot table period', value: 'default', disabled },
          { label: 'Since a date', value: 'since', disabled },
          { label: 'Last N …', value: 'last', disabled },
        ]}
      />

      {value.mode === 'since' && (
        <div className="daterange__fields">
          <InputField
            label="Start date (since)"
            type="date"
            max={today}
            disabled={disabled}
            value={value.startDate}
            error={!!error}
            validationText={error ?? undefined}
            onChange={({ value: v }) => onChange({ ...value, startDate: v ?? '' })}
          />
        </div>
      )}

      {value.mode === 'last' && (
        <div className="daterange__fields">
          <InputField
            label="N"
            type="number"
            min="1"
            step="1"
            disabled={disabled}
            value={String(value.lastN ?? '')}
            error={!!error}
            validationText={error ?? undefined}
            onChange={({ value: v }) =>
              onChange({ ...value, lastN: v === '' ? NaN : Number.parseInt(v as string, 10) })
            }
          />
          <SingleSelectField
            label="Unit"
            disabled={disabled}
            selected={value.unit}
            onChange={({ selected }) => onChange({ ...value, unit: selected as RangeUnit })}
          >
            {RANGE_UNITS.map((u) => (
              <SingleSelectOption key={u.value} label={u.label} value={u.value} />
            ))}
          </SingleSelectField>
        </div>
      )}

      {!error && <Help>{`Data will be pulled for: ${describeExportRange(value)}`}</Help>}
    </div>
  );
};
