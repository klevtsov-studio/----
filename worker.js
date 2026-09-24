/**
 * Приём заявок с сайта «Инженерная студия Дмитрия Клевцова» → Telegram.
 *
 * ВАЖНО: блок CONFIG ниже — это рабочий код, а не комментарий.
 * Впишите токен и chat id прямо в кавычки — этого достаточно, чтобы всё заработало.
 * Либо оставьте пустыми и задайте переменные в Cloudflare
 * (Settings → Variables and Secrets → BOT_TOKEN, CHAT_ID, ALLOWED_ORIGIN):
 * переменные, если заданы, имеют приоритет над CONFIG.
 * После любого изменения нажмите Deploy.
 */

const CONFIG = {
  botToken: '',      // токен от @BotFather, например '1234567890:AAH...'
  chatId:   '',      // число из @userinfobot, например '123456789'
  origin:   '*'      // адрес сайта, например 'https://klevtsov-engineering.ru'; '*' — разрешить всем
};

const MAX_FILE = 10 * 1024 * 1024;   // 10 МБ на файл
const MAX_FILES = 5;

export default {
  async fetch(request, env) {
    const TOKEN  = (env.BOT_TOKEN || CONFIG.botToken || '').trim();
    const CHAT   = (env.CHAT_ID   || CONFIG.chatId   || '').trim();
    const origin = (env.ALLOWED_ORIGIN || CONFIG.origin || '*').trim();

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    /* Открыли адрес воркера в браузере — показываем состояние настройки.
       Сам токен не раскрывается: видно только «задан / не задан». */
    if (request.method === 'GET') {
      let bot = 'не проверялся';
      if (TOKEN) {
        const me = await tg(TOKEN, 'getMe', null);
        bot = me.ok ? '@' + me.result.username : 'токен неверный (' + (me.description || '') + ')';
      }
      const ready = TOKEN && CHAT && bot.startsWith('@');
      return new Response(
        'ПРИЁМ ЗАЯВОК — состояние\n\n' +
        'BOT_TOKEN: ' + (TOKEN ? 'задан' : 'НЕ ЗАДАН') + '\n' +
        'CHAT_ID:   ' + (CHAT ? 'задан' : 'НЕ ЗАДАН') + '\n' +
        'Бот:       ' + bot + '\n' +
        'Origin:    ' + origin + '\n\n' +
        (ready ? 'Всё настроено — форма может отправлять заявки.'
               : 'Задайте недостающее в Settings → Variables and Secrets\n' +
                 'или впишите в блок CONFIG в начале кода, затем нажмите Deploy.'),
        { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    try {
      if (!TOKEN) throw new Error('на сервере не задан BOT_TOKEN');
      if (!CHAT)  throw new Error('на сервере не задан CHAT_ID');

      const form = await request.formData();

      // ловушка для спам-ботов: поле скрыто от людей
      if ((form.get('website') || '').toString().trim()) return json({ ok: true }, cors);

      // без согласия заявку не принимаем — требование 152-ФЗ
      if ((form.get('consent') || '').toString().trim() === '') {
        return json({ ok: false, error: 'Нет согласия на обработку персональных данных' }, cors, 400);
      }

      const name    = clean(form.get('name'),    120);
      const company = clean(form.get('company'), 120);
      const contact = clean(form.get('contact'), 160);
      const task    = clean(form.get('task'),   3500);

      if (!name || !contact || !task) {
        return json({ ok: false, error: 'Не заполнены обязательные поля' }, cors, 400);
      }

      const files = form.getAll('files[]')
        .filter(f => f && typeof f === 'object' && f.size)
        .slice(0, MAX_FILES);

      const text = [
        '<b>Заявка с сайта</b>',
        '',
        `<b>Имя:</b> ${esc(name)}`,
        company ? `<b>Компания:</b> ${esc(company)}` : '',
        `<b>Контакт:</b> ${esc(contact)}`,
        '',
        '<b>Задача:</b>',
        esc(task),
        files.length ? `\n<b>Файлов приложено:</b> ${files.length}` : '',
        '\n<i>Согласие на обработку данных получено</i>',
        `\n<i>${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</i>`
      ].filter(Boolean).join('\n');

      const sent = await tg(TOKEN, 'sendMessage', {
        chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true
      });
      if (!sent.ok) throw new Error(explain(sent));

      for (const file of files) {
        if (file.size > MAX_FILE) {
          await tg(TOKEN, 'sendMessage', {
            chat_id: CHAT,
            text: `⚠️ Файл «${esc(file.name)}» не отправлен: больше 10 МБ.`,
            parse_mode: 'HTML'
          });
          continue;
        }
        const fd = new FormData();
        fd.append('chat_id', CHAT);
        fd.append('caption', `Файл к заявке: ${name}`);
        fd.append('document', file, file.name);
        await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: 'POST', body: fd });
      }

      return json({ ok: true }, cors);

    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, cors, 500);
    }
  }
};

/* человеческое объяснение вместо формулировок Telegram */
function explain(res) {
  const d = (res.description || '').toLowerCase();
  if (d.includes('not found') && !d.includes('chat')) return 'неверный токен бота — возьмите новый у @BotFather';
  if (d.includes('chat not found'))  return 'неверный CHAT_ID либо не нажат /start у своего бота';
  if (d.includes('blocked'))         return 'бот заблокирован в вашем Telegram — разблокируйте его';
  if (d.includes('parse'))           return 'Telegram не принял разметку сообщения';
  return res.description || 'Telegram отклонил запрос';
}

const clean = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const json = (data, cors, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function tg(token, method, payload) {
  const opts = payload
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    : { method: 'GET' };
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, opts);
  return res.json();
}
