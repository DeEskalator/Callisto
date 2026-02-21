import { useQueryClient } from '@tanstack/react-query';
import { Keyboard, Mic, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { data, errorMessage, useApi } from '../../app/api';
import { queryKeys } from '../../app/queries';
import { Modal } from '../../ui/Modal';
import { Speaker, startMicrophone } from './audio';

type Mode = 'text' | 'voice';
type Phase = 'choose' | 'connecting' | 'talking' | 'ended';
interface Line {
  role: 'caller' | 'assistant';
  text: string;
}

const END_REASONS: Record<string, string> = {
  completed: 'Das Gespräch wurde beendet.',
  transferred: 'An dieser Stelle würde der Anrufer mit der Praxis verbunden.',
  emergency: 'Der Assistent hat einen Notfall erkannt und das Gespräch beendet.',
  failed: 'Das Gespräch wurde wegen einer Störung beendet.',
};

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
      const connection = new WebSocket(
        `${url}?ticket=${encodeURIComponent(ticket)}&mode=${chosen}`,
      );
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
        setNotice((current) => current ?? 'Die Verbindung wurde getrennt.');
        void refreshDailyView();
      };
    } catch (error) {
      release();
      setPhase('ended');
      setNotice(
        error instanceof DOMException
          ? 'Auf das Mikrofon kann nicht zugegriffen werden. Bitte erlauben Sie den Zugriff im Browser.'
          : errorMessage(error),
      );
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
      title="Testanruf"
      onClose={props.onClose}
      // The dialog body is a form: Enter in the text field sends the line.
      onSubmit={send}
      footer={
        <>
          {phase === 'talking' && (
            <button type="button" className="btn btn--danger" onClick={hangUp}>
              <PhoneOff />
              Auflegen
            </button>
          )}
          {phase === 'ended' && (
            <button type="button" className="btn" onClick={() => setPhase('choose')}>
              Neuer Testanruf
            </button>
          )}
          <button type="button" className="btn" onClick={props.onClose}>
            Schließen
          </button>
        </>
      }
    >
      {phase === 'choose' ? (
        <div className="testcall__choose">
          <p className="dialog__description">
            Sprechen oder schreiben Sie mit dem Assistenten, als würden Sie in der Praxis anrufen.
            Der Testanruf durchläuft dieselben Ansagen und Abläufe wie ein echter Anruf. Was dabei
            entsteht, wird als Test gekennzeichnet; gebuchte Termine belegen aber einen echten Slot,
            bis Sie sie unter „Anliegen“ wieder absagen.
          </p>
          <div className="testcall__modes">
            <button type="button" className="testcall__mode" onClick={() => void start('voice')}>
              <Mic />
              <strong>Mit Sprache</strong>
              <span>Über Mikrofon und Lautsprecher, wie am Telefon</span>
            </button>
            <button type="button" className="testcall__mode" onClick={() => void start('text')}>
              <Keyboard />
              <strong>Mit Text</strong>
              <span>Sie tippen, der Assistent antwortet schriftlich</span>
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
                  {line.role === 'assistant' ? 'Assistent' : 'Sie'}
                </span>
                <span className="transcript__text">{line.text}</span>
              </li>
            ))}
            {phase === 'connecting' && (
              <li className="transcript__note">Verbindung wird aufgebaut …</li>
            )}
            {notice && <li className="transcript__note">{notice}</li>}
          </ol>
          {phase === 'talking' && (
            <div className="testcall__input">
              {mode === 'voice' && (
                <span className="pill pill--danger" title="Das Mikrofon ist eingeschaltet">
                  <Mic size={12} /> Mikrofon an
                </span>
              )}
              <input
                className="input"
                aria-label="Nachricht an den Assistenten"
                placeholder={
                  mode === 'voice' ? 'Sprechen Sie, oder tippen Sie hier …' : 'Ihre Antwort …'
                }
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                // biome-ignore lint/a11y/noAutofocus: typing is what this dialog is for
                autoFocus
              />
              <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
                Senden
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
