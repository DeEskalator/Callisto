import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import type { z } from 'zod';
import { errorMessage } from '../app/api';
import { type FieldErrors, fieldErrorsOf } from './Form';
import { Modal } from './Modal';

interface Parser<Parsed> {
  safeParse(
    input: unknown,
  ): { success: true; data: Parsed } | { success: false; error: z.core.$ZodError };
}

/**
 * State of a dialog that edits one thing: the draft, its validation and saving. The draft is
 * checked with the same schema the API uses, so most mistakes are caught before a request is made.
 */
export function useFormDialog<Draft, Parsed, Result>(options: {
  initial: Draft;
  schema: Parser<Parsed>;
  save: (input: Parsed) => Promise<Result>;
  onSaved: (result: Result) => void;
}) {
  const [draft, setDraft] = useState(options.initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({ mutationFn: options.save, onSuccess: options.onSaved });

  return {
    draft,
    errors,
    set: (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes })),
    submit: () => {
      const parsed = options.schema.safeParse(draft);
      if (!parsed.success) {
        setErrors(fieldErrorsOf(parsed.error));
        return;
      }
      setErrors({});
      mutation.mutate(parsed.data);
    },
    saving: mutation.isPending,
    error: mutation.isError ? errorMessage(mutation.error) : undefined,
  };
}

/** A modal form with the standard buttons: Cancel, and Save as the default action. */
export function FormDialog(props: {
  title: string;
  size?: 'narrow' | 'wide';
  form: { submit: () => void; saving: boolean; error: string | undefined };
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      onSubmit={props.form.submit}
      error={props.form.error}
      {...(props.size ? { size: props.size } : {})}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={props.form.saving}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">{props.children}</div>
    </Modal>
  );
}
