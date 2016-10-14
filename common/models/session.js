'use strict';

module.exports = function(Session) {
  Session.findOrCreateSession = function(fbid, cb) {
    Session.findOne({
      where: {
        fbid: fbid,
        active: true,
      },
    }, function(err, session) {
      if (!err && session) {
        cb(null, session);
      } else {
        Session.create({
          fbid: fbid,
          active: true,
        }, function(err, session) {
          if (err) {
            return cb(err);
          } else {
            cb(null, session);
          }
        });
      }
    });
  };
};
