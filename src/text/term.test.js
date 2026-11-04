import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTermYear, termEnd, termFromSlug, termFromTitle, termLabel, termSlug, termStarted } from './term.js';

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

test('a term has begun once its first month is past', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.equal(termStarted({ season: 'summer', year: 2026 }, { now }), true);
  assert.equal(termStarted({ season: 'fall', year: 2026 }, { now }), true);
  assert.equal(termStarted({ season: 'winter', year: 2026 }, { now }), false);
  assert.equal(termStarted({ season: 'summer', year: 2027 }, { now }), false);
  assert.equal(termStarted({ season: 'spring', year: 2025 }, { now }), true);
});

test('a season word that is something else is no term', () => {
  assert.equal(termFromTitle('Graduate Programme - Engineer [Java (Spring, J2EE)]', { now }), null);
  assert.equal(termFromTitle('Spring Boot Developer Intern', { now }), null);
  assert.equal(termFromTitle('Java/Spring Intern', { now }), null);
  assert.equal(termFromTitle('Software Intern, Spring, TX', { now }), null);
  assert.equal(termFromTitle('Intern - Winter Park', { now }), null);
  assert.equal(termFromTitle('Fall Protection Engineering Intern', { now }), null);
  // Still a term, however it is put.
  assert.deepEqual(termFromTitle('Summer Software Engineering Intern', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('Software Engineering Co-op (Spring/Summer 2027)', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('Java Developer Intern - Spring 2027', { now }), { season: 'spring', year: 2027 });
  assert.deepEqual(termFromTitle('Software Engineer Intern - Java - Summer 2027', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('Software Engineer Intern - Java - Spring 2027', { now }), { season: 'spring', year: 2027 });
});

test('when a student graduates is no term, and neither is a requisition', () => {
  assert.equal(termFromTitle('Software Engineering Intern (Grad Year: Winter 2027)', { now }), null);
  assert.equal(termFromTitle('R&D Engineer Co-op - Students Graduating in 2029 ONLY', { now }), null);
  assert.equal(termFromTitle('Rotation Intern - 2028 Graduates', { now }), null);
  assert.equal(termFromTitle('Software Intern, Class of 2027', { now }), null);
  assert.deepEqual(termFromTitle('Summer 2027 Intern, Class of 2028', { now }), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('2027 Graduate Programme', { now }), { season: '', year: 2027 });
  assert.equal(termFromTitle('Software Intern R-2027', { now }), null);
  assert.equal(termFromTitle('Software Intern (2027-1138)', { now }), null);
});

test('a season with no year asks for the first one not begun', () => {
  assert.equal(nextTermYear('summer', { now }), 2027);
  assert.equal(nextTermYear('winter', { now }), 2026);
  assert.equal(nextTermYear('summer', { now: new Date('2027-03-01T00:00:00Z') }), 2027);
});

test('a title naming several terms with their years is for the last of them', () => {
  assert.deepEqual(termFromTitle('Software Engineer Intern (Fall 2025/Summer 2026)'), { season: 'summer', year: 2026 });
  assert.deepEqual(termFromTitle('R&D Intern (Fall 2026/Spring-Summer 2027)'), { season: 'summer', year: 2027 });
  assert.deepEqual(termFromTitle('Intern, Autumn 2026 or Spring 2026'), { season: 'fall', year: 2026 });
});

test('one term named stays as it read, a season shared by one year too', () => {
  const now = new Date(Date.UTC(2026, 10, 4));
  assert.deepEqual(termFromTitle('AI Internship (Winter or Summer 2026)', { now }), { season: 'summer', year: 2026 });
  assert.deepEqual(termFromTitle('Intern (Fall/Winter 2026)', { now }), { season: 'fall', year: 2026 });
});

test('a term ends four months after it starts, and a bare year with the year', () => {
  assert.equal(termEnd({ season: 'summer', year: 2026 }).toISOString().slice(0, 10), '2026-10-01');
  assert.equal(termEnd({ season: 'spring', year: 2026 }).toISOString().slice(0, 10), '2026-07-01');
  assert.equal(termEnd({ season: 'fall', year: 2026 }).toISOString().slice(0, 10), '2027-01-01');
  assert.equal(termEnd({ season: 'winter', year: 2026 }).toISOString().slice(0, 10), '2027-04-01');
  assert.equal(termEnd({ season: '', year: 2026 }).toISOString().slice(0, 10), '2027-01-01');
});
