import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const result = await resend.emails.send({
  from: 'Agenova <noreply@agenova.chat>',
  to: ['hkiaowzf@gmail.com'],
  subject: 'test',
  text: 'Hello from Agenova',
});

console.log(result);
