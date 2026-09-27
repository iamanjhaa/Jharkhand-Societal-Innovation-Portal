import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Challenge from '../models/Challenge.js';
import User from '../models/User.js';
import { UNIVERSITY_DEPARTMENTS, UNIVERSITY_ASSIGNMENT_DEPARTMENTS } from '../constants/universityDepartments.js';

const objectId = () => new mongoose.Types.ObjectId();

function universityUser(overrides = {}) {
  return new User({
    name: 'Registered University User',
    email: `${objectId()}@example.edu`,
    password: 'password123',
    role: 'university',
    institution: 'Registered University',
    ...overrides
  });
}

test('Sankalp Club is assignable but is not an academic department', () => {
  assert.equal(UNIVERSITY_DEPARTMENTS.includes('Sankalp Club'), false);
  assert.equal(UNIVERSITY_ASSIGNMENT_DEPARTMENTS.includes('Sankalp Club'), true);
  assert.equal(UNIVERSITY_ASSIGNMENT_DEPARTMENTS.length, UNIVERSITY_DEPARTMENTS.length + 1);
});

test('ordinary users do not receive default Sankalp membership data', () => {
  const user = new User({
    name: 'Citizen',
    email: `${objectId()}@example.com`,
    password: 'password123',
    role: 'citizen',
    mobile: '9876543210',
    district: 'Ranchi',
    villageOrCity: 'Ranchi'
  });
  assert.equal(user.sankalpClubProfile, undefined);
});

test('NCC cadet profile accepts real membership fields', async () => {
  const user = universityUser({
    accountType: 'student',
    universityDepartment: 'Computer Science & IT',
    primaryClub: 'NCC',
    sankalpClubProfile: {
      club: 'Sankalp Club',
      organization: 'NCC',
      role: 'cadet',
      studentId: 'NCC-001',
      course: 'BCA',
      yearSemester: '2nd Year'
    }
  });

  await user.validate();
  assert.equal(user.sankalpClubProfile.active, true);
  assert.equal(user.sankalpClubProfile.available, true);
});

test('membership rejects non-NCC/NSS organizations', async () => {
  const user = universityUser({
    accountType: 'student',
    primaryClub: 'NCC',
    sankalpClubProfile: {
      club: 'Sankalp Club',
      organization: 'Computer Science',
      role: 'cadet'
    }
  });

  await assert.rejects(user.validate(), (error) => error.name === 'ValidationError');
});

test('Sankalp challenge stores referenced students and validates organization badges', async () => {
  const challenge = new Challenge({
    title: 'Community water access',
    description: 'Repair a local water point.',
    category: 'Water',
    district: 'Ranchi',
    submittedBy: objectId(),
    department: 'Sankalp Club',
    departmentMentor: objectId(),
    mentorAssigned: true,
    studentsAssigned: true,
    selectedStudents: [{ studentId: objectId(), organization: 'NSS' }]
  });

  await challenge.validate();
  assert.equal(challenge.selectedStudents[0].organization, 'NSS');
});
