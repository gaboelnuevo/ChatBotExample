'use strict';

module.exports = function(request) {
  var context = request.context;
  var entities = request.entities;

  return new Promise(function(resolve, reject) {
    if (entities.contact && entities.contact[0]) {
      context.contact = entities.contact[0].value;
      context.missingContact = false;
    } else {
      context.missingContact = true;
      if (context.contact) {
        delete context.contact;
      }
    }
    return resolve(context);
  });
};
