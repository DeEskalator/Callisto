import type { AuditEntry } from '@callisto/domain';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { data, useApi } from '../../app/api';
import { queryKeys } from '../../app/queries';
import { formatTimestamp } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { DataGrid, type GridColumn } from '../../ui/DataGrid';
import { QueryState } from '../../ui/QueryState';

const t = localized({
  de: {
    at: 'Zeitpunkt',
    actor: 'Benutzer',
    summary: 'Vorgang',
    action: 'Art',
    title: 'Protokoll',
    count: (count: number) => `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`,
    month: 'Monat',
    empty: 'Keine Einträge in diesem Monat',
    emptyHint: 'Hier erscheint jede Änderung an Einstellungen, Terminplanung und Benutzerkonten.',
  },
  en: {
    at: 'Time',
    actor: 'User',
    summary: 'Change',
    action: 'Type',
    title: 'Audit log',
    count: (count: number) => `${count} ${count === 1 ? 'entry' : 'entries'}`,
    month: 'Month',
    empty: 'No entries in this month',
    emptyHint: 'Every change to settings, scheduling and user accounts appears here.',
  },
});

const columns: GridColumn<AuditEntry>[] = [
  {
    id: 'at',
    header: t.at,
    width: 160,
    render: (entry) => formatTimestamp(entry.at),
    sortValue: (entry) => entry.at,
  },
  {
    id: 'actor',
    header: t.actor,
    width: 220,
    render: (entry) => entry.actorName,
    sortValue: (entry) => entry.actorName,
  },
  { id: 'summary', header: t.summary, width: 520, render: (entry) => entry.summary },
  {
    id: 'action',
    header: t.action,
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
      title={t.title}
      commands={[refreshCommand(() => void audit.refetch())]}
      status={audit.data ? t.count(entries.length) : undefined}
      toolbarEnd={
        <label className="toolbar__field">
          {t.month}
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
          label={t.title}
          columns={columns}
          rows={entries}
          rowId={(entry) => entry.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
          initialSort={{ columnId: 'at', descending: true }}
          empty={{
            title: t.empty,
            hint: t.emptyHint,
          }}
        />
      ) : (
        <QueryState query={audit} />
      )}
    </ViewFrame>
  );
}
