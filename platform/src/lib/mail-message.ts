// mail-message.ts: monta a mensagem RFC 2822 (multipart/alternative, texto e HTML) que o Gmail API recebe em
// `raw`. Puro, sem I/O: o teste cobre cabeçalho, acento, quebra de linha e injeção de cabeçalho.

export type Sender = { name: string | null; email: string };

export type OutgoingMail = {
  from: Sender;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
};

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

// "Ekoai <no-reply@ekoai.com.br>" ou só "no-reply@ekoai.com.br". Qualquer outra forma é recusada.
export function parseSender(value: string | undefined): Sender | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  const email = (named ? named[2] : text).trim();
  if (!isEmailAddress(email)) return null;
  const name = named ? named[1].trim().replace(/^"(.*)"$/, '$1').trim() : '';
  if (/[\r\n"<>]/.test(name)) return null;
  return { name: name || null, email };
}

function noLineBreak(value: string, field: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`cabeçalho ${field} com quebra de linha`);
  return value;
}

// RFC 2047: texto fora do ASCII vai em base64 UTF-8. Cada palavra codificada tem até 75 caracteres, então
// o texto é partido em blocos de 45 bytes sem cortar um caractere ao meio.
function encodeWords(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = '';
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

export function formatSender(sender: Sender): string {
  if (!sender.name) return sender.email;
  const ascii = /^[\x20-\x7e]*$/.test(sender.name);
  const name = ascii ? `"${sender.name.replace(/(["\\])/g, '\\$1')}"` : encodeWords(sender.name);
  return `${name} <${sender.email}>`;
}

function base64Lines(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? ['']).join('\r\n');
}

export function buildMime(mail: OutgoingMail, boundary: string): string {
  if (!isEmailAddress(mail.to)) throw new Error('destinatário inválido');
  if (mail.replyTo && !isEmailAddress(mail.replyTo)) throw new Error('endereço de resposta inválido');
  if (!/^[A-Za-z0-9'()+_,./:=?-]{8,70}$/.test(boundary)) throw new Error('boundary inválido');

  const headers = [
    `From: ${formatSender(mail.from)}`,
    `To: ${mail.to}`,
    ...(mail.replyTo ? [`Reply-To: ${mail.replyTo}`] : []),
    `Subject: ${encodeWords(noLineBreak(mail.subject, 'Subject'))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    // Resposta automática de outros sistemas (férias, caixa cheia) não deve voltar para quem convida.
    'Auto-Submitted: auto-generated',
  ];

  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', base64Lines(body)].join('\r\n');

  return [...headers, '', part('text/plain', mail.text), part('text/html', mail.html), `--${boundary}--`, ''].join('\r\n');
}

export function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
