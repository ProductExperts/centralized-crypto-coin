const ECDSA = require('ecdsa-secp256r1')
const { send, text } = require('micro')

const { getPublicControlKey } = require('./model/keys')
const { ban, isBanned } = require('./service/ban')

async function validateRequest (request, response, endpoints) {
  // Endpoint existance
  if (!endpoints[request.method] || !endpoints[request.method][request.pathname]) {
    return send(response, 404, { success: false, error: 'Not found' })
  }
  if (request.method === 'POST') {
    // Max content length
    const maxContentLength = endpoints.MAX_CONTENT_LENGTH
    const contentLength = parseInt(request.headers['content-length'])
    const rawBody = await text(request, { encoding: 'utf8' })
    if (!contentLength || contentLength > maxContentLength || rawBody.length > contentLength) {
      return send(response, 413, {
        success: false,
        error: `Content length should be less than ${maxContentLength} (but is ${contentLength})`
      })
    }
    // JSON content type
    const acceptedContentTypes = ['application/json', 'application/json; charset=utf-8']
    if (!acceptedContentTypes.includes(request.headers['content-type'])) {
      return send(response, 400, {
        success: false,
        error: `Header "Content-Type" should be one of "${acceptedContentTypes.join('", "')}"`
      })
    }
    // ECDSA Signature
    const publicKey = request.headers['x-public-key']
    const signature = request.headers['x-signature']
    if (!publicKey || !signature) {
      return send(response, 401, {
        success: false,
        error: 'Header should contain "X-Public-Key" and "X-Signature"'
      })
    }
    try {
      const key = ECDSA.fromCompressedPublicKey(publicKey)
      if (!(await key.hashAndVerify(rawBody, signature))) {
        return send(response, 401, {
          success: false,
          error: 'Header "X-Signature" does not verify (public key, BASE64(SIGN(SHA256(content))))'
        })
      }
    } catch (error) {
      return send(response, 401, {
        success: false,
        error:
          'Header "X-Public-Key" should be the compressed public key (264 bites) base64 encoded'
      })
    }
  }
  return true
}

function getIp (request) {
  return (
    request.headers['x-real-ip'] ||
    request.headers['x-forwarded-for'] ||
    request.connection.remoteAddress
  )
}

async function checkAdminRequest (request, response, endpoints) {
  if (validateRequest(request, response, endpoints)) {
    if (request.method === 'POST') {
      const ip = getIp(request)
      if (await isBanned(ip)) {
        return send(response, 401, { success: false, error: 'Banned' })
      } else {
        const controlKey = (await getPublicControlKey()).toCompressedPublicKey()
        if (controlKey !== request.headers['x-public-key']) {
          const MINUTE = 60
          await ban(ip, 5 * MINUTE + Math.ceil(Math.random() * 30))
          return send(response, 401, {
            success: false,
            error: 'Header "X-Public-Key" should be the control key'
          })
        }
      }
    }
    return true
  }
}

module.exports = {
  checkRequest: validateRequest,
  checkAdminRequest
}
