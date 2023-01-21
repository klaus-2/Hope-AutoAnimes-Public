const { logger } = require('./utils'),
    AnimeManager = require(`./AnimeManager`);

// connect to database
require('./database/mongoose').init();

logger.ready('[AUTO-ANIME]: Worker inicializado.');

this.animemanager = new AnimeManager(this);
this.animemanager.init();

// Error Handler
process.on('unhandledRejection', error => logger.error(error));
process.on('uncaughtException', error => logger.error(error));