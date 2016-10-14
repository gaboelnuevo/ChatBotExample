'use strict';

module.exports = function(Session) {
  Session.findOrCreateSession = function(fbid, cb) {
    Session.findOne({
      where: {
        fbid: fbid,
        active: true,
      },
    }, function(err, session) {
      if (err) {
        cb(err);
      } else {
        if (session) {
          cb(null, session);
        } else {
          Session.create({
            fbid: fbid,
            active: true,
          }, function(err, session) {
            cb(err, session);
          });
        }
      }
    });
  };
};
