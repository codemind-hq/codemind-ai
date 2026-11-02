import test from 'node:test';
import assert from 'node:assert/strict';
import { seniorityFromTitle, seniorityOf } from './seniority.js';

const CASES = [
  ['Senior Software Engineer', 'senior'],
  ['Sr. Backend Engineer', 'senior'],
  ['Staff Software Engineer', 'staff'],
  ['Senior Staff Engineer', 'staff'], // the higher of the two wins
  ['Principal Engineer', 'principal'],
  ['Distinguished Engineer', 'principal'],
  ['Lead Data Engineer', 'lead'],
  ['Tech Lead, Payments', 'lead'],
  ['Junior Developer', 'junior'],
  ['Jr Frontend Engineer', 'junior'],
  ['Graduate Software Engineer', 'junior'],
  ['Entry-Level QA Engineer', 'junior'],
  ['Software Engineering Intern', 'intern'],
  ['Software Engineer Internship - Summer 2027', 'intern'],
  ['Software Engineer III', 'senior'],
  ['Software Engineer II', 'mid'],
  ['Software Engineer I', 'junior'],
  ['Software Engineer L5', 'senior'],
  ['Backend Engineer, Level 2', 'mid'],
  // Nothing in the title says a level, so nothing is claimed.
  ['Software Engineer', null],
  ['Backend Developer', null],
  ['', null],
  // A req number in brackets is not a level.
  ['Software Engineer (2024-1138)', null],
  ['Platform Engineer [REQ-3001]', null],
  // The one who runs the programme is not an intern.
  ['Internship Program Manager', null],
  ['Intern Coordinator', null],
  ['University Recruiter, Interns', null],
  // An intern posting is an intern posting whatever else it says.
  ['Senior Engineering Intern', 'intern'],
  // A posting open at several rungs is read at its lowest.
  ['Engineer Mission Assurance 2/3', 'mid'],
  ['Software Engineer II/III', 'mid'],
  ['Software Engineer 1-2', 'junior'],
  ['Backend Engineer, Level 3 or 4', 'senior'],
  // A requisition number is not a junior.
  ['JR-217146 SAP Developer', null],
  ['JR 217146 - SAP Developer', null],
];

for (const [title, expected] of CASES) {
  test(`seniorityFromTitle(${JSON.stringify(title)}) is ${expected}`, () => {
    assert.equal(seniorityFromTitle(title), expected);
  });
}

test('the management rungs above a lead read as manager', () => {
  for (const title of ['Director of Engineering', 'Head of Platform', 'VP, Engineering', 'Vice President of Data', 'Chief Technology Officer', 'CTO', 'Senior Engineering Manager', 'Software Development Manager']) {
    assert.equal(seniorityFromTitle(title), 'manager', title);
  }
  // A manager of something else is not a level: a product or account manager says nothing.
  assert.equal(seniorityFromTitle('Product Manager'), null);
  assert.equal(seniorityFromTitle('Lead Data Engineer'), 'lead');
});

test('intermediate and middle are mid-level', () => {
  assert.equal(seniorityFromTitle('Middle Python Developer'), 'mid');
  assert.equal(seniorityFromTitle('Intermediate Software Developer'), 'mid');
});

test('seniorityOf: a Level line of the description when the title names none', () => {
  assert.equal(seniorityOf('Software Engineer', 'About us\nLevel: Senior\nLocation: Remote'), 'senior');
  assert.equal(seniorityOf('Backend Engineer', 'Seniority: Mid-level'), 'mid');
  assert.equal(seniorityOf('Backend Engineer', 'Experience level: Entry level'), 'junior');
  // The title outranks the line, and a description without one says nothing.
  assert.equal(seniorityOf('Senior Backend Engineer', 'Level: Junior'), 'senior');
  assert.equal(seniorityOf('Backend Engineer', 'We need someone at the next level of their career.'), null);
});
