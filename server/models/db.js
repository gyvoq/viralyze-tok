/**
 * models/db.js — Nex AI
 * Conexão ÚNICA com o MongoDB, compartilhada por todo o backend.
 * Guarda a Promise (não o resultado): chamadas simultâneas aguardam a mesma
 * conexão em vez de criar vários MongoClient. Se a conexão falhar, a Promise é
 * descartada para que a próxima chamada tente de novo.
 */

'use strict';

const { MongoClient } = require('mongodb');

const DB_NAME = 'nexai';
let dbPromise = null;

function connect() {
  if (dbPromise) return dbPromise;

  const uri = (process.env.MONGO_URI || '').trim();
  if (!uri) return Promise.reject(new Error('MONGO_URI não configurada.'));

  dbPromise = (async () => {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    console.log('✅  MongoDB conectado');
    return client.db(DB_NAME);
  })().catch((err) => {
    dbPromise = null; // permite nova tentativa
    throw err;
  });

  return dbPromise;
}

module.exports = { connect, DB_NAME };
