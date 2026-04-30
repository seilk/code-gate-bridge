const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9._-]+/g,
  /(api[_-]?key|auth[_-]?token|authorization)(["'\s:=]+)([^"'\s,}]+)/gi
];

export function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, (_m, a, b) => a ? `${a}${b}[REDACTED]` : '[REDACTED]');
  return text;
}

export function stripControls(text) {
  return String(text)
    .replace(/[\u001b\u009b][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}
