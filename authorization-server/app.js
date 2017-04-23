'use strict';

const bodyParser     = require('body-parser');
const client         = require('./client');
const cookieParser   = require('cookie-parser');
const config         = require('./config');
const db             = require('./db');
const express        = require('express');
const redis = require('redis');
const expressSession = require('express-session');
const RedisStore = require('connect-redis')(expressSession);
const fs             = require('fs');
const https          = require('https');
const oauth2         = require('./oauth2');
const passport       = require('passport');
const path           = require('path');
const site           = require('./site');
const token          = require('./token');
const user           = require('./user');

// console.log('Using MemoryStore for the data store');
// console.log('Using MemoryStore for the Session');
// const MemoryStore = expressSession.MemoryStore;

const redisClient = redis.createClient(config.port, config.host, { no_ready_check: true });
// const redisStore = new db.RedisStore({ redis: client });

// Express configuration
const app = express();
app.set('view engine', 'ejs');
app.use(cookieParser());

/*
// Make our redisStore accessible to our router.
app.use(function(req, res, next){
  req.redisStore = redisStore;
  next();
});
*/

// Session Configuration
/*
app.use(expressSession({
  saveUninitialized : true,
  resave            : true,
  secret            : config.session.secret,
  store             : new MemoryStore(),
  key               : 'authorization.sid',
  cookie            : { maxAge: config.session.maxAge },
}));
*/

app.use(expressSession({
  cookie: { path: '/',
  httpOnly: true, maxAge:60000 },
  store: new RedisStore({ client: redisClient }),
  secret: config.session.secret,
  key: 'authorization.sid'
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
require('./auth');

app.get('/',        site.index);
app.get('/login',   site.loginForm);
app.post('/login',  site.login);
app.get('/logout',  site.logout);
app.get('/account', site.account);

app.get('/dialog/authorize',           oauth2.authorization);
app.post('/dialog/authorize/decision', oauth2.decision);
app.post('/oauth/token',               oauth2.token);

app.get('/api/userinfo',   user.info);
app.get('/api/clientinfo', client.info);

// Mimicking google's token info endpoint from
// https://developers.google.com/accounts/docs/OAuth2UserAgent#validatetoken
app.get('/api/tokeninfo', token.info);

// Mimicking google's token revoke endpoint from
// https://developers.google.com/identity/protocols/OAuth2WebServer
app.get('/api/revoke', token.revoke);

// static resources for stylesheets, images, javascript files
app.use(express.static(path.join(__dirname, 'public')));

// Catch all for error messages.  Instead of a stack
// trace, this will log the json of the error message
// to the browser and pass along the status with it
app.use((err, req, res, next) => {
  if (err) {
    if (err.status == null) {
      console.error('Internal unexpected error from:', err.stack);
      res.status(500);
      res.json(err);
    } else {
      res.status(err.status);
      res.json(err);
    }
  } else {
    next();
  }
});

// From time to time we need to clean up any expired tokens
// in the database
setInterval(() => {
  db.accessTokens.removeExpired()
  .catch(err => console.error('Error trying to remove expired tokens:', err.stack));
}, config.db.timeToCheckExpiredTokens * 1000);

// TODO: Change these for your own certificates.  This was generated through the commands:
// openssl genrsa -out privatekey.pem 2048
// openssl req -new -key privatekey.pem -out certrequest.csr
// openssl x509 -req -in certrequest.csr -signkey privatekey.pem -out certificate.pem
const options = {
  key  : fs.readFileSync(path.join(__dirname, 'certs/privatekey.pem')),
  cert : fs.readFileSync(path.join(__dirname, 'certs/certificate.pem')),
};

// Create our HTTPS server listening on port 4444.
https.createServer(options, app).listen(4444);
console.log('OAuth 2.0 Authorization Server started on port 4444');
