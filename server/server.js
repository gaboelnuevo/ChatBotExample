'use strict';

var loopback = require('loopback');
var boot = require('loopback-boot');

var app = module.exports = loopback();

var crypto = require('crypto');
var bodyParser = require('body-parser');

var Wit = require('node-wit').Wit;
var log = require('node-wit').log;

// Webserver parameter
var PORT = process.env.PORT || 8445;

// Wit.ai parameters
var WIT_TOKEN = process.env.WIT_TOKEN;

// Messenger API parameters
var FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
if (!FB_PAGE_TOKEN) { throw new Error('missing FB_PAGE_TOKEN'); }
var FB_APP_SECRET = process.env.FB_APP_SECRET;
if (!FB_APP_SECRET) { throw new Error('missing FB_APP_SECRET'); }

var FB_VERIFY_TOKEN = null;
crypto.randomBytes(8, function(err, buff) {
  if (err) throw err;
  FB_VERIFY_TOKEN = buff.toString('hex');
  console.log('/webhook will accept the Verify Token ' + FB_VERIFY_TOKEN);
});

// ----------------------------------------------------------------------------
// Messenger API specific code

// See the Send API reference
// https://developers.facebook.com/docs/messenger-platform/send-api-reference

var fbMessage = function fbMessage(id, text) {
  var body = JSON.stringify({
    recipient: {id: id},
    message: {text: text},
  });
  var qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: body,
  }).then(function(rsp) {
    return rsp.json();
  }).then(function(json) {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

// ----------------------------------------------------------------------------
// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
var sessions = {};

var findOrCreateSession = function findOrCreateSession(fbid) {
  var sessionId = void 0;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(function(k) {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Our bot actions
var actions = {
  send: function send(_ref, _ref2) {
    var sessionId = _ref.sessionId;
    var text = _ref2.text;

    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    var recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      // We return a promise to let our bot know when we're done sending
      return fbMessage(recipientId, text).then(function() {
        return null;
      }).catch(function(err) {
        var msg = 'Oops! An error occurred while forwarding the response to';
        console.error(msg, recipientId, ':', err.stack || err);
      });
    } else {
      console.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve();
    }
  },
};

// Setting up our bot
var wit = new Wit({
  accessToken: WIT_TOKEN,
  actions: actions,
  logger: new log.Logger(log.INFO),
});

app.start = function() {
  // start the web server
  app.use('/webhook', bodyParser.json({verify: verifyRequestSignature}));

  // Webhook setup
  app.get('/webhook', function(req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
      res.send(req.query['hub.challenge']);
    } else {
      res.sendStatus(400);
    }
  });

  // Message handler
  app.post('/webhook', function(req, res) {
    // Parse the Messenger payload
    // See the Webhook reference
    // https://developers.facebook.com/docs/messenger-platform/webhook-reference
    var data = req.body;

    if (data.object === 'page') {
      data.entry.forEach(function(entry) {
        entry.messaging.forEach(function(event) {
          if (event.message) {
            (function() {
              // Yay! We got a new message!
              // We retrieve the Facebook user ID of the sender
              var sender = event.sender.id;

              // We retrieve the user's current session, or create one if it doesn't exist
              // This is needed for our bot to figure out the conversation history
              var sessionId = findOrCreateSession(sender);

              // We retrieve the message content
              var _event$message = event.message;
              var text = _event$message.text;
              var attachments = _event$message.attachments;

              if (attachments) {
                // We received an attachment
                // Let's reply with an automatic message
                fbMessage(sender,
                  'Sorry I can only process text messages for now.')
                .catch(console.error);
              } else if (text) {
                // We received a text message

                // Let's forward the message to the Wit.ai Bot Engine
                // This will run all actions until our bot has nothing left to do
                wit.runActions(sessionId, // the user's current session
                text, // the user's message
                sessions[sessionId].context // the user's current session state
                ).then(function(context) {
                  // Our bot did everything it has to do.
                  // Now it's waiting for further messages to proceed.
                  console.log('Waiting for next user messages');

                  // Based on the session state, you might want to reset the session.
                  // This depends heavily on the business logic of your bot.
                  // Example:
                  // if (context['done']) {
                  //   delete sessions[sessionId];
                  // }

                  // Updating the user's current session state
                  sessions[sessionId].context = context;
                }).catch(function(err) {
                  console.error('Oops! Got an error from Wit: ',
                  err.stack || err);
                });
              }
            })();
          } else {
            console.log('received event', JSON.stringify(event));
          }
        });
      });
    }
    res.sendStatus(200);
  });

  return app.listen(function() {
    app.emit('started');
    var baseUrl = app.get('url').replace(/\/$/, '');
    console.log('Web server listening at: %s', baseUrl);
    if (app.get('loopback-component-explorer')) {
      var explorerPath = app.get('loopback-component-explorer').mountPath;
      console.log('Browse your REST API at %s%s', baseUrl, explorerPath);
    }
  });
};

function verifyRequestSignature(req, res, buf) {
  var signature = req.headers['x-hub-signature'];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

// Bootstrap the application, configure models, datasources and middleware.
// Sub-apps like REST API are mounted via boot scripts.
boot(app, __dirname, function(err) {
  if (err) throw err;

  // start the server if `$ node server.js`
  if (require.main === module)
    app.start();
});
