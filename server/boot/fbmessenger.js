'use strict';

var crypto = require('crypto');
var extend = require('util')._extend;

// Wit.ai parameters
var WIT_TOKEN = process.env.WIT_TOKEN;

// Messenger API parameters
var FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
if (!FB_PAGE_TOKEN) { throw new Error('missing FB_PAGE_TOKEN'); }
var FB_APP_SECRET = process.env.FB_APP_SECRET;
if (!FB_APP_SECRET) { throw new Error('missing FB_APP_SECRET'); }

var FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
if (!FB_VERIFY_TOKEN) { throw new Error('missing FB_VERIFY_TOKEN'); }


module.exports = function(app) {
  var bodyParser = require('body-parser');

  var Wit = require('node-wit').Wit;
  var log = require('node-wit').log;

  /*crypto.randomBytes(8, function(err, buff) {
    if (err) throw err;
    FB_VERIFY_TOKEN = buff.toString('hex');
    console.log('/webhook will accept the Verify Token ' + FB_VERIFY_TOKEN);
  });*/

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
  // var sessions = {};

  var findOrCreateSession = function(fbid) {
    return new Promise(function(resolve, reject) {
      app.models.Session.findOrCreateSession(fbid, function(err, result) {
        if (err) reject(err);
        else resolve(result);
      });
    });
  };

  var findSessionById = function(sessionId) {
    return new Promise(function(resolve, reject) {
      app.models.Session.findById(sessionId, {where: {
        active: true,
      }}, function(err, result) {
        if (err) reject(err);
        else resolve(result);
      });
    });
  };

  // Our bot actions
  var actions = extend({
    send: function send(_ref, _ref2) {
      var sessionId = _ref.sessionId;
      var text = _ref2.text;

      // Our bot has something to say!
      // Let's retrieve the Facebook user whose session belongs to

      return findSessionById(sessionId).then(function(session) {
        var recipientId = session.fbid;
        if (recipientId) {
          // Yay, we found our recipient!
          // Let's forward our bot response to her.
          // We return a promise to let our bot know when we're done sending
          return fbMessage(recipientId, text).then(function() {
            return Promise.resolve();
          }).catch(function(err) {
            var msg = 'An error occurred while forwarding the response to';
            console.error('Oops! ', msg, recipientId, ':', err.stack || err);
          });
        } else {
          console.error('Oops! Couldn\'t find user for session:', sessionId);
          // Giving the wheel back to our bot
          return Promise.resolve();
        }
      }).catch(function(err) {
        console.error('Oops! Couldn\'t find active session:', sessionId);
        // Giving the wheel back to our bot
        return Promise.resolve();
      });
    },
  }, require('../bot-actions'));

  // Setting up our bot
  var wit = new Wit({
    accessToken: WIT_TOKEN,
    actions: actions,
    logger: new log.Logger(log.INFO),
  });

  app.use(function(_ref, rsp, next) {
    var method = _ref.method;
    var url = _ref.url;

    rsp.on('finish', function() {
      console.log(rsp.statusCode + ' ' + method + ' ' + url);
    });
    next();
  });
  app.use('/webhook', bodyParser.json({verify: verifyRequestSignature}));

  // Webhook setup
  app.get('/webhook', function(req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
      res.send(req.query['hub.challenge']);
    } else {
      console.log('invalid token! ', req.query['hub.verify_token']);
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

              findOrCreateSession(sender).then(function(session) {
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
                  wit.runActions(session.id, // the user's current session
                  text, // the user's message
                  session.context // the user's current session state
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
                    return new Promise(function(resolve, reject) {
                      session.updateAttributes({
                        context: context,
                        updatedAt: new Date(),
                      }, function(err, ob) {
                        if (err) console.error(err);
                        return resolve();
                      });
                    });
                  }).catch(function(err) {
                    console.error('Oops! Got an error from Wit: ',
                    err.stack || err);
                  });
                }
              }).catch(console.error);
            })();
          } else {
            console.log('received event', JSON.stringify(event));
          }
        });
      });
    }
    res.sendStatus(200);
  });
};

function verifyRequestSignature(req, res, buf) {
  var signature = req.headers['x-hub-signature'];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    //console.error("Couldn't validate the signature.");
    throw new Error("Couldn't validate the signature.");
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
