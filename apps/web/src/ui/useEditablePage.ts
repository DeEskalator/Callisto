import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { errorMessage } from '../app/api';
import { type FieldErrors, fieldErrorsOf } from './Form';
import { useNotify } from './Toast';

interface Parser<Parsed> {
  safeParse(
    input: unknown,
  ): { success: true; data: Parsed } | { success: false; error: z.core.$ZodError };
}

/**
 * State of a view that shows one thing in editable form and saves it as a whole, like a
 * settings page: the user changes fields, then saves or discards. Until something is changed the
 * view simply shows what the server has.
 */
export function useEditablePage<Value>(options: {
  /** The stored value. */
  server: Value;
  schema: Parser<Value>;
  save: (value: Value) => Promise<unknown>;
  savedMessage: string;
}) {
  const notify = useNotify();
  const [draft, setDraft] = useState<Value>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const value = draft ?? options.server;
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(options.server);

  const mutation = useMutation({
    mutationFn: options.save,
    onSuccess: () => {
      setDraft(undefined);
      notify({ kind: 'success', title: options.savedMessage });
    },
    onError: (error) =>
      notify({ kind: 'error', title: 'Nicht gespeichert', text: errorMessage(error) }),
  });

  return {
    value,
    errors,
    dirty,
    saving: mutation.isPending,
    set: (changes: Partial<Value>) => setDraft({ ...value, ...changes }),
    replace: (next: Value) => setDraft(next),
    discard: () => {
      setDraft(undefined);
      setErrors({});
    },
    save: () => {
      const parsed = options.schema.safeParse(value);
      if (!parsed.success) {
        setErrors(fieldErrorsOf(parsed.error));
        notify({ kind: 'error', title: 'Bitte prüfen Sie die markierten Angaben' });
        return;
      }
      setErrors({});
      mutation.mutate(parsed.data);
    },
  };
}
