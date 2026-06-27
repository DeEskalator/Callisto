import { type Call, toZoned } from '@callisto/domain';
import { useState } from 'react';
import { useCall, useCallsOfDay } from '../../app/queries';
import { formatDuration, formatPhone, formatTime } from '../../lib/format';
import { localized } from '../../lib/i18n';
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

const t = localized({
  de: {
    testVoice: 'Testanruf (Sprache)',
    testText: 'Testanruf (Text)',
    time: 'Uhrzeit',
    caller: 'Anrufer',
    duration: 'Dauer',
    result: 'Ergebnis',
    summary: 'Zusammenfassung',
    title: 'Anrufe',
    count: (calls: number, emergencies: number) =>
      `${calls} ${calls === 1 ? 'Anruf' : 'Anrufe'}${emergencies > 0 ? ` · ${emergencies} Notfall` : ''}`,
    showTests: 'Testanrufe zeigen',
    conversation: 'Gespräch',
    start: 'Beginn',
    at: (time: string) => `${time} Uhr`,
    shortSummary: 'Kurzfassung',
    inquiries: 'Anliegen',
    transcript: 'Verlauf',
    nothingSelected: 'Kein Anruf ausgewählt',
    noneToday: 'Heute hat noch niemand angerufen',
    noneThatDay: 'Keine Anrufe an diesem Tag',
  },
  en: {
    testVoice: 'Test call (voice)',
    testText: 'Test call (text)',
    time: 'Time',
    caller: 'Caller',
    duration: 'Duration',
    result: 'Result',
    summary: 'Summary',
    title: 'Calls',
    count: (calls: number, emergencies: number) =>
      `${calls} ${calls === 1 ? 'call' : 'calls'}${
        emergencies > 0
          ? ` · ${emergencies} ${emergencies === 1 ? 'emergency' : 'emergencies'}`
          : ''
      }`,
    showTests: 'Show test calls',
    conversation: 'Conversation',
    start: 'Started',
    at: (time: string) => time,
    shortSummary: 'Summary',
    inquiries: 'Inquiries',
    transcript: 'Transcript',
    nothingSelected: 'No call selected',
    noneToday: 'Nobody has called yet today',
    noneThatDay: 'No calls on this day',
  },
});

const callerOf = (call: Call) =>
  call.channel === 'phone'
    ? formatPhone(call.callerNumber)
    : call.channel === 'test_voice'
      ? t.testVoice
      : t.testText;

const columns: GridColumn<Call>[] = [
  {
    id: 'time',
    header: t.time,
    width: 90,
    render: (call) => formatTime(call.startedAt),
    sortValue: (call) => call.startedAt,
  },
  { id: 'caller', header: t.caller, width: 170, render: callerOf, sortValue: callerOf },
  {
    id: 'duration',
    header: t.duration,
    width: 90,
    align: 'right',
    muted: true,
    render: (call) => formatDuration(call.startedAt, call.endedAt),
  },
  {
    id: 'status',
    header: t.result,
    width: 140,
    render: (call) => <CallStatusPill status={call.status} />,
    sortValue: (call) => callStatusLabel(call.status),
  },
  { id: 'summary', header: t.summary, width: 460, render: (call) => call.summary ?? '' },
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
      <ViewFrame title={t.title}>
        <QueryState query={calls} />
      </ViewFrame>
    );
  }
  const shown = calls.data.filter((call) => showTests || call.channel === 'phone');
  const selected = shown.find((call) => call.id === selectedId);
  const emergencies = shown.filter((call) => call.status === 'emergency').length;

  return (
    <ViewFrame
      title={t.title}
      commands={[refreshCommand(() => void calls.refetch())]}
      status={t.count(shown.length, emergencies)}
      toolbarEnd={
        <div className="toolbar__nav">
          <Checkbox label={t.showTests} checked={showTests} onChange={setShowTests} />
          <DayNavigation date={date} today={today} onChange={setDate} />
        </div>
      }
      inspector={{
        title: t.conversation,
        content: selected ? (
          <>
            <dl className="props">
              <dt>{t.caller}</dt>
              <dd>{callerOf(selected)}</dd>
              <dt>{t.start}</dt>
              <dd>{t.at(formatTime(selected.startedAt))}</dd>
              <dt>{t.duration}</dt>
              <dd>{formatDuration(selected.startedAt, selected.endedAt)}</dd>
              <dt>{t.result}</dt>
              <dd>{callStatusLabel(selected.status)}</dd>
              {selected.summary && (
                <>
                  <dt>{t.shortSummary}</dt>
                  <dd>{selected.summary}</dd>
                </>
              )}
            </dl>
            {detail && detail.inquiries.length > 0 && (
              <>
                <div className="inspector__section">{t.inquiries}</div>
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
            <div className="inspector__section">{t.transcript}</div>
            <Transcript callId={selected.id} />
          </>
        ) : (
          <div className="inspector__empty">{t.nothingSelected}</div>
        ),
      }}
    >
      <DataGrid
        label={t.title}
        columns={columns}
        rows={shown}
        rowId={(call) => call.id}
        selectedId={selectedId}
        onSelect={setSelectedId}
        initialSort={{ columnId: 'time', descending: true }}
        empty={{
          title: date === today ? t.noneToday : t.noneThatDay,
        }}
      />
    </ViewFrame>
  );
}
