'use strict';

/**
 * Module dependencies.
 */

const compressible = require('compressible')
const isJSON = require('koa-is-json')
const status = require('statuses')
const Stream = require('stream')
const bytes = require('bytes')
const zlib = require('zlib')
const omit = require('lodash.omit')
const iltorb = require('iltorb')

/**
 * Encoding methods supported.
 */

const encodingMethods = {
  gzip: zlib.createGzip,
  deflate: zlib.createDeflate,
  br: iltorb.compressStream
}

const DEFAULT_BROTLI = {
  mode: 0,
  // according to https://blogs.akamai.com/2016/02/understanding-brotlis-potential.html , brotli:4
  // is slightly faster than gzip with somewhat better compression; good default if we don't want to
  // worry about compression runtime being slower than gzip
  quality: 4,
  lgwin: 22,
  lgblock: 0,
  disable_literal_context_modeling: false
}

/**
 * Compress middleware.
 *
 * @param {Object} [options]
 * @return {Function}
 * @api public
 */

module.exports = (options = {}) => {
  let { filter = compressible, threshold = 1024, brotli = DEFAULT_BROTLI } = options
  if (typeof threshold === 'string') threshold = bytes(threshold)

  return async (ctx, next) => {
    ctx.vary('Accept-Encoding')

    await next()

    let { body } = ctx
    if (!body) return
    if (ctx.compress === false) return
    if (ctx.request.method === 'HEAD') return
    if (status.empty[ctx.response.status]) return
    if (ctx.response.get('Content-Encoding')) return

    // forced compression or implied
    if (!(ctx.compress === true || filter(ctx.response.type))) return

    const encoding = brotli && ctx.acceptsEncodings('br', 'identity') === 'br' ?
        'br' :
        ctx.acceptsEncodings('gzip', 'deflate', 'identity');
        
    // identity
    if (!encoding) ctx.throw(406, 'supported encodings: gzip, deflate, identity')
    if (encoding === 'identity') return

    // json
    if (isJSON(body)) body = ctx.body = JSON.stringify(body)

    // threshold
    if (threshold && ctx.response.length < threshold) return

    ctx.set('Content-Encoding', encoding)
    ctx.res.removeHeader('Content-Length')
    // take only required Options
    const opts = encoding === 'br' ?
      Object.assign({}, DEFAULT_BROTLI, typeof brotli === 'object'? brotli : {}) :
      options

    const stream = ctx.body = encodingMethods[encoding](opts)

    if (body instanceof Stream) {
      body.pipe(stream)
    } else {
      stream.end(body)
    }
  };
}
