'use strict';

module.exports = function(request) {
  var context = request.context;
  var entities = request.entities;

  return new Promise(function(resolve, reject) {
    // Here should go the api call, e.g.:
    // context.forecast = apiCall(context.loc)
    if (entities.contact && entities.contact[0]) {
      context.contact = entities.contact[0].value;
    } else {
      context.missingContact = true;
      delete context.contact;
    }
    return resolve(context);
  });
};
