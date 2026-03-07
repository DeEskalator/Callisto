/** A SIP request or response (RFC 3261), as far as the assistant needs to understand one. */
export interface SipMessage {
  /** `INVITE`, `ACK`, `BYE` … for requests; undefined for responses. */
  method?: string;
  /** Request-URI of a request. */
  uri?: string;
  /** Status code of a response. */
  status?: number;
  reason?: string;
  /** Header values by lower-case name, in the order they appeared. */
  headers: Map<string, string[]>;
  body: string;
}

// Compact header names (RFC 3261, section 7.3.3).
const COMPACT: Record<string, string> = {
  v: 'via',
  f: 'from',
  t: 'to',
  i: 'call-id',
  m: 'contact',
  l: 'content-length',
  c: 'content-type',
  k: 'supported',
};

// Headers whose values may be combined with commas; the others contain commas themselves.
const LIST_HEADERS = new Set(['via', 'route', 'record-route']);

export function parseSipMessage(raw: string): SipMessage | undefined {
  const split = raw.indexOf('\r\n\r\n');
  const head = split >= 0 ? raw.slice(0, split) : raw;
  const body = split >= 0 ? raw.slice(split + 4) : '';
  // Folded header lines (a line starting with white space continues the previous one).
  const lines = head.replace(/\r\n[ \t]+/g, ' ').split('\r\n');
  const startLine = lines.shift();
  if (!startLine) {
    return undefined;
  }

  const message: SipMessage = { headers: new Map(), body: '' };
  const response = /^SIP\/2\.0 (\d{3}) ?(.*)$/.exec(startLine);
  const request = /^([A-Z]+) (\S+) SIP\/2\.0$/.exec(startLine);
  if (response) {
    message.status = Number(response[1]);
    message.reason = response[2] ?? '';
  } else if (request) {
    message.method = request[1] as string;
    message.uri = request[2] as string;
  } else {
    return undefined;
  }

  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const rawName = line.slice(0, colon).trim().toLowerCase();
    const name = COMPACT[rawName] ?? rawName;
    const value = line.slice(colon + 1).trim();
    const values = LIST_HEADERS.has(name) ? splitList(value) : [value];
    message.headers.set(name, [...(message.headers.get(name) ?? []), ...values]);
  }

  const length = Number(header(message, 'content-length') ?? body.length);
  message.body = Buffer.from(body).subarray(0, length).toString();
  return message;
}

/** Splits a comma-separated header value, leaving commas inside quotes and <…> alone. */
function splitList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === '<') {
      depth++;
    } else if (!quoted && char === '>') {
      depth--;
    } else if (!quoted && depth === 0 && char === ',') {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

/** The first value of a header. */
export function header(message: SipMessage, name: string): string | undefined {
  return message.headers.get(name.toLowerCase())?.[0];
}

/** The value of a `;name=value` parameter in a header such as From, To or Via. */
export function headerParameter(value: string | undefined, name: string): string | undefined {
  const match = new RegExp(`;\\s*${name}=([^;>\\s,]+)`, 'i').exec(value ?? '');
  return match?.[1];
}

/** The URI inside a name-addr such as `"Name" <sip:+4930123@host>;tag=1`. */
export function uriOf(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const bracketed = /<([^>]+)>/.exec(value);
  return (bracketed?.[1] ?? value.split(';')[0])?.trim();
}

/** The user part of a SIP URI: `sip:+4930123@host` → `+4930123`. */
export function userOf(uri: string | undefined): string | undefined {
  const match = /^sips?:([^@;]+)@/.exec(uri ?? '');
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Writes a message: start line, headers in the given order, body with its length. */
export function serializeSipMessage(
  startLine: string,
  headers: Array<[string, string]>,
  body = '',
): string {
  const lines = [startLine, ...headers.map(([name, value]) => `${name}: ${value}`)];
  lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  return `${lines.join('\r\n')}\r\n\r\n${body}`;
}

const REASONS: Record<number, string> = {
  100: 'Trying',
  200: 'OK',
  481: 'Call/Transaction Does Not Exist',
  486: 'Busy Here',
  487: 'Request Terminated',
  488: 'Not Acceptable Here',
  500: 'Server Internal Error',
  501: 'Not Implemented',
};

/**
 * A response to a request: Via, From, Call-ID and CSeq are copied (RFC 3261, section 8.2.6),
 * To gets this side's tag if the request had none.
 */
export function buildResponse(
  request: SipMessage,
  status: number,
  options: { toTag?: string; extraHeaders?: Array<[string, string]>; body?: string } = {},
): string {
  const to = header(request, 'to') ?? '';
  const toWithTag =
    options.toTag && !headerParameter(to, 'tag') ? `${to};tag=${options.toTag}` : to;
  const headers: Array<[string, string]> = [
    ...(request.headers.get('via') ?? []).map((via): [string, string] => ['Via', via]),
    ['From', header(request, 'from') ?? ''],
    ['To', toWithTag],
    ['Call-ID', header(request, 'call-id') ?? ''],
    ['CSeq', header(request, 'cseq') ?? ''],
    ...(request.headers.get('record-route') ?? []).map((route): [string, string] => [
      'Record-Route',
      route,
    ]),
    ['Server', 'Callisto'],
    ...(options.extraHeaders ?? []),
  ];
  return serializeSipMessage(
    `SIP/2.0 ${status} ${REASONS[status] ?? 'Unknown'}`,
    headers,
    options.body,
  );
}
