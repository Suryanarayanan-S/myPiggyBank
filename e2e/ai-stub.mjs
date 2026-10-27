// A stand-in for the Anthropic API in e2e tests: answers category requests from a word table,
// so no test ever reaches Claude. Listens on 127.0.0.1:3102.
import http from 'node:http';

const TABLE = { Bäckerei: 'Groceries' };

const answer = (prompt) => {
  const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
  const keyOf = (name) => payload.categories.find((c) => c.name === name)?.key ?? null;
  return {
    answers: payload.lines.map((l) => {
      const hit = Object.entries(TABLE).find(([word]) => l.text.includes(word));
      return { line: l.line, category: hit ? keyOf(hit[1]) : null };
    }),
  };
};

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.end('ok');
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.statusCode = 404;
      return res.end();
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body);
      const text = JSON.stringify(answer(request.messages[0].content));
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_stub',
          type: 'message',
          role: 'assistant',
          model: request.model,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 900, output_tokens: 40 },
        }),
      );
    });
  })
  .listen(3102, '127.0.0.1');
