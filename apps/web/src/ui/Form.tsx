import { type ReactNode, useId } from 'react';
import type { z } from 'zod';

/** Validation messages by field path, e.g. `{ 'title': '…', 'retention.transcriptDays': '…' }`. */
export type FieldErrors = Record<string, string>;

/** Collects the first message per field from a failed Zod parse. */
export function fieldErrorsOf(error: z.core.$ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= issue.message;
  }
  return errors;
}

/** One row of a property sheet: the label on the left, the control on the right. */
export function FormRow(props: {
  label: string;
  hint?: string;
  error?: string | undefined;
  /** Receives the id to put on the control so that the label points at it. */
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <>
      <label className="form__label" htmlFor={id}>
        {props.label}
      </label>
      <div className="form__control">
        {props.children(id)}
        {props.error ? (
          <span className="form__error" role="alert">
            {props.error}
          </span>
        ) : (
          props.hint && <span className="form__hint">{props.hint}</span>
        )}
      </div>
    </>
  );
}

export function FormSection(props: { children: ReactNode }) {
  return <div className="form__section">{props.children}</div>;
}

export function Checkbox(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}
