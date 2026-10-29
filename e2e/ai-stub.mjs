// Stand-ins for outside services in e2e tests, so no test goes online. Listens on 127.0.0.1:3102.
// - the Anthropic API: answers category requests from a word table (never Claude)
// - the ECB: dollars and rupees per euro for the working days of the last 400 days, a smooth
//   made-up path ending at 1.12 $ and 100.80 ₹ per euro
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

function ecbRates() {
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const days = [];
  for (let n = 400; n >= 0; n--) {
    const d = new Date(today - n * 86_400_000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  // counted back from the latest working day, which has the round rates
  const rows = days.flatMap((day, i) => {
    const k = days.length - 1 - i;
    return [
      `x,D,USD,${day},${(1.12 - k * 0.0001).toFixed(4)}`,
      `x,D,INR,${day},${(100.8 - k * 0.02).toFixed(4)}`,
    ];
  });
  return ['KEY,FREQ,CURRENCY,TIME_PERIOD,OBS_VALUE', ...rows].join('\n');
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.end('ok');
    if (req.method === 'GET' && req.url?.startsWith('/ecb/')) {
      res.setHeader('Content-Type', 'text/csv');
      return res.end(ecbRates());
    }
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
