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

type Scope = 'open' | 'day' | 'tests';
const SCOPES: Record<Scope, string> = {
  open: 'Offen',
  day: 'Tag',
  tests: 'Tests',
};

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
  // The day shown under "Tag" and "Tests": open inquiries are listed regardless of the day.
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
    onError: (error) =>
      notify({ kind: 'error', title: 'Nicht gespeichert', text: errorMessage(error) }),
  });

  if (!source.data) {
    return (
      <ViewFrame title="Anliegen">
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
      label: 'Erledigt',
      icon: Check,
      shortcut: { key: 'e', alt: true },
      disabled: !canManage || !isOpen(inquiry),
      run: () => inquiry && update.mutate({ inquiry, status: 'done' }),
    },
    {
      id: 'in-progress',
      label: 'In Arbeit',
      icon: Hourglass,
      disabled: !canManage || inquiry?.status !== 'new',
      run: () => inquiry && update.mutate({ inquiry, status: 'in_progress' }),
    },
    {
      id: 'reopen',
      label: 'Wieder öffnen',
      icon: RotateCcw,
      toolbar: false,
      disabled: !canManage || inquiry?.status !== 'done',
      run: () => inquiry && update.mutate({ inquiry, status: 'new' }),
    },
    {
      id: 'note',
      label: 'Notiz …',
      icon: StickyNote,
      disabled: !canManage || !inquiry,
      run: () => inquiry && setAnnotating(inquiry),
    },
    {
      id: 'cancel',
      label: inquiry?.details.type === 'appointment' ? 'Termin absagen …' : 'Stornieren …',
      icon: Ban,
      danger: true,
      disabled: !canManage || !isOpen(inquiry),
      run: () => inquiry && setCancelling(inquiry),
    },
  ];

  const columns: GridColumn<Inquiry>[] = [
    {
      id: 'created',
      header: 'Eingang',
      width: 130,
      render: (inquiry) =>
        `${inquiry.date === today ? 'Heute' : formatDate(inquiry.date)}, ${formatTime(inquiry.createdAt)}`,
      sortValue: (inquiry) => inquiry.createdAt,
    },
    {
      id: 'type',
      header: 'Art',
      width: 120,
      render: (inquiry) => <InquiryTypeLabel type={inquiry.details.type} />,
      sortValue: (inquiry) => INQUIRY_TYPES[inquiry.details.type].label,
    },
    {
      id: 'patient',
      header: 'Patient',
      width: 190,
      render: (inquiry) => patientName(inquiry.patient),
      sortValue: (inquiry) => patientName(inquiry.patient),
    },
    {
      id: 'born',
      header: 'Geboren',
      width: 100,
      muted: true,
      render: (inquiry) =>
        inquiry.patient.dateOfBirth ? formatDate(inquiry.patient.dateOfBirth) : '–',
    },
    { id: 'subject', header: 'Anliegen', width: 380, render: inquirySubject },
    {
      id: 'status',
      header: 'Status',
      width: 110,
      render: (inquiry) => <InquiryStatusPill status={inquiry.status} />,
      sortValue: (inquiry) => inquiry.status,
    },
  ];

  const count = inquiries.length;
  return (
    <ViewFrame
      title="Anliegen"
      commands={[...actionsFor(selected), refreshCommand(() => void source.refetch())]}
      status={`${count} ${count === 1 ? 'Anliegen' : 'Anliegen'}${scope === 'open' ? ' offen' : ''}`}
      toolbarEnd={
        <div className="toolbar__nav">
          {scope !== 'open' && <DayNavigation date={date} today={today} onChange={setDate} />}
          <select
            className="select"
            aria-label="Art des Anliegens"
            value={type}
            onChange={(event) => setType(event.target.value as InquiryType | 'all')}
          >
            <option value="all">Alle Arten</option>
            {Object.entries(INQUIRY_TYPES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own frame into the toolbar */}
          <div className="segmented" role="group" aria-label="Auswahl">
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
        title: 'Details',
        content: selected ? (
          <>
            <InquiryProperties inquiry={selected} />
            <div className="inspector__section">Gespräch</div>
            <Transcript callId={selected.callId} />
          </>
        ) : (
          <div className="inspector__empty">Kein Anliegen ausgewählt</div>
        ),
      }}
    >
      <DataGrid
        label="Anliegen"
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
                title: 'Alles erledigt',
                hint: 'Sobald ein Anrufer einen Termin bucht, ein Rezept bestellt oder um Rückruf bittet, erscheint das hier.',
              }
            : {
                title:
                  date === today ? 'Heute noch keine Anliegen' : 'Keine Anliegen an diesem Tag',
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
            cancelling.details.type === 'appointment' ? 'Termin absagen' : 'Anliegen stornieren'
          }
          text={
            cancelling.details.type === 'appointment' ? (
              <>
                Soll der Termin von {patientName(cancelling.patient)} ({inquirySubject(cancelling)})
                abgesagt werden? Der Slot wird wieder frei und kann neu vergeben werden. Der Patient
                wird nicht automatisch benachrichtigt.
              </>
            ) : (
              <>Soll das Anliegen von {patientName(cancelling.patient)} storniert werden?</>
            )
          }
          confirmLabel={cancelling.details.type === 'appointment' ? 'Termin absagen' : 'Stornieren'}
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
      title={`Notiz zu ${patientName(props.inquiry.patient)}`}
      size="narrow"
      onClose={props.onClose}
      onSubmit={() => props.onSave(note.trim())}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={props.saving}>
            Speichern
          </button>
        </>
      }
    >
      <textarea
        className="textarea"
        rows={5}
        aria-label="Notiz"
        placeholder="Interne Notiz für das Praxisteam"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        // biome-ignore lint/a11y/noAutofocus: the only field of the dialog takes the focus
        autoFocus
      />
    </Modal>
  );
}
