import { type Call, toZoned } from '@callisto/domain';
import { useState } from 'react';
import { useCall, useCallsOfDay } from '../../app/queries';
import { formatDuration, formatPhone, formatTime } from '../../lib/format';
import { refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { DataGrid, type GridColumn } from '../../ui/DataGrid';
import { Checkbox } from '../../ui/Form';
import { QueryState } from '../../ui/QueryState';
import {
  CallStatusPill,
  callStatusLabel,
  DayNavigation,
  InquiryTypeLabel,
  inquirySubject,
  patientName,
  Transcript,
} from './shared';

const callerOf = (call: Call) =>
  call.channel === 'phone'
    ? formatPhone(call.callerNumber)
    : call.channel === 'test_voice'
      ? 'Testanruf (Sprache)'
      : 'Testanruf (Text)';

const columns: GridColumn<Call>[] = [
  {
    id: 'time',
    header: 'Uhrzeit',
    width: 90,
    render: (call) => formatTime(call.startedAt),
    sortValue: (call) => call.startedAt,
  },
  { id: 'caller', header: 'Anrufer', width: 170, render: callerOf, sortValue: callerOf },
  {
    id: 'duration',
    header: 'Dauer',
    width: 90,
    align: 'right',
    muted: true,
    render: (call) => formatDuration(call.startedAt, call.endedAt),
  },
  {
    id: 'status',
    header: 'Ergebnis',
    width: 140,
    render: (call) => <CallStatusPill status={call.status} />,
    sortValue: (call) => callStatusLabel(call.status),
  },
  { id: 'summary', header: 'Zusammenfassung', width: 460, render: (call) => call.summary ?? '' },
];

/** Every call of a day: who called, how it ended, and the conversation itself. */
export function CallsView() {
  const today = toZoned(new Date(), 'Europe/Berlin').date;
  const [date, setDate] = useState(today);
  const [showTests, setShowTests] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const calls = useCallsOfDay(date);
  const detail = useCall(selectedId).data;

  if (!calls.data) {
    return (
      <ViewFrame title="Anrufe">
        <QueryState query={calls} />
      </ViewFrame>
    );
  }
  const shown = calls.data.filter((call) => showTests || call.channel === 'phone');
  const selected = shown.find((call) => call.id === selectedId);
  const emergencies = shown.filter((call) => call.status === 'emergency').length;

  return (
    <ViewFrame
      title="Anrufe"
      commands={[refreshCommand(() => void calls.refetch())]}
      status={`${shown.length} ${shown.length === 1 ? 'Anruf' : 'Anrufe'}${
        emergencies > 0 ? ` · ${emergencies} Notfall` : ''
      }`}
      toolbarEnd={
        <div className="toolbar__nav">
          <Checkbox label="Testanrufe zeigen" checked={showTests} onChange={setShowTests} />
          <DayNavigation date={date} today={today} onChange={setDate} />
        </div>
      }
      inspector={{
        title: 'Gespräch',
        content: selected ? (
          <>
            <dl className="props">
              <dt>Anrufer</dt>
              <dd>{callerOf(selected)}</dd>
              <dt>Beginn</dt>
              <dd>{formatTime(selected.startedAt)} Uhr</dd>
              <dt>Dauer</dt>
              <dd>{formatDuration(selected.startedAt, selected.endedAt)}</dd>
              <dt>Ergebnis</dt>
              <dd>{callStatusLabel(selected.status)}</dd>
              {selected.summary && (
                <>
                  <dt>Kurzfassung</dt>
                  <dd>{selected.summary}</dd>
                </>
              )}
            </dl>
            {detail && detail.inquiries.length > 0 && (
              <>
                <div className="inspector__section">Anliegen</div>
                {detail.inquiries.map((inquiry) => (
                  <div key={inquiry.id} className="linked-inquiry">
                    <InquiryTypeLabel type={inquiry.details.type} />
                    <span>
                      {patientName(inquiry.patient)}: {inquirySubject(inquiry)}
                    </span>
                  </div>
                ))}
              </>
            )}
            <div className="inspector__section">Verlauf</div>
            <Transcript callId={selected.id} />
          </>
        ) : (
          <div className="inspector__empty">Kein Anruf ausgewählt</div>
        ),
      }}
    >
      <DataGrid
        label="Anrufe"
        columns={columns}
        rows={shown}
        rowId={(call) => call.id}
        selectedId={selectedId}
        onSelect={setSelectedId}
        initialSort={{ columnId: 'time', descending: true }}
        empty={{
          title: date === today ? 'Heute hat noch niemand angerufen' : 'Keine Anrufe an diesem Tag',
        }}
      />
    </ViewFrame>
  );
}
