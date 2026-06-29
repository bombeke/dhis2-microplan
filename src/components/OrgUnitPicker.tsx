import React, { useState } from 'react';
import { useOrgUnitRoots, useOrgUnitChildren, type OrgUnitNode } from '../hooks/useOrgUnits';

/**
 * Minimal lazy org-unit picker. Expands one level at a time using the
 * parent-cached useOrgUnitChildren hook, so it scales to deep hierarchies
 * (50k+ wards) without ever loading the whole tree.
 */
export const OrgUnitPicker: React.FC<{
  value: { id: string; name: string; level: number } | null;
  onChange: (ou: { id: string; name: string; level: number }) => void;
}> = ({ value, onChange }) => {
  const { data: roots, isLoading } = useOrgUnitRoots();

  return (
    <div className="oupicker">
      {value && (
        <div className="oupicker__selected">
          Selected: <strong>{value.name}</strong> <em>(level {value.level})</em>
        </div>
      )}
      <div className="oupicker__tree">
        {isLoading && <span className="muted">Loading org units…</span>}
        {(roots ?? []).map((n) => (
          <OrgUnitBranch key={n.id} node={n} depth={0} value={value} onChange={onChange} />
        ))}
      </div>
    </div>
  );
};

const OrgUnitBranch: React.FC<{
  node: OrgUnitNode;
  depth: number;
  value: { id: string } | null;
  onChange: (ou: { id: string; name: string; level: number }) => void;
}> = ({ node, depth, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const { data: children, isLoading } = useOrgUnitChildren(open ? node.id : null, open);

  return (
    <div className="oubranch" style={{ paddingLeft: depth * 14 }}>
      <div className="oubranch__row">
        {!node.leaf && node.childCount > 0 ? (
          <button className="oubranch__toggle" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="oubranch__spacer" />
        )}
        <button
          className={`oubranch__name ${value?.id === node.id ? 'is-selected' : ''}`}
          onClick={() => onChange({ id: node.id, name: node.displayName, level: node.level })}
        >
          {node.displayName}
        </button>
      </div>
      {open && (
        <div>
          {isLoading && <span className="muted oubranch__loading">…</span>}
          {(children ?? []).map((c) => (
            <OrgUnitBranch key={c.id} node={c} depth={depth + 1} value={value} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
};
