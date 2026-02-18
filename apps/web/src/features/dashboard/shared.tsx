import type { Call, Inquiry, InquiryStatus, InquiryType, Patient } from '@callisto/domain';
import { CalendarCheck, type LucideIcon, MessageSquareText, PhoneCall, Pill } from 'lucide-react';
import { useCall } from '../../app/queries';
import { formatDate, formatLongDate, formatPhone, formatTime } from '../../lib/format';

export const INQUIRY_TYPES: Record<InquiryType, { label: string; icon: LucideIcon }> = {
  appointment: { label: 'Termin', icon: CalendarCheck },
  prescription: { label: 'Rezept', icon: Pill },
  callback: { label: 'Rückruf', icon: PhoneCall },
  other: { label: 'Sonstiges', icon: MessageSquareText },
};

const INQUIRY_STATUS: Record<InquiryStatus, { label: string; className: string }> = {
  new: { label: 'Neu', className: 'pill pill--accent' },
  in_progress: { label: 'In Arbeit', className: 'pill pill--warning' },
  done: { label: 'Erledigt', className: 'pill pill--success' },
  cancelled: { label: 'Storniert', className: 'pill' },
};

const CALL_STATUS: Record<Call['status'], { label: string; className: string }> = {
  in_progress: { label: 'Läuft gerade', className: 'pill pill--accent' },
  completed: { label: 'Abgeschlossen', className: 'pill pill--success' },
  transferred: { label: 'Verbunden', className: 'pill pill--success' },
  emergency: { label: 'Notfall', className: 'pill pill--danger' },
  abandoned: { label: 'Aufgelegt', className: 'pill' },
  failed: { label: 'Störung', className: 'pill pill--danger' },
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
  [patient.lastName, patient.firstName].filter(Boolean).join(', ') || 'Unbekannt';

/** What an inquiry is about, in one line. */
export function inquirySubject(inquiry: Inquiry): string {
  const { details } = inquiry;
  switch (details.type) {
    case 'appointment':
      return `${details.categoryName} am ${formatDate(details.date)} um ${details.startTime} Uhr`;
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
      <dt>Art</dt>
      <dd>{INQUIRY_TYPES[details.type].label}</dd>
      <dt>Status</dt>
      <dd>{inquiryStatusLabel(inquiry.status)}</dd>
      <dt>Patient</dt>
      <dd>{patientName(patient)}</dd>
      <dt>Geboren</dt>
      <dd>{patient.dateOfBirth ? formatDate(patient.dateOfBirth) : 'Nicht genannt'}</dd>
      <dt>Telefon</dt>
      <dd>{patient.phone ? formatPhone(patient.phone) : 'Nicht genannt'}</dd>
      {details.type === 'appointment' && (
        <>
          <dt>Termin</dt>
          <dd>
            {formatLongDate(details.date)}, {details.startTime} – {details.endTime} Uhr
          </dd>
          <dt>Kategorie</dt>
          <dd>{details.categoryName}</dd>
          {details.reason && (
            <>
              <dt>Anlass</dt>
              <dd>{details.reason}</dd>
            </>
          )}
        </>
      )}
      {details.type === 'prescription' && (
        <>
          <dt>Medikamente</dt>
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
              <dt>Hinweis</dt>
              <dd>{details.note}</dd>
            </>
          )}
        </>
      )}
      {details.type === 'callback' && (
        <>
          <dt>Anliegen</dt>
          <dd>{details.topic}</dd>
          {details.preferredTime && (
            <>
              <dt>Erreichbar</dt>
              <dd>{details.preferredTime}</dd>
            </>
          )}
        </>
      )}
      {details.type === 'other' && (
        <>
          <dt>Anliegen</dt>
          <dd>{details.summary}</dd>
          <dt>Verbunden</dt>
          <dd>{details.transferred ? 'Ja, zur Praxis durchgestellt' : 'Nein'}</dd>
        </>
      )}
      <dt>Eingang</dt>
      <dd>
        {formatDate(inquiry.date)}, {formatTime(inquiry.createdAt)} Uhr
      </dd>
      {inquiry.note && (
        <>
          <dt>Notiz</dt>
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
    return <p className="transcript__note">Zu diesem Anliegen gibt es kein Gespräch.</p>;
  }
  if (!call.data) {
    return (
      <p className="transcript__note">
        {call.isError ? 'Das Gespräch konnte nicht geladen werden.' : 'Wird geladen …'}
      </p>
    );
  }
  const { turns } = call.data;
  if (turns === null) {
    return (
      <p className="transcript__note">
        Für das Lesen von Gesprächen fehlt Ihnen die Berechtigung „Transkripte lesen“.
      </p>
    );
  }
  return (
    <ol className="transcript" aria-label="Gesprächsverlauf">
      {turns.map((turn) => (
        <li key={turn.seq} className="transcript__turn" data-role={turn.role}>
          <span className="transcript__meta">
            {turn.role === 'assistant' ? 'Assistent' : 'Anrufer'} · {formatTime(turn.at)}
          </span>
          <span className="transcript__text">{turn.text}</span>
        </li>
      ))}
      {call.data.call.status === 'in_progress' && (
        <li className="transcript__note">Das Gespräch läuft noch …</li>
      )}
    </ol>
  );
}
