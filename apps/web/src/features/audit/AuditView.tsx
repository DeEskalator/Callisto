import type { AuditEntry } from '@callisto/domain';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { data, useApi } from '../../app/api';
import { queryKeys } from '../../app/queries';
import { formatTimestamp } from '../../lib/format';
import { refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { DataGrid, type GridColumn } from '../../ui/DataGrid';
import { QueryState } from '../../ui/QueryState';

const columns: GridColumn<AuditEntry>[] = [
  {
    id: 'at',
    header: 'Zeitpunkt',
    width: 160,
    render: (entry) => formatTimestamp(entry.at),
    sortValue: (entry) => entry.at,
  },
  {
    id: 'actor',
    header: 'Benutzer',
    width: 220,
    render: (entry) => entry.actorName,
    sortValue: (entry) => entry.actorName,
  },
  { id: 'summary', header: 'Vorgang', width: 520, render: (entry) => entry.summary },
  {
    id: 'action',
    header: 'Art',
    width: 170,
    muted: true,
    render: (entry) => entry.action,
    sortValue: (entry) => entry.action,
  },
];

/** Who changed what and when, one month at a time. */
export function AuditView() {
  const api = useApi();
  // Entries are filed by UTC month; the picker simply selects one of those months.
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedId, setSelectedId] = useState<string>();
  const audit = useQuery({
    queryKey: queryKeys.audit(month),
    queryFn: () => data(api.admin.audit.$get({ query: { month } })),
  });
  const entries = audit.data ?? [];

  return (
    <ViewFrame
      title="Protokoll"
      commands={[refreshCommand(() => void audit.refetch())]}
      status={
        audit.data
          ? `${entries.length} ${entries.length === 1 ? 'Eintrag' : 'Einträge'}`
          : undefined
      }
      toolbarEnd={
        <label className="toolbar__field">
          Monat
          <input
            type="month"
            className="input input--narrow"
            value={month}
            max={new Date().toISOString().slice(0, 7)}
            onChange={(event) => event.target.value && setMonth(event.target.value)}
          />
        </label>
      }
    >
      {audit.data ? (
        <DataGrid
          label="Protokoll"
          columns={columns}
          rows={entries}
          rowId={(entry) => entry.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
          initialSort={{ columnId: 'at', descending: true }}
          empty={{
            title: 'Keine Einträge in diesem Monat',
            hint: 'Hier erscheint jede Änderung an Einstellungen, Terminplanung und Benutzerkonten.',
          }}
        />
      ) : (
        <QueryState query={audit} />
      )}
    </ViewFrame>
  );
}
