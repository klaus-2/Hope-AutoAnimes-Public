require('moment-duration-format');

const { duration } = require('moment'),
  config = require("./config"),
  schedule = require('require-text')(`./assets/graphql/Schedule.graphql`, require),
  { logger, anilist, constants } = require('./utils'),
  { var: { createMessage, findOrCreate } } = require("./helpers");

module.exports = class AnimeManager {
  constructor(bot) {

    // The client that instantiated this Manager
    Object.defineProperty(this, 'bot', { value: bot })

    // Whether the manager is enabled
    this.enabled = true;

    // the queuedNotifications for the current running instance of {@link} AnimeManager#makeAnnouncement
    this.queuedNotifications = [];

    this.info = {
      // Media Formats for the fetched data
      mediaFormat: constants.mediaFormat,
      months: constants.months,
      defaultgenres: constants.mediaGenres,
      langflags: constants.langflags
    };
  };

  // Fetch data on the Anilist API using the query and variable
  fetch(query, variables) {
    return anilist.fetchX(query, variables);
  };

  // Fetch all media id from the guild watchlists
  getAllWatched() {
    return new Promise(async resolve => {
      const list = await findOrCreate('AutoAnime');
      return resolve([...new Set(list.flatMap(guild => guild.animes))]);
    });
  };

  // Embedify a media object
  getAnnouncementEmbed(entry, date) {

    logger.log(entry)

    const sites = [
      'Amazon', 'Animelab', 'AnimeLab',
      'Crunchyroll', 'Funimation',
      'Hidive', 'Hulu', 'Netflix', 'Viz'
    ];

    const watch = entry.media.externalLinks?.filter(x => sites.includes(x.site)).map(x => {
      return `[${x.site}](${x.url})`;
    }).join(' • ') || [];

    const visit = entry.media.externalLinks?.filter(x => !sites.includes(x.site)).map(x => {
      return `[${x.site}](${x.url})`;
    }).join(' • ') || [];

    logger.log(watch)
    logger.log(entry.episode)

    const hexToDecimal = hex => parseInt(hex, 16);
    const color = entry.media.coverImage.color;
    const embedColor = hexToDecimal(color.slice(1)) || '10197915';

    var SendEmbed = {
      "author": {
        "name": "Hope Auto-Animes"
      },
      "timestamp": date,
      "description": [
        `Episode **${entry.episode}** of **[${entry.media.title.romaji}](${entry.media.siteUrl})**`,
        `${entry.media.episodes === entry.episode ? ' **(Final Episode)** ' : ' '}`,
        `has just aired.${watch ? `\n\nWatch: ${watch}` : ''}${visit ? `\n\nVisit: ${visit}` : ''}`,
        `\n\nIt may take some time to appear on the above service(s).`
      ].join(''),
      "color": embedColor,
      "footer": {
        "text": [
          `${entry.media.format ? `Format: ${constants.mediaFormat[entry.media.format] || 'Unknown'}` : ''}`,
          `${entry.media.duration ? `Duration: ${duration(entry.media.duration * 60, 'seconds').format('H [hr] m [minute]')}  ` : ''}`,
          `${!!entry.media.studios.edges.length ? `Studio: ${entry.media.studios.edges[0].node.name}` : ''}`
        ].filter(Boolean).join('  •  ')
      },
      "thumbnail": {
        "url": `${entry.media.coverImage.large}`
      }
    }

    let datamsg = {
      "content": null,
      "tts": false,
      "embeds": [SendEmbed]
    };

    // logger.log(datamsg);

    return datamsg;
  };

  // Get the Date instance of the next (number of) day(s)
  getFromNextDays(days = 1) {
    return new Date(new Date().getTime() + (864e5 * days));
  };

  // Handle the manager
  async handleSchedules(nextDay, page) {
    const watched = await this.getAllWatched().catch(() => null);

    if (!watched || !watched.length) {  //Retry in 1 minute if database fetching fails due to some error.
      if (watched === null) setTimeout(() => this.handleSchedules(nextDay, page), 6e4);
      return logger.log(`\x1b[35m[SHARD_1] \x1b[33m[HOPE_AUTO_ANIME]\x1b[0m: Missing Data from Database.\nNo lists were found on the database. Please ignore this message if this is the first time setting the bot.`);
    };

    const res = await this.fetch(schedule, { page, watched, nextDay });

    if (res.errors) {
      // If error occurs, AnimeManager will fail to display the anime, so we will refetch if the error is
      // caused by a ratelimiting error, which is on code 429. If it is, we will retry it.
      if (res.errors.some(error => error.status === 429)) setTimeout(() => this.handleSchedules(nextDay, page), 18e5);
      return logger.log(`\x1b[31m[HOPE_AUTO_ANIME]\x1b[0m: FetchError\n${res.errors.map(err => err.message).join('\n')}`);
    };

    for (const entry of res.data.Page.airingSchedules.filter(e => !this.queuedNotifications.includes(e.id))) {
      const date = new Date(entry.airingAt * 1e3);
      const entry_t = Object.values(entry.media.title).filter(Boolean)[0];
      const tbefair = duration(entry.timeUntilAiring, 'seconds').format('H [hours and] m [minutes]');

      logger.log(`\x1b[35m \x1b[32m[HOPE_AUTO_ANIME]\x1b[0m: Episode \x1b[36m${entry.episode}\x1b[0m of \x1b[36m${entry_t}\x1b[0m airs in \x1b[36m${tbefair}\x1b[0m.`);
      setTimeout(() => this.makeAnnouncement(entry, date), entry.timeUntilAiring * 1e3);

      this.queuedNotifications.push(entry.id);
    };

    if (res.data.Page.pageInfo.hasNextPage) {
      this.handleSchedules(nextDay, res.data.Page.pageInfo.currentPage + 1);
    };
  };

  // Initialize the Manager
  async init() {
    setInterval(async () => {
      return this.handleSchedules(Math.round(this.getFromNextDays().getTime() / 1000))
    }, 5 * 60000);
  };

  // Send the announcement to a valid text channel
  async makeAnnouncement(entry, date) {

    this.queuedNotifications = this.queuedNotifications.filter(e => e !== entry.id);
    const embed = this.getAnnouncementEmbed(entry, date);

    const list = await findOrCreate('AutoAnime');

    if (!list) {
      logger.log(`AUTO-ANIMES: Missing Data from Database.\nNo lists were found on the database. Please ignore this message if this is the first time setting the bot.`)
      return;
    };

    for (const g of list) {
      if (!g?.animes?.includes(entry.media.id)) {
        continue;
      };

      /* const channel = this.bot.channels.cache.get(g.channelID);

      if (!channel || !channel.permissionsFor(channel.guild.me).has([Flags.SendMessages, Flags.EmbedLinks])) {
          logger.log(`Announcement for ${entry.media.title.romaji || entry.media.title.userPreferred
              } has \x1b[31mfailed\x1b[0m in ${channel?.guild?.name || g.channelID
              } because ${channel?.guild ? `of \x1b[31mmissing\x1b[0m 'SEND_MESSAGES' and/or, Flags.EmbedLinks permissions.`
                  : `such channel \x1b[31mdoes not exist\x1b[0m.`
              }`);
          continue;
      }; */

      if (config.debug) logger.log(`[NEW-POST]: Anime posted.`);

      if (g.roleNotify) {
        let datamsg = {
          "content": `<@&${g.roleNotify}>`,
          "tts": false,
          "embeds": null,
        };

        await createMessage(g.channelID, config.token, datamsg);
      }

      await createMessage(g.channelID, config.token, embed).then((msg) => {
        logger.log(`Announcing episode \x1b[36m${entry.media.title.romaji || entry.media.title.userPreferred
          }\x1b[0m to guildID: \x1b[36m${g._id
          }\x1b[0m channelID: \x1b[36m${g.channelID
          }\x1b[0m`);
      }).catch(err => {
        logger.log(`Announcement for \x1b[36m${entry.media.title.romaji || entry.media.title.userPreferred
          }\x1b[0m : \x1b[31mFailed:\x1b[0m${err}`);
      });
    };

    return;
  };
};
