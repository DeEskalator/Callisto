import { useQueryClient } from '@tanstack/react-query';
import { Keyboard, Mic, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { data, errorMessage, useApi } from '../../app/api';
import { queryKeys } from '../../app/queries';
import { localized } from '../../lib/i18n';
import { Modal } from '../../ui/Modal';
import { Speaker, startMicrophone } from './audio';

type Mode = 'text' | 'voice';
type Phase = 'choose' | 'connecting' | 'talking' | 'ended';
interface Line {
  role: 'caller' | 'assistant';
  text: string;
}

const t = localized({
  de: {
    endReasons: {
      completed: 'Das Gespräch wurde beendet.',
      transferred: 'An dieser Stelle würde der Anrufer mit der Praxis verbunden.',
      emergency: 'Der Assistent hat einen Notfall erkannt und das Gespräch beendet.',
      failed: 'Das Gespräch wurde wegen einer Störung beendet.',
    } as Record<string, string>,
    disconnected: 'Die Verbindung wurde getrennt.',
    noMicrophone:
      'Auf das Mikrofon kann nicht zugegriffen werden. Bitte erlauben Sie den Zugriff im Browser.',
    title: 'Testanruf',
    hangUp: 'Auflegen',
    again: 'Neuer Testanruf',
    close: 'Schließen',
    intro:
      'Sprechen oder schreiben Sie mit dem Assistenten, als würden Sie in der Praxis anrufen. Der Testanruf durchläuft dieselben Ansagen und Abläufe wie ein echter Anruf. Was dabei entsteht, wird als Test gekennzeichnet; gebuchte Termine belegen aber einen echten Slot, bis Sie sie unter „Anliegen“ wieder absagen.',
    voice: 'Mit Sprache',
    voiceHint: 'Über Mikrofon und Lautsprecher, wie am Telefon',
    text: 'Mit Text',
    textHint: 'Sie tippen, der Assistent antwortet schriftlich',
    assistant: 'Assistent',
    you: 'Sie',
    connecting: 'Verbindung wird aufgebaut …',
    microphoneOnHint: 'Das Mikrofon ist eingeschaltet',
    microphoneOn: 'Mikrofon an',
    message: 'Nachricht an den Assistenten',
    speakOrType: 'Sprechen Sie, oder tippen Sie hier …',
    yourAnswer: 'Ihre Antwort …',
    send: 'Senden',
  },
  en: {
    endReasons: {
      completed: 'The call has ended.',
      transferred: 'At this point the caller would be put through to the practice.',
      emergency: 'The assistant recognised an emergency and ended the call.',
      failed: 'The call was ended because of a failure.',
    } as Record<string, string>,
    disconnected: 'The connection was closed.',
    noMicrophone: 'The microphone cannot be accessed. Please allow access in the browser.',
    title: 'Test call',
    hangUp: 'Hang up',
    again: 'New test call',
    close: 'Close',
    intro:
      'Speak or write with the assistant as if you were calling the practice. The test call goes through the same announcements and steps as a real call. Whatever it creates is marked as a test; booked appointments do take a real slot, though, until you cancel them under “Inquiries”.',
    voice: 'With voice',
    voiceHint: 'Through microphone and speaker, like on the phone',
    text: 'With text',
    textHint: 'You type, the assistant answers in writing',
    assistant: 'Assistant',
    you: 'You',
    connecting: 'Connecting …',
    microphoneOnHint: 'The microphone is on',
    microphoneOn: 'Microphone on',
    message: 'Message to the assistant',
    speakOrType: 'Speak, or type here …',
    yourAnswer: 'Your answer …',
    send: 'Send',
  },
});
const END_REASONS = t.endReasons;

/**
 * A test call: a conversation with the assistant from the browser, typed or spoken. It goes
 * through the same session, announcements and tools as a phone call, so what happens here is
 * what a caller would experience. Everything it creates is marked as a test.
 */
export function TestCallDialog(props: { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('choose');
  const [mode, setMode] = useState<Mode>('text');
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string>();

  const socket = useRef<WebSocket | undefined>(undefined);
  const stopMicrophone = useRef<(() => void) | undefined>(undefined);
  const speaker = useRef<Speaker | undefined>(undefined);
  const log = useRef<HTMLOListElement>(null);

  const release = useCallback(() => {
    stopMicrophone.current?.();
    stopMicrophone.current = undefined;
    speaker.current?.close();
    speaker.current = undefined;
    socket.current?.close();
    socket.current = undefined;
  }, []);
  // Leaving the dialog hangs up.
  useEffect(() => release, [release]);

  // Keep the newest line in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls whenever a line is added
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  const refreshDailyView = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.allCalls }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allInquiries }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allSlots }),
    ]);

  const start = async (chosen: Mode) => {
    setMode(chosen);
    setLines([]);
    setNotice(undefined);
    setPhase('connecting');
    try {
      const { url, ticket } = await data(api.admin['test-sessions'].$post());
      // Deployed, the address is relative (the app's own); locally it points at the dev server.
      const address = new URL(url, window.location.href);
      if (address.protocol === 'https:' || address.protocol === 'http:') {
        address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
      }
      address.searchParams.set('ticket', ticket);
      address.searchParams.set('mode', chosen);
      const connection = new WebSocket(address);
      connection.binaryType = 'arraybuffer';
      socket.current = connection;

      if (chosen === 'voice') {
        speaker.current = new Speaker();
        stopMicrophone.current = await startMicrophone((pcm) => {
          if (connection.readyState === WebSocket.OPEN) {
            connection.send(pcm);
          }
        });
      }

      connection.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          speaker.current?.play(event.data);
          return;
        }
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'started':
            setPhase('talking');
            break;
          case 'transcript':
            setLines((current) => [...current, { role: message.role, text: message.text }]);
            break;
          case 'clear':
            speaker.current?.clear();
            break;
          case 'ended':
            setNotice(END_REASONS[message.reason] ?? END_REASONS.completed);
            break;
        }
      };
      connection.onclose = () => {
        stopMicrophone.current?.();
        stopMicrophone.current = undefined;
        setPhase((current) => (current === 'choose' ? current : 'ended'));
        setNotice((current) => current ?? t.disconnected);
        void refreshDailyView();
      };
    } catch (error) {
      release();
      setPhase('ended');
      setNotice(error instanceof DOMException ? t.noMicrophone : errorMessage(error));
    }
  };

  const send = () => {
    const text = draft.trim();
    if (text && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'text', text }));
      setDraft('');
    }
  };

  const hangUp = () => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'hangup' }));
    }
  };

  return (
    <Modal
      title={t.title}
      onClose={props.onClose}
      // The dialog body is a form: Enter in the text field sends the line.
      onSubmit={send}
      footer={
        <>
          {phase === 'talking' && (
            <button type="button" className="btn btn--danger" onClick={hangUp}>
              <PhoneOff />
              {t.hangUp}
            </button>
          )}
          {phase === 'ended' && (
            <button type="button" className="btn" onClick={() => setPhase('choose')}>
              {t.again}
            </button>
          )}
          <button type="button" className="btn" onClick={props.onClose}>
            {t.close}
          </button>
        </>
      }
    >
      {phase === 'choose' ? (
        <div className="testcall__choose">
          <p className="dialog__description">{t.intro}</p>
          <div className="testcall__modes">
            <button type="button" className="testcall__mode" onClick={() => void start('voice')}>
              <Mic />
              <strong>{t.voice}</strong>
              <span>{t.voiceHint}</span>
            </button>
            <button type="button" className="testcall__mode" onClick={() => void start('text')}>
              <Keyboard />
              <strong>{t.text}</strong>
              <span>{t.textHint}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="testcall">
          <ol className="transcript testcall__log" ref={log} aria-live="polite">
            {lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended
              <li key={index} className="transcript__turn" data-role={line.role}>
                <span className="transcript__meta">
                  {line.role === 'assistant' ? t.assistant : t.you}
                </span>
                <span className="transcript__text">{line.text}</span>
              </li>
            ))}
            {phase === 'connecting' && <li className="transcript__note">{t.connecting}</li>}
            {notice && <li className="transcript__note">{notice}</li>}
          </ol>
          {phase === 'talking' && (
            <div className="testcall__input">
              {mode === 'voice' && (
                <span className="pill pill--danger" title={t.microphoneOnHint}>
                  <Mic size={12} /> {t.microphoneOn}
                </span>
              )}
              <input
                className="input"
                aria-label={t.message}
                placeholder={mode === 'voice' ? t.speakOrType : t.yourAnswer}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                // biome-ignore lint/a11y/noAutofocus: typing is what this dialog is for
                autoFocus
              />
              <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
                {t.send}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
