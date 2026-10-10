// DNS is managed in GoDaddy. Keep the ACM validation CNAME for renewal.
export const studioDomain = 'studio.un-real.ai';
export const studioCertificateArn = 'arn:aws:acm:us-east-1:885072868436:certificate/f45e996b-c094-4840-b77f-209e4bf7f514';

export const studioRoutes = `function handler(event) {
  var request = event.request;
  if (request.headers.host.value !== '${studioDomain}') {
    var parts = [];
    for (var key in request.querystring) {
      var parameter = request.querystring[key];
      var values = parameter.multiValue || [parameter];
      for (var i = 0; i < values.length; i++) parts.push(key + '=' + values[i].value);
    }
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: {
      location: { value: 'https://${studioDomain}' + request.uri + (parts.length ? '?' + parts.join('&') : '') }
    } };
  }
  if (request.uri === '/' || request.uri === '/auth/callback' || request.uri === '/oauth/consent') request.uri = '/index.html';
  return request;
}`;
