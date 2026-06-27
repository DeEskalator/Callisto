import {
  addDays,
  type Call,
  type Inquiry,
  type InquiryStatus,
  type InquiryType,
  type Patient,
} from '@callisto/domain';
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  MessageSquareText,
  PhoneCall,
  Pill,
} from 'lucide-react';
import { useCall } from '../../app/queries';
import { formatDate, formatLongDate, formatPhone, formatTime } from '../../lib/format';
import { localized } from '../../lib/i18n';

const t = localized({
  de: {
    types: {
      appointment: 'Termin',
      prescription: 'Rezept',
      callback: 'Rückruf',
      other: 'Sonstiges',
    },
    inquiryStatus: {
      new: 'Neu',
      in_progress: 'In Arbeit',
      done: 'Erledigt',
      cancelled: 'Storniert',
    },
    callStatus: {
      in_progress: 'Läuft gerade',
      completed: 'Abgeschlossen',
      transferred: 'Verbunden',
      emergency: 'Notfall',
      abandoned: 'Aufgelegt',
      failed: 'Störung',
    },
    unknown: 'Unbekannt',
    appointmentOn: (category: string, date: string, time: string) =>
      `${category} am ${date} um ${time} Uhr`,
    type: 'Art',
    status: 'Status',
    patient: 'Patient',
    born: 'Geboren',
    notGiven: 'Nicht genannt',
    phone: 'Telefon',
    appointment: 'Termin',
    timeRange: (from: string, to: string) => `${from} – ${to} Uhr`,
    category: 'Kategorie',
    reason: 'Anlass',
    medications: 'Medikamente',
    note: 'Hinweis',
    concern: 'Anliegen',
    reachable: 'Erreichbar',
    transferred: 'Verbunden',
    transferredYes: 'Ja, zur Praxis durchgestellt',
    transferredNo: 'Nein',
    received: 'Eingang',
    at: (time: string) => `${time} Uhr`,
    internalNote: 'Notiz',
    noCall: 'Zu diesem Anliegen gibt es kein Gespräch.',
    callFailed: 'Das Gespräch konnte nicht geladen werden.',
    loading: 'Wird geladen …',
    noPermission: 'Für das Lesen von Gesprächen fehlt Ihnen die Berechtigung „Transkripte lesen“.',
    conversation: 'Gesprächsverlauf',
    assistant: 'Assistent',
    caller: 'Anrufer',
    stillRunning: 'Das Gespräch läuft noch …',
    previousDay: 'Vorheriger Tag',
    today: 'Heute',
    nextDay: 'Nächster Tag',
  },
  en: {
    types: {
      appointment: 'Appointment',
      prescription: 'Prescription',
      callback: 'Callback',
      other: 'Other',
    },
    inquiryStatus: { new: 'New', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' },
    callStatus: {
      in_progress: 'In progress',
      completed: 'Completed',
      transferred: 'Transferred',
      emergency: 'Emergency',
      abandoned: 'Hung up',
      failed: 'Failure',
    },
    unknown: 'Unknown',
    appointmentOn: (category: string, date: string, time: string) =>
      `${category} on ${date} at ${time}`,
    type: 'Type',
    status: 'Status',
    patient: 'Patient',
    born: 'Born',
    notGiven: 'Not given',
    phone: 'Phone',
    appointment: 'Appointment',
    timeRange: (from: string, to: string) => `${from} – ${to}`,
    category: 'Category',
    reason: 'Reason',
    medications: 'Medications',
    note: 'Note',
    concern: 'Concern',
    reachable: 'Reachable',
    transferred: 'Transferred',
    transferredYes: 'Yes, put through to the practice',
    transferredNo: 'No',
    received: 'Received',
    at: (time: string) => time,
    internalNote: 'Note',
    noCall: 'There is no conversation for this inquiry.',
    callFailed: 'The conversation could not be loaded.',
    loading: 'Loading …',
    noPermission: 'You lack the permission “Read transcripts” to read conversations.',
    conversation: 'Conversation',
    assistant: 'Assistant',
    caller: 'Caller',
    stillRunning: 'The call is still going on …',
    previousDay: 'Previous day',
    today: 'Today',
    nextDay: 'Next day',
  },
});

export const INQUIRY_TYPES: Record<InquiryType, { label: string; icon: LucideIcon }> = {
  appointment: { label: t.types.appointment, icon: CalendarCheck },
  prescription: { label: t.types.prescription, icon: Pill },
  callback: { label: t.types.callback, icon: PhoneCall },
  other: { label: t.types.other, icon: MessageSquareText },
};

const INQUIRY_STATUS: Record<InquiryStatus, { label: string; className: string }> = {
  new: { label: t.inquiryStatus.new, className: 'pill pill--accent' },
  in_progress: { label: t.inquiryStatus.in_progress, className: 'pill pill--warning' },
  done: { label: t.inquiryStatus.done, className: 'pill pill--success' },
  cancelled: { label: t.inquiryStatus.cancelled, className: 'pill' },
};

const CALL_STATUS: Record<Call['status'], { label: string; className: string }> = {
  in_progress: { label: t.callStatus.in_progress, className: 'pill pill--accent' },
  completed: { label: t.callStatus.completed, className: 'pill pill--success' },
  transferred: { label: t.callStatus.transferred, className: 'pill pill--success' },
  emergency: { label: t.callStatus.emergency, className: 'pill pill--danger' },
  abandoned: { label: t.callStatus.abandoned, className: 'pill' },
  failed: { label: t.callStatus.failed, className: 'pill pill--danger' },
};

export const inquiryStatusLabel = (status: InquiryStatus) => INQUIRY_STATUS[status].label;
export const callStatusLabel = (status: Call['status']) => CALL_STATUS[status].label;

export function InquiryStatusPill(props: { status: InquiryStatus }) {
  const { label, className } = INQUIRY_STATUS[props.status];
  return <span className={className}>{label}</span>;
}

export function CallStatusPill(props: { status: Call['status'] }) {
  const { label, className } = CALL_STATUS[props.status];
  return <span className={className}>{label}</span>;
}

export function InquiryTypeLabel(props: { type: InquiryType }) {
  const { label, icon: Icon } = INQUIRY_TYPES[props.type];
  return (
    <span className="type-label">
      <Icon />
      {label}
    </span>
  );
}

/** `Brandt, Helga`, or what is known of the name. */
export const patientName = (patient: Patient) =>
  [patient.lastName, patient.firstName].filter(Boolean).join(', ') || t.unknown;

/** What an inquiry is about, in one line. */
export function inquirySubject(inquiry: Inquiry): string {
  const { details } = inquiry;
  switch (details.type) {
    case 'appointment':
      return t.appointmentOn(details.categoryName, formatDate(details.date), details.startTime);
    case 'prescription':
      return details.medications
        .map((medication) => [medication.name, medication.strength].filter(Boolean).join(' '))
        .join(', ');
    case 'callback':
      return details.topic;
    default:
      return details.summary;
  }
}

/** Everything known about an inquiry, as a property list for the detail pane. */
export function InquiryProperties(props: { inquiry: Inquiry }) {
  const { inquiry } = props;
  const { patient, details } = inquiry;
  return (
    <dl className="props">
      <dt>{t.type}</dt>
      <dd>{INQUIRY_TYPES[details.type].label}</dd>
      <dt>{t.status}</dt>
      <dd>{inquiryStatusLabel(inquiry.status)}</dd>
      <dt>{t.patient}</dt>
      <dd>{patientName(patient)}</dd>
      <dt>{t.born}</dt>
      <dd>{patient.dateOfBirth ? formatDate(patient.dateOfBirth) : t.notGiven}</dd>
      <dt>{t.phone}</dt>
      <dd>{patient.phone ? formatPhone(patient.phone) : t.notGiven}</dd>
      {details.type === 'appointment' && (
        <>
          <dt>{t.appointment}</dt>
          <dd>
            {formatLongDate(details.date)}, {t.timeRange(details.startTime, details.endTime)}
          </dd>
          <dt>{t.category}</dt>
          <dd>{details.categoryName}</dd>
          {details.reason && (
            <>
              <dt>{t.reason}</dt>
              <dd>{details.reason}</dd>
            </>
          )}
        </>
      )}
      {details.type === 'prescription' && (
        <>
          <dt>{t.medications}</dt>
          <dd>
            {details.medications.map((medication) => (
              <div key={medication.name}>
                {[medication.name, medication.strength, medication.packageSize]
                  .filter(Boolean)
                  .join(', ')}
              </div>
            ))}
          </dd>
          {details.note && (
            <>
              <dt>{t.note}</dt>
              <dd>{details.note}</dd>
            </>
          )}
        </>
      )}
      {details.type === 'callback' && (
        <>
          <dt>{t.concern}</dt>
          <dd>{details.topic}</dd>
          {details.preferredTime && (
            <>
              <dt>{t.reachable}</dt>
              <dd>{details.preferredTime}</dd>
            </>
          )}
        </>
      )}
      {details.type === 'other' && (
        <>
          <dt>{t.concern}</dt>
          <dd>{details.summary}</dd>
          <dt>{t.transferred}</dt>
          <dd>{details.transferred ? t.transferredYes : t.transferredNo}</dd>
        </>
      )}
      <dt>{t.received}</dt>
      <dd>
        {formatDate(inquiry.date)}, {t.at(formatTime(inquiry.createdAt))}
      </dd>
      {inquiry.note && (
        <>
          <dt>{t.internalNote}</dt>
          <dd>{inquiry.note}</dd>
        </>
      )}
    </dl>
  );
}

/** The conversation of a call, line by line. Follows along while the call is still running. */
export function Transcript(props: { callId: string | undefined }) {
  const call = useCall(props.callId);
  if (!props.callId) {
    return <p className="transcript__note">{t.noCall}</p>;
  }
  if (!call.data) {
    return <p className="transcript__note">{call.isError ? t.callFailed : t.loading}</p>;
  }
  const { turns } = call.data;
  if (turns === null) {
    return <p className="transcript__note">{t.noPermission}</p>;
  }
  return (
    <ol className="transcript" aria-label={t.conversation}>
      {turns.map((turn) => (
        <li key={turn.seq} className="transcript__turn" data-role={turn.role}>
          <span className="transcript__meta">
            {turn.role === 'assistant' ? t.assistant : t.caller} · {formatTime(turn.at)}
          </span>
          <span className="transcript__text">{turn.text}</span>
        </li>
      ))}
      {call.data.call.status === 'in_progress' && (
        <li className="transcript__note">{t.stillRunning}</li>
      )}
    </ol>
  );
}

/** Steps through the days of the past, one at a time; the future holds no calls yet. */
export function DayNavigation(props: {
  date: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const { date, today, onChange } = props;
  return (
    <>
      <span className="toolbar__period">{formatLongDate(date)}</span>
      <button
        type="button"
        className="btn btn--icon"
        aria-label={t.previousDay}
        title={t.previousDay}
        onClick={() => onChange(addDays(date, -1))}
      >
        <ChevronLeft />
      </button>
      <button type="button" className="btn" onClick={() => onChange(today)}>
        {t.today}
      </button>
      <button
        type="button"
        className="btn btn--icon"
        aria-label={t.nextDay}
        title={t.nextDay}
        disabled={date >= today}
        onClick={() => onChange(addDays(date, 1))}
      >
        <ChevronRight />
      </button>
    </>
  );
}
