#!/usr/bin/env node

const http = require('http');
const fs = require('fs').promises;
const url = require('url');

let { argv: { path , workspace } } = require('yargs/yargs')(process.argv.slice(2));

if (! path) {
  console.error(`REQUIRED ARG MISSING: --path=<path-to-backup-directory>`);
  process.exit(1);
}

workspace = workspace || 'SLACK BACKUP';

const mime = require('mime');
const { toHTML } = require('slack-markdown');

const host = 'localhost';
const port = 8889;

const getHtmlTemplate = (active, listings, messages) => {
  return `
    <!doctype html><html lang="en">
      <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
          <link rel="stylesheet" href="/stylesheet.css">
          <title>Slack Viewer</title>
      </head>
      <body>
      <header class="header">
          <div class="team-menu"><a href="/">${workspace}</a></div>
          <div class="channel-menu">
              <span class="channel-menu_name">
                  <span class="channel-menu_prefix">#</span> ${active}
              </span>
          </div>
      </header>
      <main class="main">
        <div class="listings">
          <div class="listings_channels">
            <h2 class="listings_header">Channels</h2>
            <ul class="channel_list">
              ${listings}
            </ul>
          </div>
        </div>
        <div class="message-history">
          ${messages}
        </div>
      </main>
      </body>
    </html>
  `;
};

/**
 * Is the file an image?
 * @param  {String} file the file being requested
 * @return {Boolean}
 */
const isFileAnImage = (file) => {
  const ext = file.split('.').pop();
  const photos = ['jpg', 'jpeg', 'png', 'gif', 'heic'];

  return photos.includes(ext);
};

/**
 * Get a static file from the public directory
 *
 * @param  {Object} req
 * @param  {Object} res
 * @return {void}
 */
