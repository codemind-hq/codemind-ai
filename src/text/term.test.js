import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termFromSlug, termFromTitle, termLabel, termSlug } from './term.js';

const now = new Date('2026-11-02T00:00:00Z');

test('a title names its season and year, in either order', () => {
  assert.deepEqual(termFromTitle('Software Engineer Intern (Summer 2027)', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('2027 Summer Analyst - Technology', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('Co-op – Software Engineer – Autumn 2026', { now }), { season: 'fall', year: 2026 });
  assert.deepEqual(termFromTitle('Winter 2027 - Front-End Web Development Intern', { now }), { season: 'winter', year: 2027 });
});

test('a season without a year is the next one; a year without a season keeps the year', () => {
  assert.deepEqual(termFromTitle('Summer Intern, Backend', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('Spring Co-op', { now }), { season: 'spring', year: 2027 });
  // November: this winter has not started.
  assert.deepEqual(termFromTitle('Winter Intern', { now }), { season: 'winter', year: 2026 });
  assert.deepEqual(termFromTitle('Software Engineer Intern 2027', { now }), { season: '', year: 2027 });
  assert.equal(termFromTitle('Software Engineer Intern', { now }), null);
  // A requisition number is not a year.
  assert.equal(termFromTitle('Software Engineer (R-202711)', { now }), null);
});

test('labels and slugs', () => {
  assert.equal(termLabel({ season: 'summer', year: 2027 }), 'Summer 2027');
  assert.equal(termLabel({ season: '', year: 2027 }), '2027');
  assert.equal(termLabel(null), '');
  assert.equal(termSlug({ season: 'fall', year: 2026 }), 'fall-2026');
  assert.equal(termSlug({ season: '', year: 2026 }), '');
  assert.deepEqual(termFromSlug('summer-2027'), { season: 'summer', year: 2027 });
  assert.equal(termFromSlug('summer'), null);
});
