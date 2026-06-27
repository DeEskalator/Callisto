import { type Inquiry, type InquiryStatus, type InquiryType, toZoned } from '@callisto/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Hourglass, RotateCcw, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { data, errorMessage, useApi } from '../../app/api';
import {
  queryKeys,
  useHasPermission,
  useInquiriesOfDay,
  useOpenInquiries,
} from '../../app/queries';
import { formatDate, formatTime } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { type Command, refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { DataGrid, type GridColumn } from '../../ui/DataGrid';
import type { MenuEntry } from '../../ui/Menu';
import { ConfirmDialog, Modal } from '../../ui/Modal';
import { QueryState } from '../../ui/QueryState';
import { useNotify } from '../../ui/Toast';
import {
  DayNavigation,
  INQUIRY_TYPES,
  InquiryProperties,
  InquiryStatusPill,
  InquiryTypeLabel,
  inquirySubject,
  patientName,
  Transcript,
} from './shared';

const t = localized({
  de: {
    scopes: { open: 'Offen', day: 'Tag', tests: 'Tests' },
    title: 'Anliegen',
    notSaved: 'Nicht gespeichert',
    done: 'Erledigt',
    inProgress: 'In Arbeit',
    reopen: 'Wieder öffnen',
    note: 'Notiz …',
    cancelAppointment: 'Termin absagen …',
    cancel: 'Stornieren …',
    received: 'Eingang',
    today: 'Heute',
    type: 'Art',
    patient: 'Patient',
    born: 'Geboren',
    subject: 'Anliegen',
    status: 'Status',
    count: (count: number, open: boolean) => `${count} Anliegen${open ? ' offen' : ''}`,
    typeFilter: 'Art des Anliegens',
    allTypes: 'Alle Arten',
    selection: 'Auswahl',
    details: 'Details',
    conversation: 'Gespräch',
    nothingSelected: 'Kein Anliegen ausgewählt',
    allDone: 'Alles erledigt',
    allDoneHint:
      'Sobald ein Anrufer einen Termin bucht, ein Rezept bestellt oder um Rückruf bittet, erscheint das hier.',
    noneToday: 'Heute noch keine Anliegen',
    noneThatDay: 'Keine Anliegen an diesem Tag',
    cancelAppointmentTitle: 'Termin absagen',
    cancelInquiryTitle: 'Anliegen stornieren',
    cancelAppointmentText: (patient: string, subject: string) =>
      `Soll der Termin von ${patient} (${subject}) abgesagt werden? Der Slot wird wieder frei und kann neu vergeben werden. Der Patient wird nicht automatisch benachrichtigt.`,
    cancelInquiryText: (patient: string) => `Soll das Anliegen von ${patient} storniert werden?`,
    confirmCancel: 'Stornieren',
    noteTitle: (patient: string) => `Notiz zu ${patient}`,
    abort: 'Abbrechen',
    save: 'Speichern',
    noteLabel: 'Notiz',
    notePlaceholder: 'Interne Notiz für das Praxisteam',
  },
  en: {
    scopes: { open: 'Open', day: 'Day', tests: 'Tests' },
    title: 'Inquiries',
    notSaved: 'Not saved',
    done: 'Done',
    inProgress: 'In progress',
    reopen: 'Reopen',
    note: 'Note …',
    cancelAppointment: 'Cancel appointment …',
    cancel: 'Cancel …',
    received: 'Received',
    today: 'Today',
    type: 'Type',
    patient: 'Patient',
    born: 'Born',
    subject: 'Concern',
    status: 'Status',
    count: (count: number, open: boolean) =>
      `${count} ${count === 1 ? 'inquiry' : 'inquiries'}${open ? ' open' : ''}`,
    typeFilter: 'Type of inquiry',
    allTypes: 'All types',
    selection: 'Selection',
    details: 'Details',
    conversation: 'Conversation',
    nothingSelected: 'No inquiry selected',
    allDone: 'All done',
    allDoneHint:
      'As soon as a caller books an appointment, orders a prescription or asks for a callback, it shows up here.',
    noneToday: 'No inquiries yet today',
    noneThatDay: 'No inquiries on this day',
    cancelAppointmentTitle: 'Cancel appointment',
    cancelInquiryTitle: 'Cancel inquiry',
    cancelAppointmentText: (patient: string, subject: string) =>
      `Cancel the appointment of ${patient} (${subject})? The slot becomes free and can be booked again. The patient is not notified automatically.`,
    cancelInquiryText: (patient: string) => `Cancel the inquiry of ${patient}?`,
    confirmCancel: 'Cancel inquiry',
    noteTitle: (patient: string) => `Note on ${patient}`,
    abort: 'Cancel',
    save: 'Save',
    noteLabel: 'Note',
    notePlaceholder: 'Internal note for the practice team',
  },
});

type Scope = 'open' | 'day' | 'tests';
const SCOPES: Record<Scope, string> = t.scopes;

/**
 * The practice's worklist: what callers left with the assistant and what still has to be done
 * about it. This is the view the team works in during the day.
 */
export function InquiriesView() {
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const canManage = useHasPermission('inquiries.manage');
  const today = toZoned(new Date(), 'Europe/Berlin').date;

  const [scope, setScope] = useState<Scope>('open');
  // The day shown under "Day" and "Tests": open inquiries are listed regardless of the day.
  const [date, setDate] = useState(today);
  const [type, setType] = useState<InquiryType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [annotating, setAnnotating] = useState<Inquiry>();
  const [cancelling, setCancelling] = useState<Inquiry>();

  const open = useOpenInquiries();
  const ofDay = useInquiriesOfDay(date);
  const source = scope === 'open' ? open : ofDay;

  const update = useMutation({
    mutationFn: (change: { inquiry: Inquiry; status?: InquiryStatus; note?: string }) =>
      data(
        api.calls.inquiries[':id'].$patch({
          param: { id: change.inquiry.id },
          json: {
            ...(change.status ? { status: change.status } : {}),
            ...(change.note !== undefined ? { note: change.note } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.allInquiries }),
        // Cancelling an appointment frees its slot.
        queryClient.invalidateQueries({ queryKey: queryKeys.allSlots }),
      ]);
      setAnnotating(undefined);
      setCancelling(undefined);
    },
    onError: (error) => notify({ kind: 'error', title: t.notSaved, text: errorMessage(error) }),
  });

  if (!source.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={source} />
      </ViewFrame>
    );
  }

  const inquiries = source.data.filter(
    (inquiry) =>
      inquiry.test === (scope === 'tests') && (type === 'all' || inquiry.details.type === type),
  );
  const selected = inquiries.find((inquiry) => inquiry.id === selectedId);
  const isOpen = (inquiry: Inquiry | undefined) =>
    inquiry?.status === 'new' || inquiry?.status === 'in_progress';

  const actionsFor = (inquiry: Inquiry | undefined): Command[] => [
    {
      id: 'done',
      label: t.done,
      icon: Check,
      shortcut: { key: 'e', alt: true },
      disabled: !canManage || !isOpen(inquiry),
      run: () => inquiry && update.mutate({ inquiry, status: 'done' }),
    },
    {
      id: 'in-progress',
      label: t.inProgress,
      icon: Hourglass,
      // Also back from "done", when it turns out something is still missing.
      disabled: !canManage || (inquiry?.status !== 'new' && inquiry?.status !== 'done'),
      run: () => inquiry && update.mutate({ inquiry, status: 'in_progress' }),
    },
    {
      id: 'reopen',
      label: t.reopen,
      icon: RotateCcw,
      toolbar: false,
      disabled: !canManage || inquiry?.status !== 'done',
      run: () => inquiry && update.mutate({ inquiry, status: 'new' }),
    },
    {
      id: 'note',
      label: t.note,
      icon: StickyNote,
      disabled: !canManage || !inquiry,
      run: () => inquiry && setAnnotating(inquiry),
    },
    {
      id: 'cancel',
      label: inquiry?.details.type === 'appointment' ? t.cancelAppointment : t.cancel,
      icon: Ban,
      danger: true,
      disabled: !canManage || !isOpen(inquiry),
      run: () => inquiry && setCancelling(inquiry),
    },
  ];

  const columns: GridColumn<Inquiry>[] = [
    {
      id: 'created',
      header: t.received,
      width: 130,
      render: (inquiry) =>
        `${inquiry.date === today ? t.today : formatDate(inquiry.date)}, ${formatTime(inquiry.createdAt)}`,
      sortValue: (inquiry) => inquiry.createdAt,
    },
    {
      id: 'type',
      header: t.type,
      width: 120,
      render: (inquiry) => <InquiryTypeLabel type={inquiry.details.type} />,
      sortValue: (inquiry) => INQUIRY_TYPES[inquiry.details.type].label,
    },
    {
      id: 'patient',
      header: t.patient,
      width: 190,
      render: (inquiry) => patientName(inquiry.patient),
      sortValue: (inquiry) => patientName(inquiry.patient),
    },
    {
      id: 'born',
      header: t.born,
      width: 100,
      muted: true,
      render: (inquiry) =>
        inquiry.patient.dateOfBirth ? formatDate(inquiry.patient.dateOfBirth) : '–',
    },
    { id: 'subject', header: t.subject, width: 380, render: inquirySubject },
    {
      id: 'status',
      header: t.status,
      width: 110,
      render: (inquiry) => <InquiryStatusPill status={inquiry.status} />,
      sortValue: (inquiry) => inquiry.status,
    },
  ];

  const count = inquiries.length;
  return (
    <ViewFrame
      title={t.title}
      commands={[...actionsFor(selected), refreshCommand(() => void source.refetch())]}
      status={t.count(count, scope === 'open')}
      toolbarEnd={
        <div className="toolbar__nav">
          {scope !== 'open' && <DayNavigation date={date} today={today} onChange={setDate} />}
          <select
            className="select"
            aria-label={t.typeFilter}
            value={type}
            onChange={(event) => setType(event.target.value as InquiryType | 'all')}
          >
            <option value="all">{t.allTypes}</option>
            {Object.entries(INQUIRY_TYPES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own frame into the toolbar */}
          <div className="segmented" role="group" aria-label={t.selection}>
            {(Object.keys(SCOPES) as Scope[]).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={scope === each}
                onClick={() => setScope(each)}
              >
                {SCOPES[each]}
              </button>
            ))}
          </div>
        </div>
      }
      inspector={{
        title: t.details,
        content: selected ? (
          <>
            <InquiryProperties inquiry={selected} />
            <div className="inspector__section">{t.conversation}</div>
            <Transcript callId={selected.callId} />
          </>
        ) : (
          <div className="inspector__empty">{t.nothingSelected}</div>
        ),
      }}
    >
      <DataGrid
        label={t.title}
        columns={columns}
        rows={inquiries}
        rowId={(inquiry) => inquiry.id}
        selectedId={selectedId}
        onSelect={setSelectedId}
        initialSort={{ columnId: 'created', descending: false }}
        {...(canManage ? { onOpen: setAnnotating } : {})}
        contextMenu={(inquiry) =>
          inquiry
            ? actionsFor(inquiry).map(
                (command): MenuEntry => ({
                  label: command.label,
                  disabled: command.disabled ?? false,
                  danger: command.danger ?? false,
                  onSelect: command.run,
                  ...(command.icon ? { icon: command.icon } : {}),
                }),
              )
            : []
        }
        empty={
          scope === 'open'
            ? {
                title: t.allDone,
                hint: t.allDoneHint,
              }
            : {
                title: date === today ? t.noneToday : t.noneThatDay,
              }
        }
      />

      {annotating && (
        <NoteDialog
          inquiry={annotating}
          saving={update.isPending}
          onClose={() => setAnnotating(undefined)}
          onSave={(note) => update.mutate({ inquiry: annotating, note })}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title={
            cancelling.details.type === 'appointment'
              ? t.cancelAppointmentTitle
              : t.cancelInquiryTitle
          }
          text={
            cancelling.details.type === 'appointment'
              ? t.cancelAppointmentText(patientName(cancelling.patient), inquirySubject(cancelling))
              : t.cancelInquiryText(patientName(cancelling.patient))
          }
          confirmLabel={
            cancelling.details.type === 'appointment' ? t.cancelAppointmentTitle : t.confirmCancel
          }
          danger
          busy={update.isPending}
          onConfirm={() => update.mutate({ inquiry: cancelling, status: 'cancelled' })}
          onCancel={() => setCancelling(undefined)}
        />
      )}
    </ViewFrame>
  );
}

function NoteDialog(props: {
  inquiry: Inquiry;
  saving: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(props.inquiry.note ?? '');
  return (
    <Modal
      title={t.noteTitle(patientName(props.inquiry.patient))}
      size="narrow"
      onClose={props.onClose}
      onSubmit={() => props.onSave(note.trim())}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            {t.abort}
          </button>
          <button type="submit" className="btn btn--primary" disabled={props.saving}>
            {t.save}
          </button>
        </>
      }
    >
      <textarea
        className="textarea"
        rows={5}
        aria-label={t.noteLabel}
        placeholder={t.notePlaceholder}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        // biome-ignore lint/a11y/noAutofocus: the only field of the dialog takes the focus
        autoFocus
      />
    </Modal>
  );
}