const getPublicFile = async (req, res) => {
  const { url } = req;
  const [, file] = url.split('/public/');

  let contents = ``;

  try {
    contents = await fs.readFile(`${path}/${file}`);
    res.writeHead(200, { 'Content-Type': mime.getType(`${path}/${file}`), 'Cache-Control': 'no-cache' });
  } catch {
    contents = Buffer.from(`iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII`, 'base64');
    res.writeHead(404, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  }

  res.write(contents);
  res.end();
  return;
};

/**
 * Get the spreadsheet/css file
 * @param  {Object} req
 * @param  {Object} res
 * @return {void}
 */
const getStylesheetFile = async (req, res) => {
  const stylesheet = await fs.readFile(`${__dirname}/stylesheet.css`);
  res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' });
  res.write(stylesheet);
  res.end();
};

/**
 * Get the app's main interface
 *
 * @param  {Object} req
 * @param  {Object} res
 * @return {void}
 */
const getUserInterface = async (req, res) => {
  const emojis = JSON.parse(await fs.readFile(`${__dirname}/emoji.json`));
  const channels = JSON.parse(await fs.readFile(`${path}/channels.json`));
  const users = JSON.parse(await fs.readFile(`${path}/users.json`));

  // Lookup User
  const getUserById = (userId) => (users.find((u) => u.id === userId) || { name: 'none' });

  const getUserNameById = (userId) => {
    const { name } = getUserById(userId);
    return name;
  };

  // Process the raw text, turn Slack's Markdown into un-escaped HTML
  const processRawText = (raw) => {
    let text = toHTML(raw, { escapeHTML: false });

    const userMapping = Object.fromEntries(users.map((u) => [`@${u.id}`, u.name]));
    for (const user in userMapping) {
      text = text.replaceAll(user, `<span class="fw-bold">@${userMapping[user]}</span>`);
    }

    return text;
  };

  // Turn Slack's emoji into an actual emoji
  const getEmoji = (code) => {
    const { char } = emojis.find((e) => e.name === code) || { char: code };
    if (char.indexOf('::') > -1) {
      const [ogEmoji, ogEmojiModifier] = char.split('::');
      return `${getEmoji(ogEmoji)}${getEmoji(ogEmojiModifier)}`;
    }
    return char;
  };

  // is there a ?channel=<channel>
  let { query: { channel: active } } = url.parse(req.url, true);
  // default to #general channel if no channel
  if (channels.find(c => c.name === active) === undefined || ! active) {
    active = 'general';
  }

  // Load the channel history
  const history = JSON.parse(await fs.readFile(`${path}/${active}/all.json`));//.slice(0, 5000);

  // Generate the html for the channel list
  let listings = ``;
  for (const channel of channels) {
    if (channel.is_archived === false || channel.is_private === true) {
      listings += `<li class="${channel.name === active ? 'active' : ''}"><a href="?channel=${channel.name}">${channel.name}</a></li>`;
    } else {
      listings += `<li class="${channel.name === active ? 'active' : ''} inactive"><a href="?channel=${channel.name}">${channel.name}</a></li>`;
    }
  }

  // Set the template that makes up a single slack message
  const generateMessageHtml = (author, content, media, feedback) => {
    return `
      <div class="message">
        <span class="message_username">${author}</span>
        ${(content ? `<div class="message_content">${content}</div>` : '')}
        ${(media ? `${media}` : '')}
        ${(feedback ? `${feedback}` : '')}
      </div>
    `;
  };

  // temp placeholder for each message's html
  let messages = ``;

  /**
   * Loop through each message, do yo magic
   */
  for (const row of history) {
    const {
      blocks, reactions, text: raw, user: userId, files, ts, client_msg_id, attachments
    } = row;

    const og = getUserNameById(userId);
    const text = processRawText(raw);

    /**
     * files
     */
    let media = ``;

    // If files, write HTML
    if (files) {
      const subfolder = client_msg_id || ts;
      for (const file of (files || [])) {
        const { url_private_file } = file;
        if (url_private_file) {
          const filename = url_private_file.replace(`${active}/`, '');
          if (isFileAnImage(filename)) {
            media += `<div class="message-image"><a href="/public/${active}/${subfolder}/${filename}" target="_blank"><img src="/public/${active}/${subfolder}/${filename}" alt="${filename}"></a></div>`;
          } else {
            media += `<div class="message-file"><a href="/public/${active}/${subfolder}/${filename}" target="_blank">${filename}</a></div>`;
          }
        }
      }
    }

    /**
     * reactions
     */
    let feedback = ``;

    // If reactions, write HTML
    if (reactions) {
      for (const reaction of (reactions || [])) {
        const { name: emoji, users: reactionersIds, count } = reaction;

        feedback += `<div class="message-reaction"><span class="message-reaction-emoji">${getEmoji(emoji)}</span><ul class="message-reaction-list">`;
        const reactioner = (reactionersIds || []).map((reactionerId) => `<li>${getUserNameById(reactionerId)}</li>`);

        feedback += `${reactioner.join('')}</ul></div>`;
      }

      feedback = `<div class="message-reactions">${feedback}</div>`;
    }

    // Generate message HTML, add it to the stack of generated messages
    messages += generateMessageHtml(og, text, media, feedback);

    // TO DO...
    if (attachments) {
      // console.log(attachments);
    }
  }

  /**
   * Generate the entire HTML document, sprinkle in the generated HTML
   */
  const html = getHtmlTemplate(active, listings, messages);

  res.setHeader('Content-Type', 'text/html');
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
  res.end(html);
};

// Listen...
const requestListener = async function (req, res) {

  // Serve any public media that was attached (uploaded, not linked) verbatim
  if (req.url.startsWith('/public/')) {
    return getPublicFile(req, res);
  }

  // extract the requested path (/, /stylesheet.css, /wtf.js)
  const { pathname } = url.parse(req.url, true);

  switch (pathname) {
    // no favicon, cus why
    case '/favicon.ico':
      res.end();
      break;

    // Load CSS similar to Slack's
    case '/stylesheet.css':
      getStylesheetFile(req, res);
      break;

    // Load the UI
    case '/':
      getUserInterface(req, res);
      break;

    // Generate the user interface for the user
    default:
      res.writeHead(404, {"Content-Type": "text/plain"});
      res.write("404 Not found");
      res.end();
  }
};

const server = http.createServer(requestListener);

server.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});
