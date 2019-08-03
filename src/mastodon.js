/*
 * Description:
 *   Adapter for Hubot to communicate on any mastodon instance
 *
 * Commands:
 *   None
 *
 * Configuration:
 *   HUBOT_MASTODON_BASE_URL    - base url
 *   HUBOT_MASTODON_ACCESSTOKEN - access token
 *   HUBOT_MASTODON_TIMELINE    - streaming timeline type (home|local|public)
 *   HUBOT_MASTODON_VISIBILITY  - default toot visibility (direct|private|unlisted|public)
 *
 * Notes:
 *    if 'HUBOT_MASTODON_BASE_URL' is unset, fallback to 'https://mastodon.social'.
 *    if 'HUBOT_MASTODON_TIMELINE' is unset, fallback to 'local'.
 *    if 'HUBOT_MASTODON_VISIBILITY' is unset, fallback to 'unlisted'.
 *
 */

// @ts-check

let Adapter;
let TextMessage;
/** @type {typeof import('striptags')} */
let striptags;
/** @type {typeof import('megalodon').default} */
let Megalodon;
try {
  // eslint-disable-next-line
  const hubot = require('hubot');
  // @ts-ignore
  Adapter = hubot.Adapter;
  // @ts-ignore
  TextMessage = hubot.TextMessage;
} catch (e) {
  const prequire = require('parent-require');
  const hubot = prequire('hubot');
  Adapter = hubot.Adapter;
  TextMessage = hubot.TextMessage;
}
try {
  striptags = require('striptags');
} catch (e) {
  const prequire = require('parent-require');
  striptags = prequire('striptags');
}

try {
  Megalodon = require('megalodon').default;
} catch (e) {
  const prequire = require('parent-require');
  Megalodon = prequire('megalodon').default;
}

const timelineEndpoint = {
  home: '/api/v1/streaming/user',
  local: '/api/v1/streaming/public/local',
  public: '/api/v1/streaming/public',
};


class MastodonAdapter extends Adapter {
  constructor(/** @type Hubot.Robot */ robot) {
    super(robot);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  async send(envelope, /** @type {string[]} */...messages) {
    /** @type {string[]} */
    const msgs = messages.reduce((acc, val) => acc.concat(val), []);

    for (const msg of msgs) {
      this.robot.logger.info(`onSend: ${msg}`);
      await this.mastodon.post('/api/v1/statuses', {
        status: msg,
        visibility: this.visibility,
      });
    }
  }


  async reply(envelope, /** @type {string[]} */...messages) {
    /** @type {string[]} */
    const msgs = messages.reduce((acc, val) => acc.concat(val), []);

    for (const msg of msgs) {
      this.robot.logger.info(`onReply: @${envelope.message.screen_name} ${msg}`);
      await this.mastodon.post('/api/v1/statuses', {
        status: `@${envelope.message.screen_name} ${msg}`,
        visibility: this.visibility,
        in_reply_to_id: envelope.id,
      });
    }
  }

  chat(/** @type {import('megalodon/lib/entities/status').Status} */ status) {
    const { id, content, account } = status;

    const message = striptags(content.replace(/<br( \/)?>/g, '\n')).trim();
    const isMention = message.includes(this.robot.name);
    this.robot.logger.info(`onChat: @${account.acct} '${message}'`);

    const messageBody = message.replace(/^(@[^\s]+\s)+/, '');

    const textMessage = new TextMessage({
      ...account,
      room: 'mastodon',
    }, messageBody, id);
    textMessage.display_name = account.display_name;
    textMessage.screen_name = account.acct;
    textMessage.raw = status;
    textMessage.room = 'mastodon';
    textMessage.is_mention = isMention;

    this.receive(textMessage);
  }

  async run() {
    if (!process.env.HUBOT_MASTODON_ACCESSTOKEN) {
      throw new Error("Error: 'HUBOT_MASTODON_ACCESSTOKEN' is required");
    }

    this.baseUrl = process.env.HUBOT_MASTODON_BASE_URL || 'https://mastodon.social';
    this.accessToken = process.env.HUBOT_MASTODON_ACCESSTOKEN || '';
    this.timeline = process.env.HUBOT_MASTODON_TIMELINE || 'local';
    this.visibility = process.env.HUBOT_MASTODON_VISIBILITY || 'unlisted';

    this.mastodon = new Megalodon(this.accessToken, this.baseUrl);

    try {
      const me = await this.mastodon.get('/api/v1/accounts/verify_credentials');
      if (me && me.data && me.data.acct && me.data.acct !== '') {
        /** @type {import('megalodon/lib/entities/account').Account} */
        this.me = me.data;
        this.robot.name = `@${this.me.acct}`;
        this.robot.logger.info('robot name:', this.robot.name);
      } else {
        throw new Error();
      }
    } catch (e) {
      throw new Error('cannot get own information');
    }

    if (!timelineEndpoint[this.timeline]) {
      throw new Error(`invalid streaming type: ${this.timeline}`);
    }

    this.stream = this.mastodon.stream(timelineEndpoint[this.timeline]);
    this.stream.on('update', (/** @type {import('megalodon/lib/entities/status').Status} */ status) => {
      this.chat(status);
    });

    this.stream.on('error', (/** @type {Error} */ err) => {
      this.robot.logger.error(err);
    });

    this.emit('connected');
  }
}

exports.use = robot => new MastodonAdapter(robot);
