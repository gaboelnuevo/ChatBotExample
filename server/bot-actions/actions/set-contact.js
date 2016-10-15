'use strict';

module.exports = function(request) {
  var context = request.context;
  var entities = request.entities;

  return new Promise(function(resolve, reject) {
	  // Here should go the api call, e.g.:
	  // context.forecast = apiCall(context.loc)
    console.log('set contact triggered');
    console.log(entities);
    return resolve(context);
  });
};
