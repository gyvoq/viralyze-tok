'use strict';
function addMonths(date,months) { const r=new Date(date); const day=r.getDate(); r.setMonth(r.getMonth()+months); if(r.getDate()!==day) r.setDate(0); return r; }
function addDays(date,days) { const r=new Date(date); r.setDate(r.getDate()+days); return r; }
function isExpired(expiresAt) { if(!expiresAt) return true; return new Date()>new Date(expiresAt); }
function fmtDate(date) { try { return new Date(date).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}); } catch { return '—'; } }
module.exports = { addDays, addMonths, isExpired, fmtDate };
