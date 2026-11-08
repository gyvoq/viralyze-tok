/**
 * middleware/mongoRateStore.js — Viralyze Tok
 * Store do express-rate-limit no MongoDB. Na Vercel cada requisição pode cair numa
 * instância diferente, então contadores em memória não funcionam: ficam no banco.
 * Os documentos expiram sozinhos (índice TTL em resetTime).
 */
'use strict';

const { connect } = require('../models/db');

const COL_NAME = 'rate_limits';
let colPromise = null;

function getCol() {
  if (colPromise) return colPromise;
  colPromise = (async () => {
    const db  = await connect();
    const col = db.collection(COL_NAME);
    await col.createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 });
    return col;
  })().catch((err) => { colPromise = null; throw err; });
  return colPromise;
}

class MongoStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) { this.windowMs = options.windowMs; }

  id(key) { return `${this.prefix}:${key}`; }

  async get(key) {
    const c = await getCol();
    const d = await c.findOne({ _id: this.id(key) });
    if (!d || d.resetTime <= new Date()) return undefined;
    return { totalHits: d.hits, resetTime: d.resetTime };
  }

  async increment(key) {
    const c   = await getCol();
    const now = new Date();
    const exp = { $lte: [{ $ifNull: ['$resetTime', now] }, now] };
    const d = await c.findOneAndUpdate(
      { _id: this.id(key) },
      [{ $set: {
        hits      : { $cond: [exp, 1, { $add: ['$hits', 1] }] },
        resetTime : { $cond: [exp, new Date(now.getTime() + this.windowMs), '$resetTime'] },
      } }],
      { upsert: true, returnDocument: 'after' }
    );
    return { totalHits: d.hits, resetTime: d.resetTime };
  }

  async decrement(key) {
    const c = await getCol();
    await c.updateOne({ _id: this.id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    const c = await getCol();
    await c.deleteOne({ _id: this.id(key) });
  }
}

module.exports = MongoStore;
